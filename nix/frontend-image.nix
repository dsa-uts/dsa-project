{ pkgs, frontend }:
pkgs.dockerTools.buildLayeredImage {
  name = "dsa-frontend";
  tag = "latest";
  config = {
    Cmd = [
      "${pkgs.static-web-server}/bin/static-web-server"
      "--root"
      "${frontend}"
      "--port"
      "8080"
      # SPA ルーティング: 存在しないパスは index.html にフォールバックする
      "--page-fallback"
      "${frontend}/index.html"
    ];
    ExposedPorts."8080/tcp" = { };
  };
}
