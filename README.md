# dsa-project

データ構造とアルゴリズム演習のためのオンラインジャッジシステム。
ドメイン言語の定義は [CONTEXT.md](CONTEXT.md)、仕様は
[docs/spec/](docs/spec/README.md) を参照する。

## ディレクトリ構成

| ディレクトリ | 内容 |
| --- | --- |
| `frontend/` | React / TypeScript製のWebフロントエンド |
| `backend/` | Go製のAPIサーバー |
| `api/` | OpenAPI contract |
| `e2e/` | デプロイ済みの公開HTTP interfaceを検査するE2Eテスト |
| `deploy/` | Kubernetes manifestのKustomize baseと環境別overlay |
| `nix/` | devShell、ビルド、コンテナイメージのNix定義 |
| `scripts/` | Taskfileから呼び出すNushellスクリプト |
| `docs/spec/` | システム仕様 |
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
| `task e2e:test` / `task test` | 既存のE2E環境へホストからPlaywrightを実行する |
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
| `task e2e:up` | アプリのイメージをビルド・importし、E2E環境を構築・更新する |
| `task e2e:reset` | E2E DBを初期化し、migrationとseedを適用する |
| `task e2e:test:outage` | DB停止・障害テスト・DB復旧を実行する |
| `task e2e:down` | E2E環境とデータを削除する |
| `task images:build` | applicationの全imageをビルドする |
| `task codegen:generate` | OpenAPI contractからbackend/frontendコードを再生成する |
| `task codegen:check` | OpenAPI contractと生成コードのdriftを検査する |
| `task check` | unit test、静的検査、image buildを含むNix flake checksを実行する |

## 注意事項

- 通常の開発では`task deploy`を使う。個別のimage build Taskは、ビルドだけを診断したい場合に使う。
- `task deploy`は既存のPostgreSQL dataを保持する。開発データを破棄するときだけ`task reset`を使う。
- `task reset`が削除するのは`dsa-dev` namespaceであり、k3s cluster自体や他namespaceは対象にしない。
- E2Eの構築・DB初期化・実行・削除は独立している。テストの成功・失敗にかかわらず、ローカルの環境とデータは保持する。DB初期化は明示的な`task e2e:reset`のみ。
- ローカルとCIは、同じKustomize base、E2E overlay、application image、Nixのブラウザ環境を使う。Playwrightは作業ディレクトリのテストを直接読む。
- Ingressは`/health`と`/api`をbackendへ、それ以外をfrontendへrouteする。`task deploy`完了時にアクセスURLが表示される。
- deployのrolloutまたはreadinessが失敗すると、workload、Pod、Kubernetes events、関連component logsが自動表示される。追加確認には`task status`と`task logs`を使う。
- application imageはホスト側でビルドし、同じVMのk3s containerdへ搬入するため、deploy時に`sudo`が必要になる。
- backend依存metadataが自動更新された場合、`nix/backend-vendor-hash.nix`はレビュー可能なworking tree変更として残る。
- REST APIを変更するときは`api/openapi.yaml`を先に編集し、`task codegen:generate`で生成物を更新する。
- dev/E2E overlayの固定credentialをproductionへ流用しない。production deploymentとcredential管理は未定義である。
- コーディング規約は[docs/agents/coding-standards.md](docs/agents/coding-standards.md)を参照する。

### ホストからのE2E実行

Linux VMで`nix develop`に入り、初回は`/etc/hosts`に`127.0.0.1 e2e.localhost`を登録する。Nodeとブラウザの両方で名前解決できる必要がある。共有Ingressの`localhost`は`dsa-dev`、`e2e.localhost`は`dsa-e2e`に対応する。

```sh
task e2e:install                 # 初回・package-lock変更時のみ
task e2e:up                      # アプリ変更時の再ビルド・更新にも使用
task e2e:reset                   # 必要なときだけDBを初期化
task e2e:test
task e2e:test -- tests/admin-users.spec.ts --grep 'browser Admin'
task e2e:test -- --headed         # VM上のDISPLAYが必要
task e2e:test -- --debug          # Playwright Inspectorを起動
task e2e:test -- --trace on
task e2e:test:outage
task e2e:diagnostics
task e2e:down                    # 調査終了後に明示的に削除
```

既定URLは`http://e2e.localhost`。例: `E2E_BASE_URL=http://e2e.localhost:8080 task e2e:test`。別ホスト名を使う場合はIngressルールも合わせる。CIはk3dの`8080:80@loadbalancer`で同じIngressを公開する。既存k3dでは`task e2e:up -- --k3d-cluster <name>`を使う。

同じ環境への操作は逐次実行する。テストだけの変更では`e2e:up`もNixビルドも不要。通常・障害テストはそれぞれ`e2e/test-results/{normal,outage}`に失敗時のtraceとスクリーンショット、`e2e/playwright-report/{normal,outage}`にHTML reportを保存する。同じ種類の次の実行で上書きされるため、残したい結果は先にコピーする。`cd e2e && npx playwright show-trace <trace.zip>`で調査できる。CIは両スイートの結果とKubernetesログをartifactに保存してから環境を削除する。

テスト全体は30秒、操作とassertionは5秒、navigationは10秒を上限とする（`--debug`ではPlaywrightがタイムアウトを無効化する）。環境構築のrollout待機は各120秒。障害テストは終了時にDB復旧を試み、テスト結果と復旧エラーを別々に表示する。SIGKILLなど復旧処理を実行できない終了後は`task e2e:up`でDBを起動し直す。
