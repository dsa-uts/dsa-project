#!/usr/bin/env nu

def repo-root [] {
  $env.FILE_PWD | path join .. | path expand
}

def run-codegen [root: path] {
  print '==> backend: go generate'
  let backend = do {
    cd ($root | path join backend)
    ^go generate ./...
  } | complete
  if $backend.exit_code != 0 {
    print --stderr $backend.stdout
    print --stderr $backend.stderr
    error make { msg: 'backend code generation failed' }
  }

  print '==> frontend: npm run generate'
  let frontend = do {
    cd ($root | path join frontend)
    ^npm run generate
  } | complete
  if $frontend.exit_code != 0 {
    print --stderr $frontend.stdout
    print --stderr $frontend.stderr
    error make { msg: 'frontend code generation failed' }
  }
}

def main [] {
  error make { msg: 'usage: task codegen:{generate|check}' }
}

def 'main generate' [] {
  run-codegen (repo-root)
}

def 'main check' [] {
  let root = repo-root
  run-codegen $root

  print '==> git diff check'
  let diff = do {
    ^git -C $root diff --exit-code -- backend/internal/api/gen.go frontend/src/api/schema.d.ts
  } | complete
  if $diff.exit_code != 0 {
    print --stderr $diff.stdout
    print --stderr $diff.stderr
    error make {
      msg: (
        [
          'generated code is out of sync with docs/spec/openapi.yaml.'
          "Run 'task codegen:generate' and commit the diff."
        ] | str join (char newline)
      )
    }
  }

  print 'OK: generated code is in sync'
}
