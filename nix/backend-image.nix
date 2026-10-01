{ pkgs, backend }:
pkgs.dockerTools.buildLayeredImage {
  name = "dsa-backend";
  tag = "latest";
  config = {
    Cmd = [ "${backend}/bin/server" ];
    Env = [ "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt" ];
    ExposedPorts."8080/tcp" = { };
  };
}
