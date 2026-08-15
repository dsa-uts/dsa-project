# dsa-project

オンラインジャッジ Web アプリの monorepo(frontend: React + Vite + TS / backend: Go + Echo + Bun / deploy: Kubernetes + Kustomize)。

## 必読ドキュメント

- [CONTEXT.md](CONTEXT.md) — 用語(ubiquitous language)と Principles。**ここの用語をコード・ドキュメント全体で使う**
- [docs/agents/coding-standards.md](docs/agents/coding-standards.md) — codegen ポリシー、テストポリシー、no-raw-colors ルール
- [docs/agents/domain.md](docs/agents/domain.md) — ドメインモデル
- [docs/adr/](docs/adr/) — アーキテクチャ決定(特に 0010: OpenAPI codegen、0011: seam-limited interfaces、0012: deployed public interface tests)
- [docs/spec/](docs/spec/) — 仕様書。REST API は `docs/spec/openapi.yaml` が正

## 主要コマンド

```sh
# API contract を変更したら両側を再生成 (生成物はコミットする)
cd backend && go generate ./...     # → backend/internal/api/gen.go
cd frontend && npm run generate     # → frontend/src/api/schema.d.ts
./scripts/check-codegen.sh          # ドリフト検査 (CI でも実行)

# backend (外部依存のない unit test)
cd backend && go test ./...

# frontend
cd frontend && npm test && npm run typecheck && npm run lint

# 全体検証
nix flake check
```

PostgreSQL、Redis、実行中の backend、Ingress、frontend を必要とするテストは、k3s にデプロイしたアプリケーションの公開 HTTP interface 経由で実行する (ADR 0012)。
