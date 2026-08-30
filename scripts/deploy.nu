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
const image_specifications = [
  { name: 'dsa-backend', attribute: 'backend-image', label: 'backend' }
  { name: 'dsa-frontend', attribute: 'frontend-image', label: 'frontend' }
]

def repo-root [] {
  $env.FILE_PWD | path join .. | path expand
}

def component-logs [component: string] {
  let selector = $"app.kubernetes.io/component=($component)"
  stage logs $"Current logs for ($component) ..."
  let current = do {
    ^kubectl --namespace $development_namespace logs --selector $selector --all-containers=true --prefix --tail=200
  } | complete
  print-command-result $current

  stage logs $"Previous container logs for ($component), when available ..."
  let previous = do {
    ^kubectl --namespace $development_namespace logs --selector $selector --all-containers=true --prefix --tail=200 --previous
  } | complete
  print-command-result $previous
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
    component-logs $selected
  }
}

def main [] {
  error make { msg: 'usage: task {deploy|status|logs|reset}' }
}

def 'main deploy' [] {
  let root = repo-root
  require-cluster
  let images = build-images $root $image_specifications
  import-k3s-images $images
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

  stage readiness 'Waiting for all application Pods to become Ready ...'
  let readiness = do {
    ^kubectl --namespace $development_namespace wait pod $"--selector=($application_selector)" --for=condition=Ready --timeout=5m
  } | complete
  if $readiness.exit_code != 0 {
    print-command-result $readiness
    diagnose-development
    error make { msg: 'application Pods did not become Ready' }
  }
  print-command-result $readiness

  let node_ip = ^kubectl get nodes -o 'jsonpath={.items[0].status.addresses[?(@.type=="InternalIP")].address}'
  print ''
  stage ready $"Open: http://($node_ip)/"
}

def 'main status' [] {
  require-cluster
  development-status
}

def 'main logs' [component: string = 'all'] {
  if $component != 'all' and $component not-in $components {
    error make { msg: $"unknown component '($component)'; expected one of: ($components | str join ', '), all" }
  }
  require-cluster
  let selected_components = if $component == 'all' { $components } else { [$component] }
  for selected in $selected_components {
    component-logs $selected
  }
}

def 'main reset' [] {
  require-cluster
  stage reset $"Deleting namespace/($development_namespace) and its development data ..."
  ^kubectl delete namespace $development_namespace --ignore-not-found --wait=true
}
