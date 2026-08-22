{ pkgs }:
let
  deploy = ../deploy;
in
pkgs.runCommand "dsa-kustomize-build-check" { nativeBuildInputs = [ pkgs.kustomize ]; } ''
  mkdir -p $out
  kustomize build ${deploy}/base > $out/base.yaml
  kustomize build ${deploy}/overlays/local > $out/local.yaml
  kustomize build ${deploy}/overlays/production > $out/production.yaml
  kustomize build ${deploy}/overlays/e2e > $out/e2e.yaml
''
