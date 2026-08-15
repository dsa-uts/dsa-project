#!/usr/bin/env nu

const openbao_chart_version = '0.29.1'
const csi_driver_version = '1.6.0'

def run-checked [description: string, args: list<string>] {
  let result = run-external ...$args | complete
  if $result.exit_code != 0 {
    print --stderr $result.stdout
    print --stderr $result.stderr
    error make { msg: $description }
  }
}

def main [environment: string] {
  if $environment not-in [dev prod] {
    error make { msg: 'environment must be dev or prod' }
  }

  let repo_root = $env.FILE_PWD | path join .. | path expand
  let namespace = $env.DSA_OPENBAO_NAMESPACE? | default openbao
  let values_environment = if $environment == dev { local } else { production }
  let values = $repo_root | path join deploy openbao $'($values_environment)-values.yaml'

  if $environment == prod {
    let tls_secret = do {
      ^kubectl --namespace $namespace get secret openbao-server-tls
    } | complete
    if $tls_secret.exit_code != 0 {
      error make {
        msg: (
          [
            $"openbao-server-tls is required in namespace ($namespace) before production install."
            'It must contain tls.crt, tls.key, and ca.crt.'
          ] | str join (char newline)
        )
      }
    }
  }

  run-checked 'failed to install Secrets Store CSI Driver' [
    helm upgrade --install secrets-store-csi-driver secrets-store-csi-driver
    --repo https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts
    --version $csi_driver_version --namespace kube-system
    --set 'tokenRequests[0].audience=openbao' --set enableSecretRotation=false
    --wait --timeout 5m
  ]

  let openbao_args = [
    helm upgrade --install openbao oci://ghcr.io/openbao/charts/openbao
    --version $openbao_chart_version --namespace $namespace --create-namespace
    --values $values
  ]
  let install_args = if $environment == dev {
    $openbao_args | append [--wait --timeout 5m]
  } else {
    $openbao_args
  }
  run-checked 'failed to install OpenBao' $install_args
}
