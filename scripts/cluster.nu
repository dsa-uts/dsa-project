#!/usr/bin/env nu
use kubernetes.nu *

def 'main setup' [--k3d-cluster: string] {
  let context = if $k3d_cluster == null { 'orbstack' } else { $"k3d-($k3d_cluster)" }
  require-cluster $context
  let config = $env.FILE_PWD | path join .. deploy traefik | path expand
  let version = open --raw ($config | path join chart-version) | str trim
  stage ingress $"Installing/updating Traefik chart ($version) ..."
  run-checked 'failed to install Traefik' [
    helm upgrade --install traefik traefik
    --repo https://traefik.github.io/charts
    --version $version --values ($config | path join values.yaml)
    --kube-context $context --namespace dsa-ingress --create-namespace
    --skip-crds --wait --timeout 5m
  ] | print
}

def main [] { help main }
