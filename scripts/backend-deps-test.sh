#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dependency_tool="$repo_root/scripts/backend-deps.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

make_fixture() {
  local fixture="$1"
  mkdir -p "$fixture/nix" "$fixture/backend" "$fixture/bin"
  cat >"$fixture/nix/backend-vendor-hash.nix" <<'EOF'
"sha256-old"
EOF
  cat >"$fixture/nix/backend.nix" <<'EOF'
{ pkgs }:
pkgs.buildGoModule {
  vendorHash = import ./backend-vendor-hash.nix;
}
EOF
  touch "$fixture/backend/go.mod" "$fixture/backend/go.sum"
  cat >"$fixture/bin/nix" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"nix/backend.nix"* && "$*" == *"lib.fakeHash"* ]]; then
  cat >&2 <<'OUTPUT'
error: hash mismatch in fixed-output derivation
         specified: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
            got:    sha256-newnewnewnewnewnewnewnewnewnewnewnewnew=
OUTPUT
  exit 1
fi
echo "unexpected nix invocation: $*" >&2
exit 64
EOF
  chmod +x "$fixture/bin/nix"
}

test_refresh_updates_metadata() {
  local fixture
  fixture="$(mktemp -d)"
  trap 'rm -rf "$fixture"' RETURN
  make_fixture "$fixture"

  PATH="$fixture/bin:$PATH" "$dependency_tool" refresh --repo-root "$fixture"

  grep -q '^"sha256-newnewnewnewnewnewnewnewnewnewnewnewnew="$' \
    "$fixture/nix/backend-vendor-hash.nix" || fail "refresh did not write the calculated hash"
}

test_check_reports_drift_without_modifying_checkout() {
  local fixture before output status
  fixture="$(mktemp -d)"
  trap 'rm -rf "$fixture"' RETURN
  make_fixture "$fixture"
  before="$(sha256sum "$fixture/nix/backend-vendor-hash.nix")"

  set +e
  output="$(PATH="$fixture/bin:$PATH" "$dependency_tool" check --repo-root "$fixture" 2>&1)"
  status=$?
  set -e

  [[ $status -ne 0 ]] || fail "check accepted stale metadata"
  [[ "$(sha256sum "$fixture/nix/backend-vendor-hash.nix")" == "$before" ]] || \
    fail "check modified the checkout"
  [[ "$output" == *"nix run .#backend-deps-refresh"* ]] || \
    fail "check did not report the repair command"
}

test_flake_exposes_dependency_operations() {
  nix eval --raw "$repo_root#apps.$(nix eval --raw --impure --expr builtins.currentSystem).backend-deps-refresh.program" \
    >/dev/null
  nix eval --raw "$repo_root#apps.$(nix eval --raw --impure --expr builtins.currentSystem).backend-deps-check.program" \
    >/dev/null
  nix eval --raw "$repo_root#apps.$(nix eval --raw --impure --expr builtins.currentSystem).backend-image-build.program" \
    >/dev/null
}

test_refresh_updates_metadata
test_check_reports_drift_without_modifying_checkout
test_flake_exposes_dependency_operations
echo "OK: backend dependency metadata operations"
