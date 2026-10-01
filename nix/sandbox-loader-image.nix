{ pkgs }:

pkgs.dockerTools.buildLayeredImage {
  name = "dsa-sandbox-loader";
  tag = "latest";

  contents = [
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
