#!/usr/bin/env nu

def bao-exec [namespace: string, pod: string, token: string, ...args: string] {
  let command = [kubectl --namespace $namespace exec -i $pod -- sh -c
    'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"' sh]
    | append $args
  let result = $'($token)(char newline)'
    | run-external ...$command
    | complete
  if $result.exit_code != 0 {
    print --stderr $result.stdout
    print --stderr $result.stderr
    error make { msg: $"OpenBao command failed: bao ($args | str join ' ')" }
  }
  $result.stdout
}

def write-policy [namespace: string, pod: string, token: string, name: string, policy: string] {
  let input = [$token $policy] | str join (char newline)
  let command = [kubectl --namespace $namespace exec -i $pod -- sh -c
    'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"'
    sh policy write $name -]
  let result = $input
    | run-external ...$command
    | complete
  if $result.exit_code != 0 {
    print --stderr $result.stdout
    print --stderr $result.stderr
    error make { msg: $"failed to write OpenBao policy ($name)" }
  }
}

def main [environment: string] {
  if $environment not-in [dev prod] {
    error make { msg: 'environment must be dev or prod' }
  }

  let repo_root = $env.FILE_PWD | path join .. | path expand
  let openbao_namespace = $env.DSA_OPENBAO_NAMESPACE? | default openbao
  let app_namespace = $env.DSA_APP_NAMESPACE? | default default
  let pod = $env.DSA_OPENBAO_POD? | default openbao-0
  let token = if $environment == dev {
    $env.BAO_TOKEN? | default development-root-token
  } else {
    $env.BAO_TOKEN? | default ''
  }
  if ($token | is-empty) {
    error make { msg: 'BAO_TOKEN is required for production configuration' }
  }

  let ready = do {
    ^kubectl --namespace $openbao_namespace wait --for=condition=Ready $"pod/($pod)" --timeout=5m
  } | complete
  if $ready.exit_code != 0 {
    print --stderr $ready.stdout
    print --stderr $ready.stderr
    error make { msg: $"OpenBao pod did not become ready: ($openbao_namespace)/($pod)" }
  }

  let secret_mounts = bao-exec $openbao_namespace $pod $token -- secrets list -format=json
  if not ($secret_mounts | str contains '"kv/"') {
    bao-exec $openbao_namespace $pod $token -- secrets enable -path=kv -version=2 kv | ignore
  }
  let auth_mounts = bao-exec $openbao_namespace $pod $token -- auth list -format=json
  if not ($auth_mounts | str contains '"kubernetes/"') {
    bao-exec $openbao_namespace $pod $token -- auth enable kubernetes | ignore
  }
  bao-exec $openbao_namespace $pod $token -- write auth/kubernetes/config kubernetes_host=https://kubernetes.default.svc:443 | ignore

  if $environment == prod {
    let audit_devices = bao-exec $openbao_namespace $pod $token -- audit list -format=json
    if not ($audit_devices | str contains '"file/"') {
      bao-exec $openbao_namespace $pod $token -- audit enable file file_path=/openbao/audit/audit.log | ignore
    }
  }

  for workload in [backend postgresql] {
    let policy_name = $"dsa-($environment)-($workload)"
    let policy_path = $repo_root | path join deploy openbao policies $'($workload).hcl'
    let policy = open --raw $policy_path | str replace --all ENVIRONMENT $environment
    write-policy $openbao_namespace $pod $token $policy_name $policy
    bao-exec $openbao_namespace $pod $token -- write $"auth/kubernetes/role/($policy_name)" $"bound_service_account_names=dsa-($workload)" $"bound_service_account_namespaces=($app_namespace)" $"policies=($policy_name)" audience=openbao ttl=20m | ignore
  }

  if $environment == dev {
    bao-exec $openbao_namespace $pod $token -- kv put kv/dsa/dev/postgresql password=development-password | ignore
  }

  print $"Configured OpenBao policies and Kubernetes roles for ($environment)."
}
