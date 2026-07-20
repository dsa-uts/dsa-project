# frontend のコンテナイメージ (Linux 専用 derivation)。
# static-web-server が Vite のビルド成果物を配信する。
# tag 未指定・stream 形式の理由は backend-image.nix のコメントを参照。
{ pkgs, frontend }:
let
  image = pkgs.dockerTools.streamLayeredImage {
    name = "dsa-frontend";
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
  };
in
image
// {
  # tar 実体。用途は backend-image.nix のコメントを参照。
  tar = pkgs.runCommand "dsa-frontend-image.tar" { } "${image} > $out";
}
