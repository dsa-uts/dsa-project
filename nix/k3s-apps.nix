# k3s 環境を操作する flake apps。
#
# - k3s-up / k3s-down: クラスタの起動・停止。
#   macOS: microvm.nix + vfkit の VM (nix/k3s-vm.nix) をバックグラウンド起動する。
#   Linux: ホストで k3s server を systemd の一時 unit (dsa-k3s) として起動する。
# - k3s-load-images: dockerTools でビルドしたイメージをクラスタへ搬入する。
#   macOS: イメージ tar を SSH 越しに VM の `k3s ctr images import -` へ pipe する。
#   Linux: stream script をホストの containerd へ直接 pipe する。
# - k3s-deploy: k3s-load-images した上で Helm chart (chart/) を install する。
# - k3s-ssh (macOS のみ): VM へ root で SSH する (調査用の正面玄関)。
#
# どれも状態は state dir (既定: $PWD/.k3s、DSA_K3S_STATE_DIR で変更可) に置き、
# k3s-up 完了後は state dir 直下の kubeconfig で kubectl が使える。
{
  pkgs,
  # macOS のみ: k3s VM の microvm runner パッケージ
  k3sVmRunner,
  # コンテナイメージ (Linux 用 derivation)。macOS では VM のアーキテクチャに
  # 合わせた aarch64-linux のものが渡される (flake.nix)。
  backendImage,
  frontendImage,
}:
let
  inherit (pkgs) lib;

  chart = ../chart;

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

  # vfkit の REST API (control socket) で VM の生死を判定する
  vmRunningSnippet = ''
    vm_running() {
      curl -sf --unix-socket control.sock http://vfkit/vm/state >/dev/null 2>&1
    }
  '';

  # イメージ搬入後に chart を helm install し、アクセス URL を表示する。
  # image tag は derivation hash 由来で毎ビルド変わり得るため、この app が
  # 現在の tag を --set で values に渡す (chart/values.yaml 参照)。
  mkDeploy =
    loadImages:
    pkgs.writeShellApplication {
      name = "k3s-deploy";
      meta.description = "Load the container images and install the Helm chart onto the k3s cluster";
      runtimeInputs = with pkgs; [
        kubernetes-helm
        kubectl
        coreutils
      ];
      text = ''
        ${stateDirSnippet}
        kubeconfig="$state_dir/kubeconfig"
        if [ ! -s "$kubeconfig" ]; then
          echo "kubeconfig not found at $kubeconfig; run 'nix run .#k3s-up' first" >&2
          exit 1
        fi

        ${lib.getExe loadImages}

        echo "Installing the Helm chart ..."
        helm upgrade --install dsa ${chart} \
          --kubeconfig "$kubeconfig" \
          --set backend.image.tag=${backendImage.imageTag} \
          --set frontend.image.tag=${frontendImage.imageTag} \
          --wait --timeout 5m

        node_ip=$(kubectl --kubeconfig "$kubeconfig" get nodes \
          -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
        echo
        echo "Deployed. Open: http://$node_ip/"
      '';
    };

  darwinApps =
    let
      # VM へ SSH するための準備。cwd は state dir であること。
      # IP は kubeconfig の server URL から、ホスト鍵は VM が share へ公開した
      # ものから known_hosts を組み立て、TOFU せずに厳密検証する。
      # (kubeconfig / host_key.pub は k3s-up が待つので、up 完了後は必ずある)
      vmSshSnippet = ''
        for f in kubeconfig share/ssh/host_key.pub ssh/id_ed25519; do
          if [ ! -s "$f" ]; then
            echo "$state_dir/$f not found; run 'nix run .#k3s-up' first" >&2
            exit 1
          fi
        done
        vm_ip=$(sed -n 's#.*server: https://\([0-9.]*\):6443#\1#p' kubeconfig | head -n1)
        if [ -z "$vm_ip" ]; then
          echo "could not parse the VM's IP from $state_dir/kubeconfig" >&2
          exit 1
        fi
        printf '%s %s\n' "$vm_ip" "$(cut -d' ' -f1,2 share/ssh/host_key.pub)" > ssh/known_hosts
        # -F /dev/null: ユーザーの ~/.ssh/config を読まない (macOS 固有オプション
        # が nixpkgs の ssh で解釈できず落ちるのを防ぎ、挙動も決定的にする)
        vm_ssh() {
          ssh -F /dev/null \
            -i ssh/id_ed25519 \
            -o IdentitiesOnly=yes \
            -o UserKnownHostsFile=ssh/known_hosts \
            -o StrictHostKeyChecking=yes \
            "root@$vm_ip" "$@"
        }
      '';
      # VM と話す app 共通の runtime inputs (curl: control socket、sed: kubeconfig)
      vmClientInputs = with pkgs; [
        curl
        coreutils
        gnused
        openssh
      ];
      # SSH を使う app 共通の前段: state dir へ移動し、VM の稼働を確認した上で
      # vm_ssh を用意する。
      requireVmSshSnippet = ''
        ${stateDirSnippet}
        cd "$state_dir" 2>/dev/null || {
          echo "No state dir at $state_dir; run 'nix run .#k3s-up' first" >&2
          exit 1
        }

        ${vmRunningSnippet}
        if ! vm_running; then
          echo "k3s VM is not running; run 'nix run .#k3s-up' first" >&2
          exit 1
        fi
        ${vmSshSnippet}
      '';
      loadImages = pkgs.writeShellApplication {
        name = "k3s-load-images";
        meta.description = "Import the container images into the k3s VM's containerd";
        runtimeInputs = vmClientInputs;
        text = ''
          ${requireVmSshSnippet}

          # $1: 表示名、$2: イメージ tar の store path
          import_image() {
            echo "Importing $1 into the VM's containerd ..."
            vm_ssh k3s ctr -n k8s.io images import - < "$2"
          }

          import_image "dsa-backend-${backendImage.imageTag}" ${backendImage.tar}
          import_image "dsa-frontend-${frontendImage.imageTag}" ${frontendImage.tar}
        '';
      };
    in
    {
      k3s-load-images = toApp loadImages;
      k3s-deploy = toApp (mkDeploy loadImages);

      k3s-ssh = toApp (
        pkgs.writeShellApplication {
          name = "k3s-ssh";
          meta.description = "SSH into the k3s VM as root (arguments run as a command on the VM)";
          runtimeInputs = vmClientInputs;
          text = ''
            ${requireVmSshSnippet}
            vm_ssh "$@"
          '';
        }
      );

      k3s-up = toApp (
        pkgs.writeShellApplication {
          name = "k3s-up";
          meta.description = "Start the single-node k3s VM and wait until the node is Ready";
          runtimeInputs = with pkgs; [
            curl
            kubectl
            coreutils
            openssh
            expect # unbuffer: vfkit の stdio コンソールに pty を与える
          ];
          text = ''
            ${stateDirSnippet}
            mkdir -p "$state_dir/share/ssh"
            cd "$state_dir"

            # VM への SSH 用クライアント鍵。VM は boot 時に share の公開鍵を
            # root の authorized_keys へインストールする (nix/k3s-vm.nix)。
            generated_key=0
            if [ ! -s ssh/id_ed25519 ]; then
              mkdir -p ssh
              ssh-keygen -q -t ed25519 -N "" -C "dsa-k3s" -f ssh/id_ed25519
              generated_key=1
            fi
            install -m 600 ssh/id_ed25519.pub share/ssh/authorized_keys

            ${vmRunningSnippet}
            started=0
            if vm_running; then
              echo "k3s VM is already running (state dir: $state_dir)"
              # authorized_keys のインストールは boot 時のみ。稼働中の VM は
              # いま生成した鍵を知らないので、再起動するまで SSH が通らない。
              if [ "$generated_key" = 1 ]; then
                echo "Warning: generated a new SSH client key, but the running VM only installs" >&2
                echo "it at boot; run 'nix run .#k3s-down' then 'nix run .#k3s-up' to use SSH." >&2
              fi
            else
              rm -f share/kubeconfig share/ssh/host_key.pub control.sock
              echo "Starting the k3s VM (log: $state_dir/vm.log) ..."
              # vfkit はコンソールを stdio に繋ぐため pty が必要 (unbuffer が確保する)
              nohup unbuffer ${k3sVmRunner}/bin/microvm-run > vm.log 2>&1 &
              echo $! > vm.pid
              started=1
            fi

            echo "Waiting for the VM to publish its SSH host key and kubeconfig ..."
            for _ in $(seq 300); do
              [ -s share/kubeconfig ] && [ -s share/ssh/host_key.pub ] && break
              if [ "$started" = 1 ] && ! kill -0 "$(cat vm.pid)" 2>/dev/null; then
                echo "The VM process exited unexpectedly. Last log lines:" >&2
                tail -n 20 vm.log >&2
                exit 1
              fi
              sleep 1
            done
            if ! { [ -s share/kubeconfig ] && [ -s share/ssh/host_key.pub ]; }; then
              echo "Timed out waiting for $state_dir/share/{kubeconfig,ssh/host_key.pub}. Last log lines:" >&2
              tail -n 20 vm.log >&2
              exit 1
            fi

            install -m 600 share/kubeconfig kubeconfig
            ${waitForNodeSnippet}
          '';
        }
      );

      k3s-down = toApp (
        pkgs.writeShellApplication {
          name = "k3s-down";
          meta.description = "Gracefully shut down the single-node k3s VM";
          runtimeInputs = with pkgs; [
            curl
            coreutils
          ];
          text = ''
            ${stateDirSnippet}
            cd "$state_dir" 2>/dev/null || {
              echo "No state dir at $state_dir; nothing to stop."
              exit 0
            }

            ${vmRunningSnippet}
            if ! vm_running; then
              echo "k3s VM is not running (state dir: $state_dir)"
              exit 0
            fi

            echo "Requesting graceful shutdown ..."
            # runner 同梱の microvm-shutdown は HTTP を話さず vfkit に 400 で
            # 弾かれるため、REST API を直接叩く ("Stop" = 電源ボタン相当)
            curl -sf --unix-socket control.sock \
              -X POST -H "Content-Type: application/json" \
              -d '{"state": "Stop"}' http://vfkit/vm/state

            for _ in $(seq 90); do
              vm_running || break
              sleep 1
            done
            if vm_running; then
              echo "Graceful shutdown timed out; forcing a hard stop." >&2
              curl -sf --unix-socket control.sock \
                -X POST -H "Content-Type: application/json" \
                -d '{"state": "HardStop"}' http://vfkit/vm/state || true
            fi
            echo "k3s VM stopped."
          '';
        }
      );
    };

  linuxApps =
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
        text = ''
          # stream script を containerd (k8s.io namespace) へ直接 pipe する。
          # containerd の socket は root 所有のため sudo が要る。
          echo "Importing dsa-backend:${backendImage.imageTag} (requires sudo) ..."
          ${backendImage} | sudo ${pkgs.k3s}/bin/k3s ctr -n k8s.io images import -
          echo "Importing dsa-frontend:${frontendImage.imageTag} ..."
          ${frontendImage} | sudo ${pkgs.k3s}/bin/k3s ctr -n k8s.io images import -
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
if pkgs.stdenv.isDarwin then darwinApps else linuxApps
