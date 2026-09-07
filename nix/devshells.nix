# devShell 定義
{ pkgs }:
{
  default = pkgs.mkShell {
    PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
    FONTCONFIG_FILE = pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; };
    packages = with pkgs; [
      # frontend
      nodejs_24
      playwright-driver.browsers
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
