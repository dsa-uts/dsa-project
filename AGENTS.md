# dsa-project

バックエンド開発では [Google Go Style Guide](https://google.github.io/styleguide/go/guide) と KISS 原則に従う。

## 開発時の参照先

- [CONTEXT.md](CONTEXT.md) — 用語(ubiquitous language)と Principles。**ここの用語をコード・ドキュメント全体で使う**
- [docs/agents/coding-standards.md](docs/agents/coding-standards.md) — codegen ポリシー、テストポリシー
- フロントエンドを実装・レビューするときは [frontend/GUIDELINES.md](frontend/GUIDELINES.md) の参照先に従う。
- 設計・仕様を変更するときは [docs/adr/](docs/adr/) と [docs/spec/](docs/spec/) の関連文書を読む。
- REST API を変更するときは [api/openapi.yaml](api/openapi.yaml) を正とする。

## 主要コマンド

利用可能なコマンドは `task --list`、全体検証は `task check`。
