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
        in
        {
          inherit backend;
        }
        // lib.optionalAttrs pkgs.stdenv.isLinux {
          backend-image = import ./nix/backend-image.nix { inherit pkgs backend; };
        }
      );
    in
    {
      devShells = eachSystem (pkgs: import ./nix/devshells.nix { inherit pkgs; });
      formatter = eachSystem (pkgs: pkgs.nixfmt);

      # darwin の backend-image は aarch64-linux の derivation を指す。
      # macOS からのビルドには linux builder が必要 (README 参照)。
      packages = packagesFor // {
        aarch64-darwin = packagesFor.aarch64-darwin // {
          backend-image = packagesFor.aarch64-linux.backend-image;
        };
      };

      apps = lib.genAttrs systems (system: {
        backend = {
          type = "app";
          program = "${self.packages.${system}.backend}/bin/server";
        };
      });

      # checks は packages から合成する。go test は buildGoModule の checkPhase で走る。
      # darwin では backend-image を含めない (linux builder 無しでも nix flake check が通るように)。
      checks = packagesFor;
    };
}
