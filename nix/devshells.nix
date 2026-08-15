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
      # Kubernetes manifests
      kustomize
      kubectl
      kubernetes-helm
    ];
  };
}
