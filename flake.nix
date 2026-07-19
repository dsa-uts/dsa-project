{
  description = "DSA project monorepo (online judge): frontend / backend / chart";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
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
        }
        // lib.optionalAttrs pkgs.stdenv.isLinux {
          backend-image = import ./nix/backend-image.nix { inherit pkgs backend; };
          frontend-image = import ./nix/frontend-image.nix { inherit pkgs frontend; };
        }
      );
    in
    {
      devShells = eachSystem (pkgs: import ./nix/devshells.nix { inherit pkgs; });
      formatter = eachSystem (pkgs: pkgs.nixfmt);

      # darwin の *-image は aarch64-linux の derivation を指す。
      # macOS からのビルドには linux builder が必要 (README 参照)。
      packages = packagesFor // {
        aarch64-darwin = packagesFor.aarch64-darwin // {
          backend-image = packagesFor.aarch64-linux.backend-image;
          frontend-image = packagesFor.aarch64-linux.frontend-image;
        };
      };

      apps = lib.genAttrs systems (system: {
        backend = {
          type = "app";
          program = "${self.packages.${system}.backend}/bin/server";
        };
      });

      # checks は packages から合成する。go test / vitest は各 derivation の checkPhase で走る。
      # darwin では *-image を含めない (linux builder 無しでも nix flake check が通るように)。
      checks = packagesFor;
    };
}
