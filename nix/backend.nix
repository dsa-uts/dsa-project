# backend バイナリ。flake.nix から system ごとに import される。
# vendorHash は nix run .#backend-deps-refresh で更新する。
{
  pkgs,
  vendorHash ? import ./backend-vendor-hash.nix,
}:
pkgs.buildGoModule {
  pname = "dsa-backend";
  version = "0.1.0";
  src = ../backend;
  inherit vendorHash;
  env.CGO_ENABLED = 0;
  # nix sandbox では Docker が使えないため、testcontainers を使う DB テストは
  # skip する (-short)。DB テストは GitHub Actions の codegen-and-db-test job で回す。
  checkFlags = [ "-short" ];
  ldflags = [
    "-s"
    "-w"
  ];
}
