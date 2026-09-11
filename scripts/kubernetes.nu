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

export def cluster-image-system [] {
  let nodes = run-checked 'failed to read node architectures' [kubectl get nodes -o json] | from json
  let architectures = $nodes.items | each { |node| $node.status.nodeInfo.architecture } | uniq
  if ($architectures | length) != 1 {
    error make { msg: 'image import requires a cluster with a single architecture' }
  }
  match $architectures.0 {
    arm64 => 'aarch64-linux'
    amd64 => 'x86_64-linux'
    _ => { error make { msg: $"unsupported node architecture: ($architectures.0)" } }
  }
}

export def build-images [root: path, specifications: list<record>, --system: string] {
  let target = if $system != null { $system } else {
    run-checked 'failed to determine Nix host system' [nix eval --impure --raw --expr builtins.currentSystem]
      | str trim | str replace '-darwin' '-linux'
  }
  if 'backend-image' in $specifications.attribute {
    stage dependencies 'Refreshing backend dependency metadata ...'
    run-checked 'failed to refresh backend dependency metadata' [
      nu ($root | path join scripts backend-deps.nu) refresh
    ] | ignore
  }

  $specifications | each { |specification|
    stage build $"Building the ($specification.label) image ..."
    let path = run-checked $"failed to build the ($specification.label) image" [
      nix build --no-link --print-out-paths $"($root)#packages.($target).($specification.attribute)"
    ] | str trim
    let tag = run-checked $"failed to evaluate the ($specification.label) image tag" [
      nix eval --raw $"($root)#packages.($target).($specification.attribute).imageTag"
    ] | str trim
    {
      name: $specification.name
      reference: $"($specification.name):($tag)"
      path: $path
    }
  }
}

export def import-orbstack-images [images: list<record>] {
  for image in $images {
    stage import $"Loading ($image.reference) into OrbStack ..."
    run-checked $"failed to load ($image.reference) into OrbStack" [
      docker --context orbstack load --input $image.path
    ] | print
  }
}

export def render-manifests [root: path, overlay: string, images: list<record>] {
  let render_dir = ^mktemp -d | str trim
  let deploy_dir = $render_dir | path join deploy
  ^cp -R ($root | path join deploy) $deploy_dir
  ^chmod -R u+w $deploy_dir

  let image_arguments = $images | each { |image| $"($image.name)=($image.reference)" }
  let result = do {
    cd ($deploy_dir | path join overlays $overlay)
    ^kustomize edit set image ...$image_arguments
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
