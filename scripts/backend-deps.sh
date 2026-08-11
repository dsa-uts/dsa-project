#!/usr/bin/env bash
# Keep buildGoModule's vendorHash synchronized with backend/go.mod and go.sum.
set -euo pipefail

usage() {
  echo "usage: $0 {refresh|check} [--repo-root PATH]" >&2
  exit 2
}

operation="${1:-}"
[[ "$operation" == "refresh" || "$operation" == "check" ]] || usage
shift

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" == "--repo-root" ]]; then
  [[ $# -eq 2 ]] || usage
  repo_root="$(cd "$2" && pwd)"
elif [[ $# -ne 0 ]]; then
  usage
fi

metadata="$repo_root/nix/backend-vendor-hash.nix"
[[ -f "$metadata" ]] || {
  echo "error: backend dependency metadata not found: $metadata" >&2
  exit 1
}

current_hash="$(sed -n 's/^"\([^"]*\)"$/\1/p' "$metadata")"
[[ -n "$current_hash" ]] || {
  echo "error: vendorHash was not found in $metadata" >&2
  exit 1
}

calculate_hash() {
  local build_log status calculated
  build_log="$(mktemp)"
  set +e
  (
    cd "$repo_root"
    nix build --no-link --impure --expr '
      let
        flake = builtins.getFlake (toString ./.);
        pkgs = flake.inputs.nixpkgs.legacyPackages.${builtins.currentSystem};
      in
      import ./nix/backend.nix {
        inherit pkgs;
        vendorHash = pkgs.lib.fakeHash;
      }
    '
  ) >"$build_log" 2>&1
  status=$?
  set -e

  calculated="$(sed -n 's/^[[:space:]]*got:[[:space:]]*\(sha256-[^[:space:]]*\).*/\1/p' "$build_log" | tail -1)"
  if [[ -z "$calculated" ]]; then
    cat "$build_log" >&2
    rm -f "$build_log"
    if [[ $status -eq 0 ]]; then
      echo "error: hash probe unexpectedly succeeded without reporting a hash" >&2
    else
      echo "error: could not calculate backend vendorHash" >&2
    fi
    exit 1
  fi
  rm -f "$build_log"
  printf '%s\n' "$calculated"
}

expected_hash="$(calculate_hash)"

if [[ "$current_hash" == "$expected_hash" ]]; then
  echo "OK: backend dependency metadata is up to date"
  exit 0
fi

if [[ "$operation" == "check" ]]; then
  echo "error: backend dependency metadata is stale." >&2
  echo "       committed: $current_hash" >&2
  echo "       expected:  $expected_hash" >&2
  echo "       Run 'nix run .#backend-deps-refresh' and commit nix/backend-vendor-hash.nix." >&2
  exit 1
fi

sed -i "s|^\"$current_hash\"$|\"$expected_hash\"|" "$metadata"
echo "Updated nix/backend-vendor-hash.nix:"
echo "  $current_hash"
echo "  -> $expected_hash"
echo "The change is left in the working tree for review."
