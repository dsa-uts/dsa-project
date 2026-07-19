# k3s 環境の起動・停止 flake apps (`nix run .#k3s-up` / `.#k3s-down`)。
#
# macOS: microvm.nix + vfkit の VM (nix/k3s-vm.nix) をバックグラウンド起動する。
# Linux: ホストで k3s server を systemd の一時 unit (dsa-k3s) として起動する。
#
# どちらも状態は state dir (既定: $PWD/.k3s、DSA_K3S_STATE_DIR で変更可) に置き、
# 起動完了後は state dir 直下の kubeconfig で kubectl が使える。
{
  pkgs,
  # macOS のみ: k3s VM の microvm runner パッケージ
  k3sVmRunner,
}:
let
  inherit (pkgs) lib;

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

  darwinApps = {
    k3s-up = toApp (
      pkgs.writeShellApplication {
        name = "k3s-up";
        meta.description = "Start the single-node k3s VM and wait until the node is Ready";
        runtimeInputs = with pkgs; [
          curl
          kubectl
          coreutils
          expect # unbuffer: vfkit の stdio コンソールに pty を与える
        ];
        text = ''
          ${stateDirSnippet}
          mkdir -p "$state_dir/share"
          cd "$state_dir"

          ${vmRunningSnippet}
          started=0
          if vm_running; then
            echo "k3s VM is already running (state dir: $state_dir)"
          else
            rm -f share/kubeconfig control.sock
            echo "Starting the k3s VM (log: $state_dir/vm.log) ..."
            # vfkit はコンソールを stdio に繋ぐため pty が必要 (unbuffer が確保する)
            nohup unbuffer ${k3sVmRunner}/bin/microvm-run > vm.log 2>&1 &
            echo $! > vm.pid
            started=1
          fi

          echo "Waiting for the VM to publish its kubeconfig ..."
          for _ in $(seq 300); do
            [ -s share/kubeconfig ] && break
            if [ "$started" = 1 ] && ! kill -0 "$(cat vm.pid)" 2>/dev/null; then
              echo "The VM process exited unexpectedly. Last log lines:" >&2
              tail -n 20 vm.log >&2
              exit 1
            fi
            sleep 1
          done
          if ! [ -s share/kubeconfig ]; then
            echo "Timed out waiting for $state_dir/share/kubeconfig. Last log lines:" >&2
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
    in
    {
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
