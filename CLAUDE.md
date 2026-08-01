# dsa-project

オンラインジャッジ Web アプリの monorepo(frontend: React + Vite + TS / backend: Go + Echo + Bun / chart: Helm)。

## 必読ドキュメント

- [CONTEXT.md](CONTEXT.md) — 用語(ubiquitous language)と Principles。**ここの用語をコード・ドキュメント全体で使う**
- [docs/agents/coding-standards.md](docs/agents/coding-standards.md) — codegen ポリシー、テストポリシー、no-raw-colors ルール
- [docs/agents/domain.md](docs/agents/domain.md) — ドメインモデル
- [docs/adr/](docs/adr/) — アーキテクチャ決定(特に 0010: OpenAPI codegen、0011: seam-limited interfaces + real-DB tests)
- [docs/spec/](docs/spec/) — 仕様書。REST API は `docs/spec/openapi.yaml` が正

## 主要コマンド

```sh
# API contract を変更したら両側を再生成 (生成物はコミットする)
cd backend && go generate ./...     # → backend/internal/api/gen.go
cd frontend && npm run generate     # → frontend/src/api/schema.d.ts
./scripts/check-codegen.sh          # ドリフト検査 (CI でも実行)

# backend (DB テストは Docker が必要。-short で skip)
cd backend && go test ./...

# frontend
cd frontend && npm test && npm run typecheck && npm run lint

# 全体検証
nix flake check
```

backend は `DATABASE_URL` があれば起動時に migration を自動適用する。スキーマは `backend/internal/store/migrations/` の SQL が正。
