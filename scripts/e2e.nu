#!/usr/bin/env nu

use kubernetes.nu *

const e2e_namespace = 'dsa-e2e'

def repo-root [] {
  $env.FILE_PWD | path join .. | path expand
}

def import-k3d-images [cluster: string, images: list<record>] {
  for image in $images {
    stage import $"Loading ($image.reference) into Docker ..."
    let load = do { ^docker image load --input $image.path } | complete
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
    component-logs $e2e_namespace $component
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
  let context = if $k3d_cluster == null { 'orbstack' } else { $"k3d-($k3d_cluster)" }
  require-cluster $context
  let images = build-images $root $image_specifications --system (cluster-image-system)
  if $k3d_cluster == null {
    import-orbstack-images $images
  } else {
    import-k3d-images $k3d_cluster $images
  }
  let overlay = if $k3d_cluster == null { 'e2e' } else { 'e2e-ci' }
  let manifests = render-manifests $root $overlay $images
  stage apply 'Applying E2E manifests without deleting existing data ...'
  let result = $manifests | ^kubectl apply -f - | complete
  print-command-result $result
  if $result.exit_code != 0 { error make { msg: 'failed to apply E2E manifests; environment retained' } }
  wait-for-application
  let default_url = if $k3d_cluster == null { 'https://dsa-e2e.k8s.orb.local' } else { 'http://e2e.localhost:8080' }
  let url = $env.E2E_BASE_URL? | default $default_url
  stage ready $"E2E: ($url)"
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

def "main diagnostics" [] { require-cluster; diagnose-e2e }

def "main down" [] {
  require-cluster
  run-checked 'failed to delete the E2E namespace' [
    kubectl delete namespace $e2e_namespace --ignore-not-found --wait=true --timeout=2m
  ] | print
}

def main [] { help main }
