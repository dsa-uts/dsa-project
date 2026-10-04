{
  description = "DSA project monorepo (online judge): frontend / backend / Kubernetes manifests";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    {
      nixpkgs,
      ...
    }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      eachSystem = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = eachSystem (pkgs: import ./nix/devshells.nix { inherit pkgs; });
      formatter = eachSystem (pkgs: pkgs.nixfmt);
    };
}
