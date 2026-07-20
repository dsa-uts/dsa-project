# backend のコンテナイメージ (Linux 専用 derivation)。
# tag は未指定なので derivation hash 由来になり、内容が変われば tag も変わる
# (固定 tag + import 済みイメージで Deployment の rollout が起きない罠を避ける)。
# 出力はイメージ tar を stdout に流すスクリプト:
#   nix build .#backend-image && ./result | k3s ctr -n k8s.io images import -
{ pkgs, backend }:
let
  image = pkgs.dockerTools.streamLayeredImage {
    name = "dsa-backend";
    config = {
      Cmd = [ "${backend}/bin/server" ];
      ExposedPorts."8080/tcp" = { };
    };
  };
in
image
// {
  # tar 実体。macOS ホストが VM の share 経由でイメージを搬入するときに使う
  # (Linux ホストは stream script を直接 containerd へ pipe するので不要)。
  tar = pkgs.runCommand "dsa-backend-image.tar" { } "${image} > $out";
}
