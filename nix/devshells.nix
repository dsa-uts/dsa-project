# devShell 定義。flake.nix から system ごとに import される。
{ pkgs }:
{
  default = pkgs.mkShell {
    packages = with pkgs; [
      # frontend
      nodejs_24
      # backend
      go
      gopls
      # scripts
      nushell
      go-task
      # Kubernetes manifests
      k3s
      kustomize
      kubectl
      kubernetes-helm
      coreutils
      iptables
      ipset
      socat
      conntrack-tools
      ethtool
      kmod
      findutils
      gnugrep
    ];
  };
}
