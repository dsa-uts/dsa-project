#!/usr/bin/env nu

use kubernetes.nu *

const e2e_namespace = 'dsa-e2e'
const image_specifications = [
  { name: 'dsa-backend', attribute: 'backend-image', label: 'backend' }
  { name: 'dsa-frontend', attribute: 'frontend-image', label: 'frontend' }
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

  stage import $"Importing application images into k3d cluster/($cluster) ..."
  run-checked 'failed to import images into the k3d cluster' (
    [k3d image import --cluster $cluster] | append ($images | get reference)
  ) | ignore
}

def diagnose-e2e [] {
  stage diagnostics $"Workload and Pod state in namespace ($e2e_namespace) ..."
  let resources = do {
    ^kubectl --namespace $e2e_namespace get statefulset,deployment,pods -o wide
  } | complete
  print-command-result $resources

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

def wait-for-application [] {
  for resource in [statefulset/dsa-postgresql deployment/dsa-backend deployment/dsa-frontend] {
    run-checked $"($resource) did not become ready" [
      kubectl --namespace $e2e_namespace rollout status $resource --timeout=120s
    ] | print
  }
}

def "main up" [--k3d-cluster: string] {
  let root = repo-root
  require-cluster
  let images = build-images $root $image_specifications
  if $k3d_cluster == null {
    import-k3s-images $images
  } else {
    import-k3d-images $k3d_cluster $images
  }
  let manifests = render-manifests $root e2e $images
  stage apply 'Applying E2E manifests without deleting existing data ...'
  let result = $manifests | ^kubectl apply -f - | complete
  print-command-result $result
  if $result.exit_code != 0 { error make { msg: 'failed to apply E2E manifests; environment retained' } }
  wait-for-application
}

# Only this explicit command clears the database. Restarting the backend applies
# migrations and the development seed using the same startup path as deployment.
def "main reset" [] {
  require-cluster
  run-checked 'failed to stop E2E backend' [kubectl -n $e2e_namespace scale deployment/dsa-backend --replicas=0] | print
  let reset = try {
    run-checked 'E2E backend did not stop' [kubectl -n $e2e_namespace wait --for=delete pod -l app.kubernetes.io/component=backend --timeout=90s] | ignore
    run-checked 'failed to reset E2E database' [
      kubectl -n $e2e_namespace exec statefulset/dsa-postgresql --
      psql -U dsa -d dsa -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
    ] | print
    null
  } catch { |err| $err.msg }
  let restore = do { ^kubectl -n $e2e_namespace scale deployment/dsa-backend --replicas=1 } | complete
  print-command-result $restore
  if $reset != null { print --stderr $reset }
  if $restore.exit_code != 0 { error make { msg: 'failed to restore E2E backend after reset' } }
  wait-for-application
  if $reset != null { error make { msg: $reset } }
}

def "main diagnostics" [] { diagnose-e2e }

def "main down" [] {
  run-checked 'failed to delete the E2E namespace' [
    kubectl delete namespace $e2e_namespace --ignore-not-found --wait=true --timeout=2m
  ] | print
}

def main [] { help main }
