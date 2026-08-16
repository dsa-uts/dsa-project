#!/usr/bin/env nu

const unit = 'dsa-k3s'

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

def render-local-manifests [root: path, backend_tag: string, frontend_tag: string] {
  let render_dir = ^mktemp -d | str trim
  let deploy_dir = $render_dir | path join deploy
  ^cp -R ($root | path join deploy) $deploy_dir
  ^chmod -R u+w $deploy_dir

  let result = do {
    cd ($deploy_dir | path join overlays local)
    ^kustomize edit set image $"dsa-backend=dsa-backend:($backend_tag)" $"dsa-frontend=dsa-frontend:($frontend_tag)"
    ^kustomize build .
  } | complete

  ^chmod -R u+w $render_dir
  rm --recursive --force $render_dir

  if $result.exit_code != 0 {
    print --stderr $result.stderr
    error make { msg: 'failed to render local manifests' }
  }
  $result.stdout
}

def main [] {
  error make { msg: 'usage: task {start|redeploy} or task k3s:{up|down|load-images|deploy}' }
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
  let state_dir = state-dir $root
  let kubeconfig = $state_dir | path join kubeconfig
  if not ($kubeconfig | path exists) or (($kubeconfig | path type) != file) {
    error make { msg: $"kubeconfig not found at ($kubeconfig); run 'task start' first" }
  }

  load-images $root
  with-env { KUBECONFIG: $kubeconfig } {
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
      error make { msg: 'failed to apply local Kubernetes manifests' }
    }
    for workload in [
      'statefulset/dsa-postgresql'
      'deployment/dsa-redis'
      'deployment/dsa-backend'
      'deployment/dsa-frontend'
    ] {
      stage rollout $"Waiting for ($workload) ..."
      run-checked $"rollout failed for ($workload)" [
        kubectl rollout status $workload --timeout=5m
      ] | print
    }

    stage readiness 'Waiting for all application Pods to become Ready ...'
    run-checked 'application Pods did not become Ready' [
      kubectl wait pod
      --selector=app.kubernetes.io/name=dsa
      --for=condition=Ready
      --timeout=5m
    ] | print

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
