#!/usr/bin/env nu

def main [datastore: string] {
  if $datastore != postgresql {
    error make { msg: 'datastore must be postgresql' }
  }

  let token = $env.BAO_TOKEN? | default ''
  if ($token | is-empty) {
    error make { msg: 'BAO_TOKEN is required' }
  }
  let namespace = $env.DSA_OPENBAO_NAMESPACE? | default openbao
  let pod = $env.DSA_OPENBAO_POD? | default openbao-0

  let check_command = [kubectl --namespace $namespace exec -i $pod -- sh -c
    'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao kv get "kv/dsa/prod/$1"'
    sh $datastore]
  let check = $'($token)(char newline)' | run-external ...$check_command | complete
  if $check.exit_code == 0 {
    error make {
      msg: $"kv/dsa/prod/($datastore) already exists; this command is for initial bootstrap only"
    }
  }
  let check_output = [$check.stdout $check.stderr] | str join (char newline)
  if not ($check_output | str contains 'No value found') {
    print --stderr $check_output
    error make { msg: 'could not verify that the production secret is absent' }
  }

  let password = input --suppress-output $"($datastore) password: "
  if not ($password =~ '^[A-Za-z0-9_-]+$') {
    error make { msg: 'password must contain only A-Z, a-z, 0-9, _ or -' }
  }

  let command_input = [$token $password] | str join (char newline)
  let command = [kubectl --namespace $namespace exec -i $pod -- sh -c
    'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao kv put "kv/dsa/prod/$1" password=-'
    sh $datastore]
  let result = $command_input
    | run-external ...$command
    | complete
  if $result.exit_code != 0 {
    print --stderr $result.stdout
    print --stderr $result.stderr
    error make { msg: $"failed to update production ($datastore) secret" }
  }

  print $"Created initial kv/dsa/prod/($datastore)."
}
