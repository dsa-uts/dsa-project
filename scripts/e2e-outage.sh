#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../e2e"

kube() { kubectl --request-timeout=10s --namespace dsa-e2e "$@"; }
# Install the trap before stopping PostgreSQL, including shutdown/wait failures.
# Preserve the test's exit status, and report recovery failures separately.
restore() {
  local test_status=$?
  trap - EXIT INT TERM
  local recovery_status=0
  kube scale statefulset/dsa-postgresql --replicas=1 || recovery_status=$?
  kube rollout status statefulset/dsa-postgresql --timeout=120s || recovery_status=$?
  if (( recovery_status != 0 )); then
    echo "PostgreSQL recovery failed (exit $recovery_status); test/shutdown exit: $test_status" >&2
    exit 1
  fi
  echo "PostgreSQL restored; test/shutdown exit: $test_status"
  exit "$test_status"
}
kube get statefulset/dsa-postgresql >/dev/null
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
kube scale statefulset/dsa-postgresql --replicas=0
kube wait --for=delete pod/dsa-postgresql-0 --timeout=90s
E2E_AUTH_OUTAGE=1 npm test -- "$@"
