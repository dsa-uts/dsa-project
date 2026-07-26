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

    # kubeconfig と SSH 鍵の受け渡し用。ホスト側 .k3s/share/ が VM 内 /share に見える。
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
    # 22: ホストからの SSH (image import と VM 内の調査に使う)。
    # 6443: ホストから NAT 越しに API サーバーへ接続する。
    # 80/443: Traefik Ingress (ServiceLB がノードの 80/443 で受ける) へのアクセス。
    allowedTCPPorts = [
      22
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

  # ホストからの SSH 受け口。k3s-load-images がイメージ tar を
  # `k3s ctr images import -` へストリームするのと、k3s-ssh での調査に使う。
  # 認証は鍵のみ。クライアント公開鍵は k3s-up が VM 起動前に
  # /share/ssh/authorized_keys へ置く (リポジトリに鍵は含めない)。
  services.openssh = {
    enable = true;
    settings = {
      PermitRootLogin = "prohibit-password";
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
    };
  };

  # ホストの公開鍵を share から root の authorized_keys へインストールする。
  # sshd は StrictModes で authorized_keys の所有権を検査するため、virtiofs 上の
  # ファイルを直接参照させず boot 時にコピーする。
  systemd.services.ssh-install-authorized-keys = {
    description = "Install the host's SSH public key from the share";
    wantedBy = [ "multi-user.target" ];
    requiredBy = [ "sshd.service" ];
    before = [ "sshd.service" ];
    unitConfig.RequiresMountsFor = [ "/share" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      install -d -m 700 /root/.ssh
      install -m 600 /share/ssh/authorized_keys /root/.ssh/authorized_keys
    '';
  };

  # sshd のホスト公開鍵を share へ公開する。ホスト側はこれと VM の IP から
  # known_hosts を組み立てて厳密検証する (TOFU をしない)。
  systemd.services.ssh-export-host-key = {
    description = "Publish the sshd host public key to the host share";
    wantedBy = [ "multi-user.target" ];
    wants = [ "sshd.service" ];
    after = [ "sshd.service" ];
    unitConfig.RequiresMountsFor = [ "/share" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      cp /etc/ssh/ssh_host_ed25519_key.pub /share/ssh/host_key.pub.tmp
      mv /share/ssh/host_key.pub.tmp /share/ssh/host_key.pub
    '';
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
