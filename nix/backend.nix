# backend バイナリ。flake.nix から system ごとに import される。
# go.mod / go.sum を変更したら vendorHash を更新すること
# (lib.fakeHash に置き換えて nix build し、エラーに出る正しい hash を貼り直す)。
{ pkgs }:
pkgs.buildGoModule {
  pname = "dsa-backend";
  version = "0.1.0";
  src = ../backend;
  vendorHash = "sha256-6EcPVCtwuOygYw1DLIbu97EGVMD1KCHGzp8b8UL2CpA=";
  env.CGO_ENABLED = 0;
  ldflags = [
    "-s"
    "-w"
  ];
}
