#!/usr/bin/env nu

const development_namespace = 'dsa-dev'
const e2e_namespace = 'dsa-e2e'
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

def run-checked [description: string, args: list<string>] {
  let result = run-external ...$args | complete
  if $result.exit_code != 0 {
    print --stderr $result.stdout
    print --stderr $result.stderr
    error make { msg: $description }
  }
  $result.stdout
}

def stage [name: string, message: string] {
  print $"[($name)] ($message)"
}

def require-cluster [] {
  let config = $env.KUBECONFIG? | default ''
  if ($config | str trim | is-empty) {
    error make { msg: 'KUBECONFIG is required; point it at the externally managed k3s cluster' }
  }
  if not ($config | path exists) or (($config | path type) != file) {
    error make { msg: $"KUBECONFIG does not name a readable file: ($config)" }
  }
  let connection = do { ^kubectl --request-timeout=5s get --raw=/readyz } | complete
  if $connection.exit_code != 0 {
    print --stderr ($connection.stderr | str trim)
    error make { msg: 'the Kubernetes cluster supplied through KUBECONFIG is unavailable; cluster lifecycle is managed outside this repository' }
  }
  $config
}

def print-command-result [result: record] {
  if not ($result.stdout | str trim | is-empty) {
    print ($result.stdout | str trim)
  }
  if not ($result.stderr | str trim | is-empty) {
    print --stderr ($result.stderr | str trim)
  }
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

def load-images [root: path] {
  # sudo commonly replaces PATH with secure_path, which excludes Nix store paths.
  let k3s = which k3s | get 0.path

  stage dependencies 'Refreshing backend dependency metadata ...'
  run-checked 'failed to refresh backend dependency metadata' [
    nu ($root | path join scripts backend-deps.nu) refresh
  ] | ignore

  stage build 'Building the backend image ...'
  let backend_image = run-checked 'failed to build the backend image' [
    nix build --no-link --print-out-paths $"($root)#backend-image"
  ] | str trim
  stage build 'Building the frontend image ...'
  let frontend_image = run-checked 'failed to build the frontend image' [
    nix build --no-link --print-out-paths $"($root)#frontend-image"
  ] | str trim

  stage import 'Importing the backend image (requires sudo) ...'
  run-external $backend_image | ^sudo $k3s ctr -n k8s.io images import -
  if $env.LAST_EXIT_CODE != 0 {
    error make { msg: 'failed to import the backend image' }
  }
  stage import 'Importing the frontend image ...'
  run-external $frontend_image | ^sudo $k3s ctr -n k8s.io images import -
  if $env.LAST_EXIT_CODE != 0 {
    error make { msg: 'failed to import the frontend image' }
  }
}

def render-manifests [root: path, overlay: string, images: list<string>] {
  let render_dir = ^mktemp -d | str trim
  let deploy_dir = $render_dir | path join deploy
  ^cp -R ($root | path join deploy) $deploy_dir
  ^chmod -R u+w $deploy_dir

  let result = do {
    cd ($deploy_dir | path join overlays $overlay)
    ^kustomize edit set image ...$images
    ^kustomize build .
  } | complete

  ^chmod -R u+w $render_dir
  rm --recursive --force $render_dir

  if $result.exit_code != 0 {
    print --stderr $result.stderr
    error make { msg: $"failed to render ($overlay) manifests" }
  }
  $result.stdout
}

def render-development-manifests [root: path, backend_tag: string, frontend_tag: string] {
  render-manifests $root dev [
    $"dsa-backend=dsa-backend:($backend_tag)"
    $"dsa-frontend=dsa-frontend:($frontend_tag)"
  ]
}

def render-e2e-manifests [root: path, backend_tag: string, frontend_tag: string, e2e_tag: string] {
  render-manifests $root e2e [
    $"dsa-backend=dsa-backend:($backend_tag)"
    $"dsa-frontend=dsa-frontend:($frontend_tag)"
    $"dsa-e2e=dsa-e2e:($e2e_tag)"
  ]
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

def main [] {
  error make { msg: 'usage: task {start|redeploy|test|status|logs|reset} or task k3s:{load-images|deploy}' }
}

def 'main load-images' [] {
  load-images (repo-root)
}

def converge-development-environment [] {
  let root = repo-root
  require-cluster | ignore

  load-images $root
  do {
    let backend_tag = run-checked 'failed to evaluate the backend image tag' [
      nix eval --raw $"($root)#backend-image.imageTag"
    ] | str trim
    let frontend_tag = run-checked 'failed to evaluate the frontend image tag' [
      nix eval --raw $"($root)#frontend-image.imageTag"
    ] | str trim
    let manifests = render-development-manifests $root $backend_tag $frontend_tag

    stage apply 'Applying the development Kubernetes manifests ...'
    let apply = $manifests | ^kubectl apply -f - | complete
    if $apply.exit_code != 0 {
      print --stderr $apply.stdout
      print --stderr $apply.stderr
      diagnose-development
      error make { msg: 'failed to apply development Kubernetes manifests' }
    }
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
}

def 'main deploy' [] {
  converge-development-environment
}

def 'main start' [] {
  converge-development-environment
}

def 'main redeploy' [] {
  converge-development-environment
}

def 'main e2e' [] {
  let root = repo-root
  require-cluster | ignore
  let k3s = which k3s | get 0.path

  load-images $root
  stage build 'Building the E2E image ...'
  let e2e_image = run-checked 'failed to build the E2E image' [
    nix build --no-link --print-out-paths $"($root)#e2e-image"
  ] | str trim
  stage import 'Importing the E2E image (requires sudo) ...'
  run-external $e2e_image | ^sudo $k3s ctr -n k8s.io images import -
  if $env.LAST_EXIT_CODE != 0 {
    error make { msg: 'failed to import the E2E image' }
  }

  let backend_tag = run-checked 'failed to evaluate the backend image tag' [
    nix eval --raw $"($root)#backend-image.imageTag"
  ] | str trim
  let frontend_tag = run-checked 'failed to evaluate the frontend image tag' [
    nix eval --raw $"($root)#frontend-image.imageTag"
  ] | str trim
  let e2e_tag = run-checked 'failed to evaluate the E2E image tag' [
    nix eval --raw $"($root)#e2e-image.imageTag"
  ] | str trim
  let manifests = render-e2e-manifests $root $backend_tag $frontend_tag $e2e_tag

  do {
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
    remove-e2e-namespace 'E2E tests passed, but failed to delete the E2E namespace'
  }
}

def 'main status' [] {
  require-cluster | ignore
  do {
    development-status
  }
}

def 'main logs' [component: string = 'all'] {
  if $component != 'all' and $component not-in $components {
    error make { msg: $"unknown component '($component)'; expected one of: ($components | str join ', '), all" }
  }
  require-cluster | ignore
  do {
    let selected_components = if $component == 'all' { $components } else { [$component] }
    for selected in $selected_components {
      component-logs $selected
    }
  }
}

def 'main reset' [] {
  require-cluster | ignore
  do {
    stage reset $"Deleting namespace/($development_namespace) and its development data ..."
    ^kubectl delete namespace $development_namespace --ignore-not-found --wait=true
  }
}
