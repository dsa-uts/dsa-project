# backend バイナリ。flake.nix から system ごとに import される。
# go.mod / go.sum を変更したら vendorHash を更新すること
# (lib.fakeHash に置き換えて nix build し、エラーに出る正しい hash を貼り直す)。
{ pkgs }:
pkgs.buildGoModule {
  pname = "dsa-backend";
  version = "0.1.0";
  src = ../backend;
  vendorHash = "sha256-vyYkvxfSQPZerY7PDjaxF6IaIypMGTnmWT/kSzFl9w4=";
  env.CGO_ENABLED = 0;
  # nix sandbox では Docker が使えないため、testcontainers を使う DB テストは
  # skip する (-short)。DB テストは GitHub Actions の codegen-and-db-test job で回す。
  checkFlags = [ "-short" ];
  ldflags = [
    "-s"
    "-w"
  ];
}
