#!/usr/bin/env nu

const unit = 'dsa-k3s'
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

def state-dir [root: path] {
  ($env.DSA_K3S_STATE_DIR? | default ($root | path join .k3s)) | path expand
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

def kubeconfig [root: path] {
  state-dir $root | path join kubeconfig
}

def require-kubeconfig [root: path] {
  let config = kubeconfig $root
  if not ($config | path exists) or (($config | path type) != file) {
    error make { msg: $"kubeconfig not found at ($config); run 'task start' first" }
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

def unit-active [] {
  (do { ^systemctl is-active --quiet $unit } | complete).exit_code == 0
}

def wait-for-node [state_dir: path] {
  let kubeconfig = $state_dir | path join kubeconfig
  stage cluster 'Waiting for the node to become Ready ...'
  mut ready = false
  for _ in 1..180 {
    let nodes = do { ^kubectl --kubeconfig $kubeconfig get nodes --no-headers } | complete
    if $nodes.exit_code == 0 and ($nodes.stdout | lines | any { |line| $line =~ '\sReady\s' }) {
      $ready = true
      break
    }
    sleep 1sec
  }
  if not $ready {
    let nodes = do { ^kubectl --kubeconfig $kubeconfig get nodes } | complete
    print --stderr $nodes.stdout
    print --stderr $nodes.stderr
    error make { msg: 'timed out waiting for the node to become Ready' }
  }
  ^kubectl --kubeconfig $kubeconfig get nodes
  print ''
  print 'k3s is up. Point kubectl at it with:'
  print $"  export KUBECONFIG=($kubeconfig)"
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

def render-local-manifests [root: path, backend_tag: string, frontend_tag: string] {
  render-manifests $root local [
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

def main [] {
  error make { msg: 'usage: task {start|redeploy|test|status|logs|stop|reset} or task k3s:{up|down|load-images|deploy}' }
}

def ensure-cluster [] {
  let root = repo-root
  let state_dir = state-dir $root
  mkdir $state_dir
  let kubeconfig = $state_dir | path join kubeconfig
  let group = ^id -gn | str trim

  if (unit-active) {
    stage cluster $"k3s server is already running; systemd unit: ($unit)"
  } else {
    stage cluster $"Starting the k3s server as transient systemd unit ($unit); requires sudo ..."
    let executable_path = $env.PATH | str join ':'
    run-checked 'failed to start the k3s systemd unit' [
      sudo systemd-run $"--unit=($unit)"
      '--description=dsa-project single-node k3s server'
      $"--property=Environment=PATH=($executable_path)"
      (which k3s | get 0.path) server
      --write-kubeconfig $kubeconfig
      --write-kubeconfig-group $group
      --write-kubeconfig-mode 0640
    ] | ignore
  }

  stage cluster 'Waiting for the kubeconfig ...'
  mut found = false
  for _ in 1..300 {
    let exists = (do { ^test -s $kubeconfig } | complete).exit_code == 0
    if $exists {
      $found = true
      break
    }
    if not (unit-active) {
      error make { msg: $"unit ($unit) is not running; check: journalctl -u ($unit)" }
    }
    sleep 1sec
  }
  if not $found {
    error make { msg: $"timed out waiting for ($kubeconfig); check: journalctl -u ($unit)" }
  }

  wait-for-node $state_dir
}

def 'main up' [] {
  ensure-cluster
}

def 'main down' [] {
  if (unit-active) {
    print $"Stopping systemd unit ($unit); requires sudo ..."
    run-checked 'failed to stop the k3s systemd unit' [sudo systemctl stop $unit] | ignore
    print 'k3s server stopped. Workload containers will be re-managed when it starts again.'
  } else {
    print $"k3s server is not running; systemd unit: ($unit)"
  }
}

def 'main load-images' [] {
  load-images (repo-root)
}

def converge-development-environment [] {
  let root = repo-root
  let kubeconfig = require-kubeconfig $root

  load-images $root
  with-env { KUBECONFIG: $kubeconfig, DSA_APP_NAMESPACE: $development_namespace } {
    stage secrets 'Installing and configuring local OpenBao ...'
    run-checked 'failed to install local OpenBao' [
      nu ($root | path join scripts openbao-install.nu) dev
    ] | ignore
    run-checked 'failed to configure local OpenBao' [
      nu ($root | path join scripts openbao-configure.nu) dev
    ] | ignore

    let backend_tag = run-checked 'failed to evaluate the backend image tag' [
      nix eval --raw $"($root)#backend-image.imageTag"
    ] | str trim
    let frontend_tag = run-checked 'failed to evaluate the frontend image tag' [
      nix eval --raw $"($root)#frontend-image.imageTag"
    ] | str trim
    let manifests = render-local-manifests $root $backend_tag $frontend_tag

    stage apply 'Applying the local Kubernetes manifests ...'
    let apply = $manifests | ^kubectl apply -f - | complete
    if $apply.exit_code != 0 {
      print --stderr $apply.stdout
      print --stderr $apply.stderr
      diagnose-development
      error make { msg: 'failed to apply local Kubernetes manifests' }
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
  ensure-cluster
  converge-development-environment
}

def 'main redeploy' [] {
  converge-development-environment
}

def 'main e2e' [] {
  ensure-cluster
  let root = repo-root
  let config = require-kubeconfig $root
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

  with-env { KUBECONFIG: $config } {
    stage reset $"Replacing namespace/($e2e_namespace) to guarantee clean PostgreSQL state ..."
    run-checked 'failed to reset the E2E namespace' [
      kubectl delete namespace $e2e_namespace --ignore-not-found --wait=true --timeout=2m
    ] | ignore

    stage apply 'Applying the E2E Kubernetes manifests ...'
    let apply = $manifests | ^kubectl apply -f - | complete
    if $apply.exit_code != 0 {
      print-command-result $apply
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
      error make { msg: $"E2E Job ($outcome); namespace/($e2e_namespace) was preserved for inspection" }
    }

    ^kubectl --namespace $e2e_namespace logs job/dsa-e2e --all-containers=true --tail=300
    stage cleanup $"Deleting successful namespace/($e2e_namespace) ..."
    run-checked 'E2E tests passed, but failed to delete the E2E namespace' [
      kubectl delete namespace $e2e_namespace --wait=true --timeout=2m
    ] | ignore
  }
}

def 'main status' [] {
  let root = repo-root
  let config = require-kubeconfig $root
  with-env { KUBECONFIG: $config } {
    if not (unit-active) {
      error make { msg: $"k3s is stopped; run 'task start' to start it. PostgreSQL data remains in namespace ($development_namespace)" }
    }
    development-status
  }
}

def 'main logs' [component: string = 'all'] {
  if $component != 'all' and $component not-in $components {
    error make { msg: $"unknown component '($component)'; expected one of: ($components | str join ', '), all" }
  }
  let root = repo-root
  let config = require-kubeconfig $root
  with-env { KUBECONFIG: $config } {
    if not (unit-active) {
      error make { msg: "k3s is stopped; run 'task start' before requesting logs" }
    }
    let selected_components = if $component == 'all' { $components } else { [$component] }
    for selected in $selected_components {
      component-logs $selected
    }
  }
}

def 'main stop' [] {
  main down
}

def 'main reset' [] {
  let root = repo-root
  let config = require-kubeconfig $root
  if not (unit-active) {
    error make { msg: "k3s is stopped; run 'task start' before resetting the development environment" }
  }

  with-env { KUBECONFIG: $config } {
    stage reset $"Deleting namespace/($development_namespace) and its development data ..."
    ^kubectl delete namespace $development_namespace --ignore-not-found --wait=true
  }
}
