# Browser runtime and both public-interface test suites in one finite Job image.
{ pkgs, e2e }:
let
  fontsConf = pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; };
in
pkgs.dockerTools.streamLayeredImage {
  name = "dsa-e2e";
  contents = [
    e2e
    pkgs.cacert
    pkgs.playwright-driver.browsers
  ];
  config = {
    Cmd = [ "${e2e}/bin/dsa-e2e" ];
    Env = [
      "FONTCONFIG_FILE=${fontsConf}"
      "PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}"
      "PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true"
    ];
    WorkingDir = "/tmp";
  };
}
