{
  description = "DSA project monorepo (online judge): frontend / backend / chart";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    microvm = {
      url = "github:microvm-nix/microvm.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      microvm,
    }:
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
      # シングルノード k3s VM (ADR 0008)。macOS ホスト専用で、Linux ホストは
      # VM を使わず k3s-up がホスト直接起動する (nix/k3s-apps.nix)。
      # vfkit はホストとゲストのアーキテクチャ一致を要求するため aarch64-linux 固定。
      k3sVm = lib.nixosSystem {
        system = "aarch64-linux";
        modules = [
          microvm.nixosModules.microvm
          ./nix/k3s-vm.nix
          { microvm.vmHostPackages = nixpkgs.legacyPackages.aarch64-darwin; }
        ];
      };
    in
    {
      devShells = eachSystem (pkgs: import ./nix/devshells.nix { inherit pkgs; });
      formatter = eachSystem (pkgs: pkgs.nixfmt);

      nixosConfigurations.dsa-k3s = k3sVm;

      # darwin の *-image と k3s-vm は aarch64-linux の derivation を含む。
      # macOS からのビルドには linux builder が必要 (README 参照)。
      packages = packagesFor // {
        aarch64-darwin = packagesFor.aarch64-darwin // {
          backend-image = packagesFor.aarch64-linux.backend-image;
          frontend-image = packagesFor.aarch64-linux.frontend-image;
          k3s-vm = k3sVm.config.microvm.declaredRunner;
        };
      };

      apps = lib.genAttrs systems (
        system:
        {
          backend = {
            type = "app";
            program = "${self.packages.${system}.backend}/bin/server";
          };
        }
        // import ./nix/k3s-apps.nix {
          pkgs = nixpkgs.legacyPackages.${system};
          k3sVmRunner = k3sVm.config.microvm.declaredRunner;
        }
      );

      # checks は packages から合成する。go test / vitest は各 derivation の checkPhase で走る。
      # darwin では *-image を含めない (linux builder 無しでも nix flake check が通るように)。
      checks = packagesFor;
    };
}
