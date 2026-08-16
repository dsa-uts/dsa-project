# k3s 環境を操作する flake apps。
#
# - k3s-up / k3s-down: ホスト上の k3s server を systemd の一時 unit
#   (dsa-k3s) として起動・停止する。
# - k3s-load-images: dockerTools でビルドしたイメージをクラスタへ搬入する。
#   stream script をホストの containerd へ直接 pipe する。
# - k3s-deploy: k3s-load-images した上でローカル用 Kustomize overlay を apply する。
#
# どれも状態は state dir (既定: $PWD/.k3s、DSA_K3S_STATE_DIR で変更可) に置き、
# k3s-up 完了後は state dir 直下の kubeconfig で kubectl が使える。
{ pkgs }:
let
  inherit (pkgs) lib;

  manifests = ../deploy;
  dependencyTool = ../scripts/backend-deps.nu;
  openbaoInstall = ../scripts/openbao-install.nu;
  openbaoConfigure = ../scripts/openbao-configure.nu;
  renderLocalManifests = import ./render-local-manifests.nix { inherit pkgs manifests; };

  toApp = drv: {
    type = "app";
    program = lib.getExe drv;
    meta.description = drv.meta.description or "";
  };

  stateDirSnippet = ''
    state_dir="''${DSA_K3S_STATE_DIR:-$PWD/.k3s}"
  '';

  # ノードが Ready になるまで待つ。API サーバーがまだ聴いていない・ノードが
  # まだ登録されていない段階でも失敗しないよう、kubectl wait ではなく
  # リトライループで判定する。
  waitForNodeSnippet = ''
    echo "Waiting for the node to become Ready ..."
    node_ready=""
    for _ in $(seq 180); do
      if kubectl --kubeconfig "$state_dir/kubeconfig" get nodes --no-headers 2>/dev/null \
        | awk '$2 == "Ready" { found = 1 } END { exit !found }'; then
        node_ready=1
        break
      fi
      sleep 1
    done
    if [ -z "$node_ready" ]; then
      echo "Timed out waiting for the node to become Ready:" >&2
      kubectl --kubeconfig "$state_dir/kubeconfig" get nodes >&2 || true
      exit 1
    fi
    kubectl --kubeconfig "$state_dir/kubeconfig" get nodes
    echo
    echo "k3s is up. Point kubectl at it with:"
    echo "  export KUBECONFIG=$state_dir/kubeconfig"
  '';

  # イメージ搬入後にローカル用 manifest を apply し、アクセス URL を表示する。
  # image tag は derivation hash 由来で毎ビルド変わり得るため、一時的に render
  # した manifest へ現在の tag を注入して Deployment の rollout を起こす。
  mkDeploy =
    loadImages:
    pkgs.writeShellApplication {
      name = "k3s-deploy";
      meta.description = "Load the container images and apply the local Kubernetes manifests";
      runtimeInputs = with pkgs; [
        kubectl
        kubernetes-helm
        coreutils
        nix
        nushell
      ];
      text = ''
        ${stateDirSnippet}
        kubeconfig="$state_dir/kubeconfig"
        if [ ! -s "$kubeconfig" ]; then
          echo "kubeconfig not found at $kubeconfig; run 'nix run .#k3s-up' first" >&2
          exit 1
        fi

        ${lib.getExe loadImages}

        export KUBECONFIG="$kubeconfig"
        echo "Installing and configuring local OpenBao ..."
        ${pkgs.nushell}/bin/nu ${openbaoInstall} dev --repo-root "$PWD"
        ${pkgs.nushell}/bin/nu ${openbaoConfigure} dev --repo-root "$PWD"

        backend_tag=$(nix eval --raw .#backend-image.imageTag)
        frontend_tag=$(nix eval --raw .#frontend-image.imageTag)

        echo "Applying the local Kubernetes manifests ..."
        ${lib.getExe renderLocalManifests} "$backend_tag" "$frontend_tag" \
          | kubectl --kubeconfig "$kubeconfig" apply -f -
        kubectl --kubeconfig "$kubeconfig" rollout status \
          deployment/dsa-backend --timeout=5m
        kubectl --kubeconfig "$kubeconfig" rollout status \
          deployment/dsa-frontend --timeout=5m

        node_ip=$(kubectl --kubeconfig "$kubeconfig" get nodes \
          -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
        echo
        echo "Deployed. Open: http://$node_ip/"
      '';
    };

  apps =
    let
      unit = "dsa-k3s";
      hostKubeconfig = "/etc/rancher/k3s/k3s.yaml";
      # 非 NixOS ホスト (Ubuntu 等) でも動くよう、k3s が呼ぶ外部コマンドは
      # nix store のものを unit の PATH に載せる。
      k3sPath = lib.makeBinPath (
        with pkgs;
        [
          k3s
          util-linux
          iptables
          ipset
          socat
          conntrack-tools
          ethtool
          kmod
          coreutils
          findutils
          gnugrep
        ]
      );
      loadImages = pkgs.writeShellApplication {
        name = "k3s-load-images";
        meta.description = "Import the container images into the host k3s server's containerd";
        runtimeInputs = [
          pkgs.nix
          pkgs.nushell
        ];
        text = ''
          ${dependencyTool} refresh --repo-root "$PWD"
          backend_image=$(nix build --no-link --print-out-paths .#backend-image)
          frontend_image=$(nix build --no-link --print-out-paths .#frontend-image)

          # stream script を containerd (k8s.io namespace) へ直接 pipe する。
          # containerd の socket は root 所有のため sudo が要る。
          echo "Importing the backend image (requires sudo) ..."
          "$backend_image" | sudo ${pkgs.k3s}/bin/k3s ctr -n k8s.io images import -
          echo "Importing the frontend image ..."
          "$frontend_image" | sudo ${pkgs.k3s}/bin/k3s ctr -n k8s.io images import -
        '';
      };
    in
    {
      k3s-load-images = toApp loadImages;
      k3s-deploy = toApp (mkDeploy loadImages);

      k3s-up = toApp (
        pkgs.writeShellApplication {
          name = "k3s-up";
          meta.description = "Start a single-node k3s server on this host and wait until the node is Ready";
          runtimeInputs = with pkgs; [
            kubectl
            coreutils
          ];
          text = ''
            ${stateDirSnippet}
            mkdir -p "$state_dir"

            if systemctl is-active --quiet ${unit}; then
              echo "k3s server is already running (systemd unit: ${unit})"
            else
              echo "Starting the k3s server as transient systemd unit ${unit} (requires sudo) ..."
              sudo systemd-run --unit=${unit} \
                --description="dsa-project single-node k3s server" \
                --property=Environment=PATH=${k3sPath} \
                ${pkgs.k3s}/bin/k3s server
            fi

            echo "Waiting for the kubeconfig ..."
            for _ in $(seq 300); do
              sudo test -s ${hostKubeconfig} && break
              if ! systemctl is-active --quiet ${unit}; then
                echo "Unit ${unit} is not running. Check: journalctl -u ${unit}" >&2
                exit 1
              fi
              sleep 1
            done
            if ! sudo test -s ${hostKubeconfig}; then
              echo "Timed out waiting for ${hostKubeconfig}. Check: journalctl -u ${unit}" >&2
              exit 1
            fi

            # kubeconfig は root 所有 mode 600 のまま、自分の所有でコピーする
            sudo install -m 600 -o "$(id -un)" -g "$(id -gn)" ${hostKubeconfig} "$state_dir/kubeconfig"
            ${waitForNodeSnippet}
          '';
        }
      );

      k3s-down = toApp (
        pkgs.writeShellApplication {
          name = "k3s-down";
          meta.description = "Stop the single-node k3s server running on this host";
          text = ''
            if systemctl is-active --quiet ${unit}; then
              echo "Stopping systemd unit ${unit} (requires sudo) ..."
              sudo systemctl stop ${unit}
              echo "k3s server stopped. Note: workload containers keep running;"
              echo "they are re-managed when the server is started again."
            else
              echo "k3s server is not running (systemd unit: ${unit})"
            fi
          '';
        }
      );
    };
in
apps
