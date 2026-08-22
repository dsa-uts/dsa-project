{
  description = "DSA project monorepo (online judge): frontend / backend / Kubernetes manifests";

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
          e2e = import ./nix/e2e.nix { inherit pkgs; };
        in
        {
          inherit backend frontend e2e;
          backend-image = import ./nix/backend-image.nix { inherit pkgs backend; };
          frontend-image = import ./nix/frontend-image.nix { inherit pkgs frontend; };
          e2e-image = import ./nix/e2e-image.nix { inherit pkgs e2e; };
          kustomize-build = import ./nix/kustomize-check.nix { inherit pkgs; };
        }
      );
    in
    {
      devShells = eachSystem (pkgs: import ./nix/devshells.nix { inherit pkgs; });
      formatter = eachSystem (pkgs: pkgs.nixfmt);

      packages = packagesFor;

      apps = lib.genAttrs systems (system: {
        backend = {
          type = "app";
          program = "${self.packages.${system}.backend}/bin/server";
        };
      });

      # go test / vitest は各 derivation の checkPhase で走る。
      checks = eachSystem (pkgs: packagesFor.${pkgs.stdenv.hostPlatform.system});
    };
}
