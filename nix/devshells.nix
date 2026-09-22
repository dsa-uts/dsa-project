# Host tools run on macOS or Linux; container outputs always target Linux.
{ pkgs }:
{
  default = pkgs.mkShell (
    {
      packages =
        with pkgs;
        [
          nodejs_24
          go_1_27
          gopls
          nushell
          go-task
          docker-client
          kubernetes-helm
          kustomize
          kubectl
          coreutils
          findutils
          gnugrep
        ]
        ++ lib.optionals stdenv.hostPlatform.isLinux [
          k3d
          playwright-driver.browsers
        ];
    }
    // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
      # Nix Node's system CA lookup does not include the user's OrbStack root.
      # Export only the public certificate; trust installation stays with OrbStack.
      shellHook = ''
        if [ -z "''${NODE_EXTRA_CA_CERTS:-}" ]; then
          dsa_ca_dir="''${XDG_CACHE_HOME:-$HOME/Library/Caches}/dsa-project"
          mkdir -p "$dsa_ca_dir"
          dsa_ca_file=$(mktemp "$dsa_ca_dir/orbstack-ca.XXXXXX")
          if /usr/bin/security find-certificate -c "OrbStack Development Root CA" -p > "$dsa_ca_file"; then
            mv "$dsa_ca_file" "$dsa_ca_dir/orbstack-ca.pem"
            export NODE_EXTRA_CA_CERTS="$dsa_ca_dir/orbstack-ca.pem"
          else
            rm -f "$dsa_ca_file"
          fi
          unset dsa_ca_dir dsa_ca_file
        fi
      '';
    }
    // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
      PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
      FONTCONFIG_FILE = pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; };
    }
  );
}
