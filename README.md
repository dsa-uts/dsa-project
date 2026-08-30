# dsa-project

データ構造とアルゴリズム演習のためのオンラインジャッジシステム。
ドメイン言語の定義は [CONTEXT.md](CONTEXT.md)、仕様は
[docs/spec/](docs/spec/README.md) を参照する。

## ディレクトリ構成

| ディレクトリ | 内容 |
| --- | --- |
| `frontend/` | React / TypeScript製のWebフロントエンド |
| `backend/` | Go製のAPIサーバー |
| `e2e/` | デプロイ済みの公開HTTP interfaceを検査するE2Eテスト |
| `deploy/` | Kubernetes manifestのKustomize baseと環境別overlay |
| `nix/` | devShell、ビルド、コンテナイメージのNix定義 |
| `scripts/` | Taskfileから呼び出すNushellスクリプト |
| `docs/spec/` | システム仕様とOpenAPI contract |
| `docs/adr/` | Architecture Decision Record |
| `docs/agents/` | エージェント向け実装規約 |

## 前提条件

- macOS上の[OrbStack](https://orbstack.dev/) 2.2.3以降
- [dsa-uts/ubuntu-config](https://github.com/dsa-uts/ubuntu-config)を実行するためのNix
- `direnv`と`nix-direnv`（推奨）
- GitHub上の対象リポジトリをcloneできる認証設定
- VMとk3sの作成・保守は`ubuntu-config`が担当し、このリポジトリは既存のk3sへアプリケーションをデプロイする

Linux上に同等の環境を用意する場合も、リポジトリと単一ノードk3sを同じマシン上に配置し、
現在の`kubectl` contextからクラスタを操作できるようにする。

## 開発環境のセットアップ

### 1. OrbStack VMを作成する

macOS上で`ubuntu-config`をcloneし、そのREADMEに従って`dsa-dev` VMを作成する。

```console
git clone git@github.com:dsa-uts/ubuntu-config.git
cd ubuntu-config
direnv allow
task up
orb shell dsa-dev
```

`task up`はUbuntu 26.04 VM、Nix、単一ノードk3s、開発ユーザーの権限を
非破壊かつ冪等に設定する。通常の再適用ではVM内のk3s dataを保持する。

### 2. VM内でdsa-projectをセットアップする

```console
git clone git@github.com:dsa-uts/dsa-project.git
cd dsa-project
nix develop
kubectl config current-context
kubectl get nodes
task deploy
```

`task deploy`はbackendの依存metadataを必要に応じて更新し、アプリケーションイメージを
ビルドしてk3sへ搬入し、`dsa-dev` namespaceへKustomize manifestを適用する。
rolloutとreadinessの完了後に表示されるURLをブラウザで開く。

コードを変更した後も`task deploy`を再実行する。ホットリロードやホスト上での
frontend/backendの直接起動は標準の開発経路に含めない。

`direnv`を利用する場合は、リポジトリのルートで一度`direnv allow`を実行すれば、
以後は`nix develop`を明示せずにTaskを実行できる。

## Task

利用可能なTaskは`task --list`でも確認できる。

| Task | 内容 |
| --- | --- |
| `task` | 利用可能なTaskの一覧を表示する |
| `task deploy` | application imageをビルドし、既存のk3sへデプロイまたは再デプロイする |
| `task test` | k3s上の隔離環境で公開HTTP interfaceのE2Eテストを実行する |
| `task status` | `dsa-dev`のworkload、Pod、rollout状態を表示する |
| `task logs` | backend、frontend、PostgreSQLのログをまとめて表示する |
| `task logs -- backend` | 指定componentの現在および直前のコンテナログを表示する |
| `task reset` | `dsa-dev` namespaceと開発データを削除する |
| `task backend:test` | 外部依存のないbackend unit testを実行する |
| `task backend:deps:refresh` | backendのNix依存metadataを更新する |
| `task backend:deps:check` | backendのNix依存metadataにdriftがないか検査する |
| `task backend:image:build` | 依存metadataを更新し、backend imageをビルドする |
| `task frontend:install` | lockfileからfrontend依存をインストールする |
| `task frontend:test` | frontend unit testを実行する |
| `task frontend:typecheck` | frontendを型検査する |
| `task frontend:lint` | frontendをlintする |
| `task frontend:image:build` | frontend imageをビルドする |
| `task e2e:image:build` | E2E test imageをビルドする |
| `task images:build` | applicationとE2Eの全imageをビルドする |
| `task k3d:test` | `K3D_CLUSTER`で指定した既存のk3d clusterでE2Eテストを実行する |
| `task codegen:generate` | OpenAPI contractからbackend/frontendコードを再生成する |
| `task codegen:check` | OpenAPI contractと生成コードのdriftを検査する |
| `task check` | unit test、静的検査、image buildを含むNix flake checksを実行する |

## 注意事項

- 通常の開発では`task deploy`を使う。個別のimage build Taskは、ビルドだけを診断したい場合に使う。
- `task deploy`は既存のPostgreSQL dataを保持する。開発データを破棄するときだけ`task reset`を使う。
- `task reset`が削除するのは`dsa-dev` namespaceであり、k3s cluster自体や他namespaceは対象にしない。
- `task test`は`dsa-e2e` namespaceを毎回作り直すため、E2E dataは実行ごとに破棄される。開発用の`dsa-dev` dataには影響しない。
- ローカルの`task test`とCIのk3dテストは、同じKustomize base、E2E overlay、application/test image、Kubernetes Jobを使う。
- Ingressは`/health`と`/api`をbackendへ、それ以外をfrontendへrouteする。`task deploy`完了時にアクセスURLが表示される。
- deployのrolloutまたはreadinessが失敗すると、workload、Pod、Kubernetes events、関連component logsが自動表示される。追加確認には`task status`と`task logs`を使う。
- application imageはホスト側でビルドし、同じVMのk3s containerdへ搬入するため、deploy時に`sudo`が必要になる。
- backend依存metadataが自動更新された場合、`nix/backend-vendor-hash.nix`はレビュー可能なworking tree変更として残る。
- REST APIを変更するときは`docs/spec/openapi.yaml`を先に編集し、`task codegen:generate`で生成物を更新する。
- dev/E2E overlayの固定credentialをproductionへ流用しない。production deploymentとcredential管理は未定義である。
- コーディング規約は[docs/agents/coding-standards.md](docs/agents/coding-standards.md)を参照する。
