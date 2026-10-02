export const image_specifications = [
  { name: 'dsa-backend', directory: 'backend', label: 'backend' }
  { name: 'dsa-judge', directory: 'backend', label: 'judge' }
  { name: 'dsa-frontend', directory: 'frontend', label: 'frontend' }
]

export def run-checked [description: string, args: list<string>] {
  let result = run-external ...$args | complete
  if $result.exit_code != 0 {
    print --stderr $result.stdout
    print --stderr $result.stderr
    error make { msg: $description }
  }
  $result.stdout
}

export def stage [name: string, message: string] {
  print $"[($name)] ($message)"
}

# Keep image loading, manifests, reset, and diagnostics on the same cluster.
export def require-cluster [expected?: string] {
  let context = if $expected != null { $expected } else if ($env.K3D_CLUSTER? | default '') != '' {
    $"k3d-($env.K3D_CLUSTER)"
  } else { 'orbstack' }
  let current = run-checked 'failed to read kubectl context' [kubectl config current-context] | str trim
  if $current != $context {
    error make { msg: $"expected kubectl context ($context), got ($current); select it before retrying" }
  }
  let connection = do { ^kubectl --request-timeout=5s get --raw=/readyz } | complete
  if $connection.exit_code != 0 {
    print --stderr ($connection.stderr | str trim)
    error make { msg: 'the current kubectl context is unavailable; select a working externally managed cluster before retrying' }
  }
}

export def print-command-result [result: record] {
  if not ($result.stdout | str trim | is-empty) {
    print ($result.stdout | str trim)
  }
  if not ($result.stderr | str trim | is-empty) {
    print --stderr ($result.stderr | str trim)
  }
}

export def cluster-image-platform [] {
  let nodes = run-checked 'failed to read node architectures' [kubectl get nodes -o json] | from json
  let architectures = $nodes.items | each { |node| $node.status.nodeInfo.architecture } | uniq
  if ($architectures | length) != 1 {
    error make { msg: 'image import requires a cluster with a single architecture' }
  }
  match $architectures.0 {
    arm64 => 'linux/arm64'
    amd64 => 'linux/amd64'
    _ => { error make { msg: $"unsupported node architecture: ($architectures.0)" } }
  }
}

export def build-images [root: path, specifications: list<record>, --platform: string, --context: string] {
  let docker_context = if $context != null { $context } else {
    run-checked 'failed to read Docker context' [docker context show] | str trim
  }
  # The context's default builder keeps builds and --load on the same engine.
  let docker = [docker --context $docker_context buildx build --builder $docker_context --load]
  let command = if $platform == null { $docker } else { $docker | append [--platform $platform] }

  $specifications | each { |specification|
    stage build $"Building the ($specification.label) image ..."
    let reference = $"($specification.name):latest"
    let result = run-external ...($command | append [
      --target $specification.label --tag $reference ($root | path join $specification.directory)
    ]) | complete
    print-command-result $result
    if $result.exit_code != 0 {
      error make { msg: $"failed to build the ($specification.label) image" }
    }
    {
      name: $specification.name
      reference: $reference
    }
  }
}

export def component-logs [namespace: string, component: string] {
  let selector = $"app.kubernetes.io/component=($component)"
  stage logs $"Current logs for ($component) ..."
  let current = do {
    ^kubectl --namespace $namespace logs --selector $selector --all-containers=true --prefix --tail=200
  } | complete
  print-command-result $current

  stage logs $"Previous container logs for ($component), when available ..."
  let previous = do {
    ^kubectl --namespace $namespace logs --selector $selector --all-containers=true --prefix --tail=200 --previous
  } | complete
  print-command-result $previous
}
