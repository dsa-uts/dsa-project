{ pkgs, watchdog }:

pkgs.dockerTools.buildLayeredImage {
  name = "dsa-sandbox-loader";

  contents = [
    watchdog
    pkgs.coreutils
    pkgs.gnutar
  ];

  config = {
    Cmd = [
      "/bin/sleep"
      "infinity"
    ];
    Env = [ "PATH=/bin" ];
  };
}
