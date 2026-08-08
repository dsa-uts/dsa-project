{ pkgs }:
let
  inherit (pkgs) lib;
  dependencyTool = ../scripts/backend-deps.sh;
  toApp = drv: {
    type = "app";
    program = lib.getExe drv;
    meta.description = drv.meta.description or "";
  };
  mkDependencyApp =
    operation: description:
    toApp (
      pkgs.writeShellApplication {
        name = "backend-deps-${operation}";
        meta.description = description;
        runtimeInputs = [ pkgs.nix ];
        text = ''
          exec ${dependencyTool} ${operation} --repo-root "$PWD"
        '';
      }
    );
in
{
  backend-deps-refresh = mkDependencyApp "refresh" "Refresh the backend Nix dependency hash";
  backend-deps-check = mkDependencyApp "check" "Check backend Nix dependency metadata without modifying it";
  backend-image-build = toApp (
    pkgs.writeShellApplication {
      name = "backend-image-build";
      meta.description = "Refresh backend dependency metadata and build the backend container image";
      runtimeInputs = [ pkgs.nix ];
      text = ''
        ${dependencyTool} refresh --repo-root "$PWD"
        exec nix build .#backend-image "$@"
      '';
    }
  );
}
