#!/usr/bin/env nu

const unit = 'dsa-k3s'
const host_kubeconfig = '/etc/rancher/k3s/k3s.yaml'

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

def unit-active [] {
  (do { ^systemctl is-active --quiet $unit } | complete).exit_code == 0
}

def wait-for-node [state_dir: path] {
  let kubeconfig = $state_dir | path join kubeconfig
  print 'Waiting for the node to become Ready ...'
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
  run-checked 'failed to refresh backend dependency metadata' [
    nu ($root | path join scripts backend-deps.nu) refresh
  ] | ignore

  let backend_image = run-checked 'failed to build the backend image' [
    nix build --no-link --print-out-paths $"($root)#backend-image"
  ] | str trim
  let frontend_image = run-checked 'failed to build the frontend image' [
    nix build --no-link --print-out-paths $"($root)#frontend-image"
  ] | str trim

  print 'Importing the backend image (requires sudo) ...'
  run-external $backend_image | ^sudo k3s ctr -n k8s.io images import -
  if $env.LAST_EXIT_CODE != 0 {
    error make { msg: 'failed to import the backend image' }
  }
  print 'Importing the frontend image ...'
  run-external $frontend_image | ^sudo k3s ctr -n k8s.io images import -
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
  error make { msg: 'usage: task k3s:{up|down|load-images|deploy}' }
}

def 'main up' [] {
  let root = repo-root
  let state_dir = state-dir $root
  mkdir $state_dir

  if (unit-active) {
    print $"k3s server is already running (systemd unit: ($unit))"
  } else {
    print $"Starting the k3s server as transient systemd unit ($unit) (requires sudo) ..."
    let executable_path = $env.PATH | str join ':'
    run-checked 'failed to start the k3s systemd unit' [
      sudo systemd-run $"--unit=($unit)"
      '--description=dsa-project single-node k3s server'
      $"--property=Environment=PATH=($executable_path)"
      (which k3s | get 0.path) server
    ] | ignore
  }

  print 'Waiting for the kubeconfig ...'
  mut found = false
  for _ in 1..300 {
    let exists = (do { ^sudo test -s $host_kubeconfig } | complete).exit_code == 0
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
    error make { msg: $"timed out waiting for ($host_kubeconfig); check: journalctl -u ($unit)" }
  }

  let kubeconfig = $state_dir | path join kubeconfig
  let user = ^id -un | str trim
  let group = ^id -gn | str trim
  run-checked 'failed to copy the k3s kubeconfig' [
    sudo install -m 600 -o $user -g $group $host_kubeconfig $kubeconfig
  ] | ignore
  wait-for-node $state_dir
}

def 'main down' [] {
  if (unit-active) {
    print $"Stopping systemd unit ($unit) (requires sudo) ..."
    run-checked 'failed to stop the k3s systemd unit' [sudo systemctl stop $unit] | ignore
    print 'k3s server stopped. Workload containers will be re-managed when it starts again.'
  } else {
    print $"k3s server is not running (systemd unit: ($unit))"
  }
}

def 'main load-images' [] {
  load-images (repo-root)
}

def 'main deploy' [] {
  let root = repo-root
  let state_dir = state-dir $root
  let kubeconfig = $state_dir | path join kubeconfig
  if not ($kubeconfig | path exists) or (($kubeconfig | path type) != file) {
    error make { msg: $"kubeconfig not found at ($kubeconfig); run 'task k3s:up' first" }
  }

  load-images $root
  with-env { KUBECONFIG: $kubeconfig } {
    print 'Installing and configuring local OpenBao ...'
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

    print 'Applying the local Kubernetes manifests ...'
    let apply = $manifests | ^kubectl apply -f - | complete
    if $apply.exit_code != 0 {
      print --stderr $apply.stdout
      print --stderr $apply.stderr
      error make { msg: 'failed to apply local Kubernetes manifests' }
    }
    ^kubectl rollout status deployment/dsa-backend --timeout=5m
    ^kubectl rollout status deployment/dsa-frontend --timeout=5m

    let node_ip = ^kubectl get nodes -o 'jsonpath={.items[0].status.addresses[?(@.type=="InternalIP")].address}'
    print ''
    print $"Deployed. Open: http://($node_ip)/"
  }
}
