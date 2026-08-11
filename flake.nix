{
  description = "DSA project monorepo (online judge): frontend / backend / chart";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      eachSystem = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      packagesFor = eachSystem (
        pkgs:
        let
          backend = import ./nix/backend.nix { inherit pkgs; };
          frontend = import ./nix/frontend.nix { inherit pkgs; };
        in
        {
          inherit backend frontend;
          backend-image = import ./nix/backend-image.nix { inherit pkgs backend; };
          frontend-image = import ./nix/frontend-image.nix { inherit pkgs frontend; };
        }
      );
    in
    {
      devShells = eachSystem (pkgs: import ./nix/devshells.nix { inherit pkgs; });
      formatter = eachSystem (pkgs: pkgs.nixfmt);

      packages = packagesFor;

      apps = lib.genAttrs systems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          backend = {
            type = "app";
            program = "${self.packages.${system}.backend}/bin/server";
          };
        }
        // import ./nix/backend-deps-apps.nix { inherit pkgs; }
        // import ./nix/k3s-apps.nix {
          inherit pkgs;
        }
      );

      # checks は packages から合成する。go test / vitest は各 derivation の checkPhase で走る。
      # chart-check は helm lint / template によるオフライン検証。
      checks = eachSystem (
        pkgs:
        packagesFor.${pkgs.stdenv.hostPlatform.system}
        // {
          chart = import ./nix/chart-check.nix { inherit pkgs; };
        }
      );
    };
}
