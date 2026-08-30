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

export def require-cluster [] {
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

export def build-images [root: path, specifications: list<record>] {
  stage dependencies 'Refreshing backend dependency metadata ...'
  run-checked 'failed to refresh backend dependency metadata' [
    nu ($root | path join scripts backend-deps.nu) refresh
  ] | ignore

  $specifications | each { |specification|
    stage build $"Building the ($specification.label) image ..."
    let path = run-checked $"failed to build the ($specification.label) image" [
      nix build --no-link --print-out-paths $"($root)#($specification.attribute)"
    ] | str trim
    let tag = run-checked $"failed to evaluate the ($specification.label) image tag" [
      nix eval --raw $"($root)#($specification.attribute).imageTag"
    ] | str trim
    {
      name: $specification.name
      reference: $"($specification.name):($tag)"
      path: $path
    }
  }
}

export def import-k3s-images [images: list<record>] {
  # sudo commonly replaces PATH with secure_path, which excludes Nix store paths.
  let k3s = which k3s | get 0.path
  for image in $images {
    stage import $"Importing ($image.reference) into k3s; sudo is required ..."
    run-external $image.path | ^sudo $k3s ctr -n k8s.io images import -
    if $env.LAST_EXIT_CODE != 0 {
      error make { msg: $"failed to import ($image.reference) into k3s" }
    }
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
