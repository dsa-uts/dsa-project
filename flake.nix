{
  description = "DSA development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    devshell.url = "github:numtide/devshell";
    devshell.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { nixpkgs, devshell, ... }: {
    devShells = nixpkgs.lib.genAttrs [ "aarch64-darwin" "x86_64-linux" ] (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        default = devshell.legacyPackages.${system}.mkShell {
          name = "dsa";
          packages = with pkgs; [
            go_1_26
            air
            go-swag
            nodejs_24
            rustc
            cargo
            stdenv.cc
            python3
            go-task
            nushell
            nufmt
          ];
        };
      }
    );
  };
}
