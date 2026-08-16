#!/usr/bin/env nu

def resolve-repo-root [requested: any] {
  ($requested | default ($env.FILE_PWD | path join ..)) | path expand
}

def run-checked [description: string, command: closure] {
  let result = do $command | complete
  if $result.exit_code != 0 {
    print --stderr $result.stderr
    error make { msg: $description }
  }
  $result.stdout
}

def render-overlay [repo_root: path, overlay: string] {
  let path = $repo_root | path join deploy overlays $overlay
  run-checked $"failed to render the ($overlay) overlay" { ^kubectl kustomize $path }
}

def render-local [repo_root: path, backend_tag: string, frontend_tag: string] {
  let render_dir = ^mktemp -d | str trim
  let deploy_dir = $render_dir | path join deploy
  ^cp -R ($repo_root | path join deploy) $deploy_dir
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
    error make { msg: 'failed to render local manifests with image tags' }
  }
  $result.stdout
}

def require-text [rendered: string, expected: string, source: string] {
  if not ($rendered | str contains $expected) {
    error make { msg: $"manifest-check: '($expected)' not found in ($source)" }
  }
}

def occurrence-count [text: string, pattern: string] {
  (($text | split row $pattern | length) - 1)
}

def nix-value [repo_root: path, attribute: string] {
  run-checked $"failed to evaluate .#($attribute)" {
    cd $repo_root
    ^nix eval --raw $".#($attribute)"
  } | str trim
}

def main [] {
  error make { msg: 'usage: task manifests:{render|check}' }
}

def 'main render-current' [--repo-root: path] {
  let root = resolve-repo-root $repo_root
  let backend_tag = nix-value $root backend-image.imageTag
  let frontend_tag = nix-value $root frontend-image.imageTag
  print --no-newline (render-local $root $backend_tag $frontend_tag)
}

def 'main render-local' [backend_tag: string, frontend_tag: string, --repo-root: path] {
  print --no-newline (render-local (resolve-repo-root $repo_root) $backend_tag $frontend_tag)
}

def 'main check' [--repo-root: path, --output: path] {
  let root = resolve-repo-root $repo_root
  let local = render-overlay $root local
  let production = render-overlay $root production

  for entry in [[name rendered]; [local $local] [production $production]] {
    for expected in [
      'kind: Deployment'
      'kind: StatefulSet'
      'kind: PersistentVolumeClaim'
      'kind: SecretProviderClass'
      'kind: ServiceAccount'
      'kind: Service'
      'kind: Ingress'
      'name: dsa-backend'
      'name: dsa-frontend'
      'name: dsa-postgresql'
      'name: dsa-redis'
    ] {
      require-text $entry.rendered $expected $"($entry.name).yaml"
    }
    let has_secret = $entry.rendered
      | lines
      | any { |line| ($line | str trim) == 'kind: Secret' }
    if $has_secret or ($entry.rendered | str contains 'secretKeyRef:') {
      error make { msg: $"manifest-check: Kubernetes Secret material found in ($entry.name).yaml" }
    }
    if (occurrence-count $entry.rendered 'driver: secrets-store.csi.k8s.io') != 3 {
      error make { msg: $"manifest-check: expected three CSI volumes in ($entry.name).yaml" }
    }
    for workload in [backend postgresql redis] {
      require-text $entry.rendered $"name: dsa-($workload)-secrets" $"($entry.name).yaml"
      require-text $entry.rendered $"serviceAccountName: dsa-($workload)" $"($entry.name).yaml"
    }
  }

  for expected in [
    'image: dsa-backend:local'
    'image: dsa-frontend:local'
    'imagePullPolicy: Never'
    'image: postgres:17.6'
    'image: redis:8.2.1'
    'storageClassName: local-path'
    'app.kubernetes.io/instance: dsa'
    'secretPath: kv/data/dsa/dev/postgresql'
    'secretPath: kv/data/dsa/dev/redis'
  ] {
    require-text $local $expected local.yaml
  }

  for expected in [
    'image: ghcr.io/dsa-uts/dsa-backend@sha256:'
    'image: ghcr.io/dsa-uts/dsa-frontend@sha256:'
    'secretPath: kv/data/dsa/prod/postgresql'
    'secretPath: kv/data/dsa/prod/redis'
    'baoAddress: https://openbao.openbao.svc:8200'
  ] {
    require-text $production $expected production.yaml
  }

  let generated = render-local $root backend-check frontend-check
  for expected in [
    'image: dsa-backend:backend-check'
    'image: dsa-frontend:frontend-check'
    'imagePullPolicy: Never'
  ] {
    require-text $generated $expected generated-local.yaml
  }

  if $output != null {
    touch $output
  }
  print 'OK: Kubernetes manifests are valid'
}
