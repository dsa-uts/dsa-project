{ pkgs, backend }:
pkgs.dockerTools.buildLayeredImage {
  name = "dsa-judge";
  config = {
    Cmd = [ "${backend}/bin/judge" ];
    Env = [ "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-certificates.crt" ];
  };
}
