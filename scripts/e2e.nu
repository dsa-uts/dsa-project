#!/usr/bin/env nu

use kubernetes.nu *

const e2e_namespace = 'dsa-e2e'
const image_specifications = [
  { name: 'dsa-backend', attribute: 'backend-image', label: 'backend' }
  { name: 'dsa-frontend', attribute: 'frontend-image', label: 'frontend' }
  { name: 'dsa-e2e', attribute: 'e2e-image', label: 'E2E' }
]

def repo-root [] {
  $env.FILE_PWD | path join .. | path expand
}

def import-k3d-images [cluster: string, images: list<record>] {
  for image in $images {
    stage import $"Loading ($image.reference) into Docker ..."
    let load = run-external $image.path | ^docker image load | complete
    if $load.exit_code != 0 {
      print-command-result $load
      error make { msg: $"failed to load ($image.reference) into Docker" }
    }
    print-command-result $load
  }

  stage import $"Importing application and test images into k3d cluster/($cluster) ..."
  run-checked 'failed to import images into the k3d cluster' (
    [k3d image import --cluster $cluster] | append ($images | get reference)
  ) | ignore
}

def diagnose-e2e [] {
  stage diagnostics $"Workload and Pod state in namespace ($e2e_namespace) ..."
  let resources = do {
    ^kubectl --namespace $e2e_namespace get statefulset,deployment,job,pods -o wide
  } | complete
  print-command-result $resources

  stage diagnostics 'E2E Job logs ...'
  let logs = do {
    ^kubectl --namespace $e2e_namespace logs job/dsa-e2e --all-containers=true --tail=300
  } | complete
  print-command-result $logs

  for component in [postgresql backend frontend] {
    let selector = $"app.kubernetes.io/component=($component)"
    stage diagnostics $"Current ($component) logs ..."
    let current = do {
      ^kubectl --namespace $e2e_namespace logs --selector $selector --all-containers=true --prefix --tail=200
    } | complete
    print-command-result $current

    stage diagnostics $"Previous ($component) logs, when available ..."
    let previous = do {
      ^kubectl --namespace $e2e_namespace logs --selector $selector --all-containers=true --prefix --tail=200 --previous
    } | complete
    print-command-result $previous
  }

  stage diagnostics 'Recent Kubernetes events ...'
  let events = do {
    ^kubectl --namespace $e2e_namespace get events --sort-by=.metadata.creationTimestamp
  } | complete
  print-command-result $events
}

def remove-e2e-namespace [failure: string] {
  stage cleanup $"Deleting namespace/($e2e_namespace) ..."
  run-checked $failure [
    kubectl delete namespace $e2e_namespace --ignore-not-found --wait=true --timeout=2m
  ] | ignore
}

# Stop the real datastore only after normal tests finish. Reuse the same test
# image and public ingress, with a separate finite Job for outage assertions.
def test-auth-outage [] {
  stage test 'Stopping isolated PostgreSQL to verify authentication failures ...'
  run-checked 'failed to stop E2E PostgreSQL' [
    kubectl --namespace $e2e_namespace scale statefulset/dsa-postgresql --replicas=0
  ] | ignore
  run-checked 'E2E PostgreSQL did not stop' [
    kubectl --namespace $e2e_namespace wait --for=delete pod/dsa-postgresql-0 --timeout=90s
  ] | ignore

  run-checked 'failed to start authentication outage Job' [
    kubectl --namespace $e2e_namespace patch job/dsa-e2e-auth-outage
    --type=merge --patch '{"spec":{"suspend":false}}'
  ] | ignore
  let result = do {
    ^kubectl --namespace $e2e_namespace wait --for=condition=complete job/dsa-e2e-auth-outage --timeout=250s
  } | complete
  ^kubectl --namespace $e2e_namespace logs job/dsa-e2e-auth-outage --all-containers=true --tail=100
  if $result.exit_code != 0 {
    print-command-result $result
    error make { msg: 'authentication outage tests failed' }
  }
}

def main [--k3d-cluster: string] {
  let root = repo-root
  require-cluster
  let images = build-images $root $image_specifications

  if $k3d_cluster == null {
    import-k3s-images $images
  } else {
    import-k3d-images $k3d_cluster $images
  }

  let manifests = render-manifests $root e2e $images

  stage reset $"Replacing namespace/($e2e_namespace) to guarantee clean PostgreSQL state ..."
  run-checked 'failed to reset the E2E namespace' [
    kubectl delete namespace $e2e_namespace --ignore-not-found --wait=true --timeout=2m
  ] | ignore

  stage apply 'Applying the E2E Kubernetes manifests ...'
  let apply = $manifests | ^kubectl apply -f - | complete
  if $apply.exit_code != 0 {
    print-command-result $apply
    remove-e2e-namespace 'failed to apply E2E manifests and then failed to delete the E2E namespace'
    error make { msg: 'failed to apply E2E manifests' }
  }
  print-command-result $apply

  stage test 'Waiting for the finite E2E Job ...'
  mut outcome = 'timeout'
  for _ in 1..300 {
    let state = do {
      ^kubectl --namespace $e2e_namespace get job/dsa-e2e -o 'jsonpath={.status.conditions[?(@.type=="Complete")].status}{"|"}{.status.conditions[?(@.type=="Failed")].status}'
    } | complete
    if $state.exit_code == 0 {
      let value = $state.stdout | str trim
      if $value == 'True|' {
        $outcome = 'complete'
        break
      }
      if $value == '|True' {
        $outcome = 'failed'
        break
      }
    }
    sleep 1sec
  }

  if $outcome != 'complete' {
    diagnose-e2e
    remove-e2e-namespace $"E2E Job ($outcome), and cleanup of namespace/($e2e_namespace) also failed"
    error make { msg: $"E2E Job ($outcome); diagnostics were printed before namespace cleanup" }
  }

  ^kubectl --namespace $e2e_namespace logs job/dsa-e2e --all-containers=true --tail=300
  try {
    test-auth-outage
  } catch { |err|
    diagnose-e2e
    remove-e2e-namespace 'authentication outage tests failed, and namespace cleanup also failed'
    error make { msg: $err.msg }
  }
  remove-e2e-namespace 'E2E tests passed, but failed to delete the E2E namespace'
}
