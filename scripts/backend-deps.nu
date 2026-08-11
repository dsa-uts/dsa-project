#!/usr/bin/env nu
# Keep buildGoModule's vendorHash synchronized with backend/go.mod and go.sum.

def resolve-repo-root [requested: any] {
  let root = if $requested == null {
    $env.FILE_PWD | path join ..
  } else {
    $requested
  }

  $root | path expand
}

def read-current-hash [metadata: path] {
  if not ($metadata | path exists) {
    error make { msg: $"backend dependency metadata not found: ($metadata)" }
  }

  let matches = open --raw $metadata
    | str trim
    | parse --regex '^"(?<hash>[^"]+)"$'

  if ($matches | length) != 1 {
    error make { msg: $"vendorHash was not found in ($metadata)" }
  }

  $matches.0.hash
}

def calculate-hash [repo_root: path] {
  let expression = '
    let
      flake = builtins.getFlake (toString ./.);
      pkgs = flake.inputs.nixpkgs.legacyPackages.${builtins.currentSystem};
    in
    import ./nix/backend.nix {
      inherit pkgs;
      vendorHash = pkgs.lib.fakeHash;
    }
  '

  let result = do {
    cd $repo_root
    nix build --no-link --impure --expr $expression
  } | complete

  let build_log = [$result.stdout $result.stderr] | str join (char newline)
  let hash_matches = $build_log
    | lines
    | parse --regex '^\s*got:\s*(?<hash>sha256-\S+)'
  let hashes = if ($hash_matches | is-empty) {
    []
  } else {
    $hash_matches | get hash | uniq
  }

  if ($hashes | length) != 1 {
    print --stderr $build_log
    error make { msg: 'could not calculate a unique backend vendorHash' }
  }

  if $result.exit_code == 0 {
    error make { msg: 'hash probe unexpectedly succeeded instead of reporting a hash mismatch' }
  }

  $hashes.0
}

def execute-operation [operation: string, repo_root: path] {
  let metadata = $repo_root | path join nix backend-vendor-hash.nix
  let current_hash = read-current-hash $metadata
  let expected_hash = calculate-hash $repo_root

  if $current_hash == $expected_hash {
    print 'OK: backend dependency metadata is up to date'
    return
  }

  if $operation == check {
    error make {
      msg: (
        [
          'backend dependency metadata is stale.'
          $"       committed: ($current_hash)"
          $"       expected:  ($expected_hash)"
          "       Run 'nix run .#backend-deps-refresh' and commit nix/backend-vendor-hash.nix."
        ] | str join (char newline)
      )
    }
  }

  $'"($expected_hash)"(char newline)' | save --force $metadata
  print 'Updated nix/backend-vendor-hash.nix:'
  print $"  ($current_hash)"
  print $"  -> ($expected_hash)"
  print 'The change is left in the working tree for review.'
}

def main [] {
  error make { msg: 'usage: backend-deps.nu {refresh|check} [--repo-root PATH]' }
}

def 'main refresh' [--repo-root: path] {
  execute-operation 'refresh' (resolve-repo-root $repo_root)
}

def 'main check' [--repo-root: path] {
  execute-operation 'check' (resolve-repo-root $repo_root)
}
