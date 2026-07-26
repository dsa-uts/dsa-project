# streamLayeredImage に tar 実体を付与する共通ヘルパー。
# tar は macOS ホストが VM の share 経由でイメージを搬入するときに使う
# (Linux ホストは stream script を直接 containerd へ pipe するので不要)。
{ pkgs }:
image:
image
// {
  tar = pkgs.runCommand "${image.imageName}-image.tar" { } "${image} > $out";
}
