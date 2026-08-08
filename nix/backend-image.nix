# backend のコンテナイメージ (Linux 専用 derivation)。
# tag は未指定なので derivation hash 由来になり、内容が変われば tag も変わる
# (固定 tag + import 済みイメージで Deployment の rollout が起きない罠を避ける)。
# 出力はイメージ tar を stdout に流すスクリプト:
#   nix build .#backend-image && ./result | k3s ctr -n k8s.io images import -
{ pkgs, backend }:
pkgs.dockerTools.streamLayeredImage {
  name = "dsa-backend";
  config = {
    Cmd = [ "${backend}/bin/server" ];
    ExposedPorts."8080/tcp" = { };
  };
}
