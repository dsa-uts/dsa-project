{ pkgs }:
let
  deploy = ../deploy;
in
pkgs.runCommand "dsa-kustomize-build-check" { nativeBuildInputs = [ pkgs.kustomize ]; } ''
  mkdir -p $out
  kustomize build ${deploy}/base > $out/base.yaml
  kustomize build ${deploy}/overlays/dev > $out/dev.yaml
  kustomize build ${deploy}/overlays/e2e > $out/e2e.yaml
  kustomize build ${deploy}/overlays/e2e-ci > $out/e2e-ci.yaml
''
