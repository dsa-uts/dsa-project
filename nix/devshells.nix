# devShell 定義
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
      k3d
      kustomize
      kubectl
      coreutils
      util-linux
      findutils
      gnugrep
    ];
  };
}
