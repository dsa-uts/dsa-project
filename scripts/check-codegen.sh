#!/usr/bin/env bash
# openapi.yaml と生成コードのドリフト検査 (issue #95、ADR 0010)。
# 両側の codegen を再実行し、コミット済みの生成物と差分が出たら失敗する。
# CI で回すほか、openapi.yaml を変更したときの反映漏れ確認にも使える。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> backend: go generate"
(cd "$repo_root/backend" && go generate ./...)

echo "==> frontend: npm run generate"
(cd "$repo_root/frontend" && npm run generate)

echo "==> git diff check"
if ! git -C "$repo_root" diff --exit-code -- \
  backend/internal/api/gen.go \
  frontend/src/api/schema.d.ts; then
  echo >&2
  echo "error: generated code is out of sync with docs/spec/openapi.yaml." >&2
  echo "       Run scripts/check-codegen.sh locally and commit the diff." >&2
  exit 1
fi

echo "OK: generated code is in sync"
