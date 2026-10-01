{ pkgs }:

pkgs.pkgsStatic.rustPlatform.buildRustPackage {
  pname = "dsa-watchdog";
  version = "0.1.0";

  src = pkgs.lib.cleanSourceWith {
    src = ../sandbox/watchdog;
    filter = path: type:
      baseNameOf path != "target"
      && pkgs.lib.cleanSourceFilter path type;
  };

  cargoLock.lockFile = ../sandbox/watchdog/Cargo.lock;

  strictDeps = true;
}
