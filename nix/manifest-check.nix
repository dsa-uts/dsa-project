# Kubernetes manifest の静的検証 (nix flake check で走る)。検査本体は
# Taskfile と共有する Nushell script に置く。
{ pkgs }:
pkgs.runCommand "manifest-check"
  {
    nativeBuildInputs = [
      pkgs.coreutils
      pkgs.kubectl
      pkgs.kustomize
      pkgs.nushell
    ];
  }
  ''
    nu ${../scripts/manifests.nu} check --repo-root ${../.} --output $out
  ''
