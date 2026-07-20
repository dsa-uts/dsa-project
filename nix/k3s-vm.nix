# シングルノード k3s VM の NixOS 構成 (ADR 0008)。macOS ホストで microvm.nix +
# vfkit により実行される (Linux ホストは VM を使わずホスト直接起動: k3s-apps.nix)。
#
# 相対パス (share/, control.sock, var.img) は runner プロセスの CWD 基準で解決
# されるため、runner は必ず state dir (.k3s/) の中で起動すること (k3s-up が行う)。
{ lib, pkgs, ... }:
let
  # vmnet の DHCP で割り当てられた自分の IPv4 アドレスを取得する。
  # デフォルトルートの src アドレスを使うことで、インターフェース名に
  # 依存せず、k3s 起動後に現れる cni0 等の Pod ネットワークも拾わない。
  vmIpScript = ''
    vm_ip=""
    for _ in $(seq 60); do
      vm_ip=$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n1)
      [ -n "$vm_ip" ] && break
      sleep 1
    done
    if [ -z "$vm_ip" ]; then
      echo "could not determine the VM's IPv4 address" >&2
      exit 1
    fi
  '';
in
{
  networking.hostName = "dsa-k3s";
  system.stateVersion = lib.trivial.release;

  microvm = {
    hypervisor = "vfkit";
    vcpu = lib.mkDefault 4;
    mem = lib.mkDefault 4096;

    # クラスタ状態 (/var/lib/rancher 以下など) を VM 再起動をまたいで保持する。
    # スパースファイルなので実使用分しかホストのディスクを消費しない。
    volumes = [
      {
        image = "var.img";
        mountPoint = "/var";
        size = lib.mkDefault 20480;
      }
    ];

    # kubeconfig 受け渡し用。ホスト側 .k3s/share/ が VM 内 /share に見える。
    shares = [
      {
        tag = "host-share";
        source = "share";
        mountPoint = "/share";
        proto = "virtiofs";
      }
    ];

    # vfkit は user (NAT / vmnet) のみサポート。MAC を固定して DHCP lease
    # (= VM の IP) を安定させる。同じ MAC の VM は同時に 1 台しか起動できない。
    interfaces = [
      {
        type = "user";
        id = "eth0";
        mac = "02:00:00:6b:33:73";
      }
    ];

    # vfkit の control socket。k3s-down が graceful shutdown に使う。
    socket = "control.sock";
  };

  services.k3s = {
    enable = true;
    role = "server";
  };

  networking.firewall = {
    # 6443: ホストから NAT 越しに API サーバーへ接続する。
    # 80/443: Traefik Ingress (ServiceLB がノードの 80/443 で受ける) へのアクセス。
    allowedTCPPorts = [
      6443
      80
      443
    ];
    # Pod/Service 間トラフィック (flannel vxlan / cni bridge) を妨げない。
    trustedInterfaces = [
      "cni0"
      "flannel.1"
    ];
  };

  # ホストは vmnet が割り当てた VM の IP へ直接接続するため、serving cert の
  # SAN に自分の IP を載せる。k3s は /etc/rancher/k3s/config.yaml を自動で読む。
  systemd.services.k3s-tls-san = {
    description = "Write k3s config.yaml with the VM's IP as tls-san";
    wantedBy = [ "multi-user.target" ];
    requiredBy = [ "k3s.service" ];
    before = [ "k3s.service" ];
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    path = with pkgs; [
      iproute2
      gnused
      coreutils
    ];
    script = ''
      ${vmIpScript}
      mkdir -p /etc/rancher/k3s
      cat > /etc/rancher/k3s/config.yaml <<EOF
      tls-san:
        - $vm_ip
      EOF
    '';
  };

  # ホストが /share/images に置いたイメージ tar を containerd (k8s.io namespace)
  # へ取り込む (k3s-load-images が置く)。virtiofs はホスト側の書き込みを inotify
  # で通知しないため、systemd path unit ではなく timer で polling する。
  # プロトコル: ホストは <name>.tar を置き (.tmp からの rename でアトミックに)、
  # 取り込み結果として <name>.ok または <name>.err が現れるのを待つ。
  systemd.services.k3s-image-import = {
    description = "Import image tarballs from /share/images into k3s containerd";
    path = [ pkgs.k3s ];
    serviceConfig.Type = "oneshot";
    script = ''
      dir=/share/images
      [ -d "$dir" ] || exit 0
      for f in "$dir"/*.tar; do
        [ -e "$f" ] || continue
        name="''${f%.tar}"
        if k3s ctr -n k8s.io images import "$f" > "$name.log" 2>&1; then
          mv "$name.log" "$name.ok"
        else
          mv "$name.log" "$name.err"
        fi
        rm -f "$f"
      done
    '';
  };
  systemd.timers.k3s-image-import = {
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnBootSec = "10s";
      OnUnitActiveSec = "2s";
      # 既定の AccuracySec (1min) だと 2s 間隔が丸められるため明示する
      AccuracySec = "1s";
    };
  };

  # k3s が生成した kubeconfig の接続先を VM の IP に書き換えてホストへ公開する。
  systemd.services.k3s-export-kubeconfig = {
    description = "Publish kubeconfig (server rewritten to the VM's IP) to the host share";
    wantedBy = [ "multi-user.target" ];
    wants = [ "k3s.service" ];
    after = [ "k3s.service" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    path = with pkgs; [
      iproute2
      gnused
      coreutils
    ];
    script = ''
      for _ in $(seq 300); do
        [ -s /etc/rancher/k3s/k3s.yaml ] && break
        sleep 1
      done
      if ! [ -s /etc/rancher/k3s/k3s.yaml ]; then
        echo "timed out waiting for /etc/rancher/k3s/k3s.yaml" >&2
        exit 1
      fi
      ${vmIpScript}
      sed "s#https://127.0.0.1:6443#https://$vm_ip:6443#" /etc/rancher/k3s/k3s.yaml > /share/kubeconfig.tmp
      mv /share/kubeconfig.tmp /share/kubeconfig
    '';
  };
}
