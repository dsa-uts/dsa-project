# backend のコンテナイメージ (Linux 専用 derivation)。
# tag は未指定なので derivation hash 由来になり、内容が変われば tag も変わる
# (固定 tag + import 済みイメージで Deployment の rollout が起きない罠を避ける)。
# Linux builder generates the complete tar; macOS loads it without executing Linux code.
{ pkgs, backend }:
pkgs.dockerTools.buildLayeredImage {
  name = "dsa-backend";
  config = {
    Cmd = [ "${backend}/bin/server" ];
    Env = [ "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt" ];
    ExposedPorts."8080/tcp" = { };
  };
}
