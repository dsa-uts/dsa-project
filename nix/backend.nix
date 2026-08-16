# backend バイナリ。flake.nix から system ごとに import される。
# vendorHash は task backend:deps:refresh で更新する。
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
  ldflags = [
    "-s"
    "-w"
  ];
}
