#!/usr/bin/env nu

use kubernetes.nu *

const development_namespace = 'dsa-dev'
const application_selector = 'app.kubernetes.io/name=dsa'
const development_workloads = [
  { resource: 'statefulset/dsa-postgresql', component: 'postgresql' }
  { resource: 'deployment/dsa-backend', component: 'backend' }
  { resource: 'deployment/dsa-frontend', component: 'frontend' }
]
const components = $development_workloads.component

def repo-root [] {
  $env.FILE_PWD | path join .. | path expand
}

def development-status [] {
  stage status $"Workload and Pod state in namespace ($development_namespace) ..."
  let resources = do {
    ^kubectl --namespace $development_namespace get statefulset,deployment,pods -o wide
  } | complete
  print-command-result $resources

  stage status 'Rollout state ...'
  for workload in $development_workloads {
    let rollout = do {
      ^kubectl --namespace $development_namespace rollout status $workload.resource --timeout=1s
    } | complete
    print-command-result $rollout
  }
}

def diagnose-development [component?: string] {
  print --stderr ''
  development-status

  stage diagnostics 'Recent Kubernetes events ...'
  let events = do {
    ^kubectl --namespace $development_namespace get events --sort-by=.metadata.creationTimestamp
  } | complete
  print-command-result $events

  let selected_components = if $component == null { $components } else { [$component] }
  for selected in $selected_components {
    component-logs $development_namespace $selected
  }
}

def main [] {
  error make { msg: 'usage: task {deploy|status|logs|reset}' }
}

def 'main deploy' [] {
  let root = repo-root
  require-cluster orbstack
  let images = build-images $root $image_specifications --system (cluster-image-system)
  import-orbstack-images $images
  let manifests = render-manifests $root dev $images

  stage apply 'Applying the development Kubernetes manifests ...'
  let apply = $manifests | ^kubectl apply -f - | complete
  if $apply.exit_code != 0 {
    print-command-result $apply
    diagnose-development
    error make { msg: 'failed to apply development Kubernetes manifests' }
  }
  print-command-result $apply

  for workload in $development_workloads {
    stage rollout $"Waiting for ($workload.resource) ..."
    let rollout = do {
      ^kubectl --namespace $development_namespace rollout status $workload.resource --timeout=5m
    } | complete
    if $rollout.exit_code != 0 {
      print-command-result $rollout
      diagnose-development $workload.component
      error make { msg: $"rollout failed for ($workload.resource)" }
    }
    print-command-result $rollout
  }

  stage readiness 'Waiting for current application Pods to become Ready ...'
  # A completed rollout can still leave terminating Pods in the selector.
  # Waiting on those Pods can time out after they have already been deleted.
  let pods = run-checked 'failed to list application Pods' [
    kubectl --namespace $development_namespace get pods $"--selector=($application_selector)" -o json
  ] | from json | get items
    | where { |pod| $pod.metadata.deletionTimestamp? == null }
    | each { |pod| $"pod/($pod.metadata.name)" }
  if ($pods | is-empty) { error make { msg: 'no current application Pods found' } }
  let readiness = do {
    ^kubectl --namespace $development_namespace wait ...$pods --for=condition=Ready --timeout=5m
  } | complete
  if $readiness.exit_code != 0 {
    print-command-result $readiness
    diagnose-development
    error make { msg: 'application Pods did not become Ready' }
  }
  print-command-result $readiness

  print ''
  stage ready 'Open: https://dsa.k8s.orb.local'
}

def 'main status' [] {
  require-cluster orbstack
  development-status
}

def 'main logs' [component: string = 'all'] {
  if $component != 'all' and $component not-in $components {
    error make { msg: $"unknown component '($component)'; expected one of: ($components | str join ', '), all" }
  }
  require-cluster orbstack
  let selected_components = if $component == 'all' { $components } else { [$component] }
  for selected in $selected_components {
    component-logs $development_namespace $selected
  }
}

def 'main reset' [] {
  require-cluster orbstack
  stage reset $"Deleting namespace/($development_namespace) and its development data ..."
  ^kubectl delete namespace $development_namespace --ignore-not-found --wait=true
}
