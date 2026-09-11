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

- Apple Silicon Macと[OrbStack](https://docs.orbstack.dev/kubernetes/)（Docker・Kubernetesを起動しておく）
- Nixと、`aarch64-linux`をビルドできる`linux-builder`（dotfiles側で設定する）
- `direnv`と`nix-direnv`（推奨）

リポジトリ編集、Codex、開発コマンド、PlaywrightはMacで実行する。アプリとDBは
OrbStack Kubernetesで動かす。OrbStackやLinux builderのインストール・起動・保守は
このリポジトリの担当外。旧VMのデータは移行せず、新規DBと既存seedで開始する。

## 開発環境のセットアップ

```console
git clone git@github.com:dsa-uts/dsa-project.git
cd dsa-project
nix develop
kubectl config use-context orbstack
kubectl get nodes
kubectl get storageclass
task cluster:setup
task deploy
```

`task cluster:setup`はリポジトリで固定した公式Traefik Helm chartと共通valuesを使い、
`dsa-ingress` namespaceへ初回導入・更新する。日常のアプリ更新は`task deploy`だけでよい。

初回はブラウザで[OrbStack HTTPS](https://orb.local)を開き、OrbStackの案内に従って
開発用CAをMacで信頼する。証明書はOrbStackが管理し、リポジトリに秘密鍵は保存しない。
Mac devShellはキーチェーンの公開CAを`$XDG_CACHE_HOME/dsa-project/orbstack-ca.pem`
（未設定時は`~/Library/Caches/dsa-project/orbstack-ca.pem`）へ書き出し、Nodeの
`NODE_EXTRA_CA_CERTS`に設定する。既に指定済みの`NODE_EXTRA_CA_CERTS`は尊重する。
CAを信頼した後はdevShellへ入り直す。TLS証明書検証は有効のまま使う。

`task deploy`はbackend依存metadataを更新し、ノードのarchitectureに対応するLinuxイメージを
Nixでビルドする。Linux builderがtar生成まで担当し、Macへ取得したtarを
`docker --context orbstack load`で登録する。OrbStackのDockerとKubernetesはイメージを共有するため、
レジストリは不要。ハッシュ由来のタグを一時manifestへ反映し、`dsa-dev`へ適用して
rollout/readinessを待つ。開発URLは **https://dsa.k8s.orb.local**。

PVCはクラスタの既定StorageClassを使う（OrbStackとCIのk3dは`local-path`）。
通常の再デプロイでDBを保持する。コード変更後も`task deploy`を実行する。
ホットリロードは追加していない。

`direnv`を使う場合はルートで一度`direnv allow`を実行する。
Macのflake出力はホスト用package/devShell、Linuxの出力にはコンテナイメージも含む。
個別のイメージビルドTaskはMacなら`aarch64-linux`、Linuxならホストと同じarchitectureを使う。
直接指定する例は`nix build .#packages.aarch64-linux.backend-image`。

## Task

利用可能なTaskは`task --list`でも確認できる。

| Task | 内容 |
| --- | --- |
| `task` | 利用可能なTaskの一覧を表示する |
| `task cluster:setup` | 固定Traefik chartを導入・更新する |
| `task deploy` | application imageをビルドし、OrbStackへデプロイまたは再デプロイする |
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
| `task check` | 実行host向けNix flake checksを実行する（Linuxではimage buildも含む） |

## 注意事項

- 通常の開発では`task deploy`を使う。個別のimage build Taskは、ビルドだけを診断したい場合に使う。
- `task deploy`は既存のPostgreSQL dataを保持する。開発データを破棄するときだけ`task reset`を使う。
- `task reset`が削除するのは`dsa-dev` namespaceであり、OrbStack cluster自体や他namespaceは対象にしない。
- E2Eの構築・DB初期化・実行・削除は独立している。テストの成功・失敗にかかわらず、ローカルの環境とデータは保持する。DB初期化は明示的な`task e2e:reset`のみ。
- ローカルとCIは、Kustomize baseとE2E構成、Linux image定義、Traefik chartとvaluesを共有する。CI用overlayはIngressのhostとTLS設定を変更する。Playwrightは作業ディレクトリのテストを直接読む。
- Ingressは`/health`と`/api`をbackendへ、それ以外をfrontendへrouteする。`task deploy`完了時にアクセスURLが表示される。
- deployのrolloutまたはreadinessが失敗すると、workload、Pod、Kubernetes events、関連component logsが自動表示される。追加確認には`task status`と`task logs`を使う。
- 開発操作は`orbstack` contextを使う。CIのE2E操作は`K3D_CLUSTER`に対応する`k3d-<name>` contextを使い、異なるcontextなら変更前に停止する。
- backend依存metadataが自動更新された場合、`nix/backend-vendor-hash.nix`はレビュー可能なworking tree変更として残る。
- REST APIを変更するときは`api/openapi.yaml`を先に編集し、`task codegen:generate`で生成物を更新する。
- dev/E2E overlayの固定credentialをproductionへ流用しない。production deploymentとcredential管理は未定義である。
- コーディング規約は[docs/agents/coding-standards.md](docs/agents/coding-standards.md)を参照する。

### ホストからのE2E実行

Macで`nix develop`に入り、`task cluster:setup`でIngressを導入しておく。開発とE2Eは別namespace・別DBで、共有Ingressのhostにより振り分ける。OrbStackの名前解決を使うためMacの`/etc/hosts`変更は不要。

```sh
task e2e:install                 # 初回・package-lock変更時のみ
task e2e:up                      # アプリ変更時の再ビルド・更新にも使用
task e2e:reset                   # 必要なときだけDBを初期化
task e2e:test
task e2e:test -- tests/admin-users.spec.ts --grep 'browser Admin'
task e2e:test -- --headed         # Macでブラウザを表示
task e2e:test -- --debug          # Playwright Inspectorを起動
task e2e:test -- --trace on
task e2e:test:outage
task e2e:diagnostics
task e2e:down                    # 調査終了後に明示的に削除
```

既定URLは **https://dsa-e2e.k8s.orb.local**。Macの`task e2e:install`はnpm依存とChromiumを
インストールし、標準の`~/Library/Caches/ms-playwright`を使う。LinuxのdevShellは
Nix提供ブラウザとその環境変数を設定する。MacへLinuxの`PLAYWRIGHT_BROWSERS_PATH`や
ダウンロード抑止設定を持ち込まない。

CIはLinux＋k3dを維持し、内蔵Traefikを無効化して共通chartを導入する。
`e2e-ci` overlayは`e2e`を継承し、hostを`e2e.localhost`へ変更し、ローカル用TLS注釈を除く。
既存k3dを使うときの設定は次のとおり（作成手順はCI定義を参照）。

```sh
export K3D_CLUSTER=dsa-e2e
export E2E_BASE_URL=http://e2e.localhost:8080
kubectl config use-context "k3d-$K3D_CLUSTER"
task cluster:setup -- --k3d-cluster "$K3D_CLUSTER"
task e2e:up -- --k3d-cluster "$K3D_CLUSTER"
```

CIは`8080:80@loadbalancer`でIngressを公開し、`e2e.localhost`を`127.0.0.1`へ名前解決する。
`E2E_BASE_URL`を変更する場合はIngressのhostと公開portも一致させる。

同じ環境への操作は逐次実行する。テストだけの変更では`e2e:up`もNixビルドも不要。通常・障害テストはそれぞれ`e2e/test-results/{normal,outage}`に失敗時のtraceとスクリーンショット、`e2e/playwright-report/{normal,outage}`にHTML reportを保存する。同じ種類の次の実行で上書きされるため、残したい結果は先にコピーする。`cd e2e && npx playwright show-trace <trace.zip>`で調査できる。CIは両スイートの結果とKubernetesログをartifactに保存してから環境を削除する。

テスト全体は30秒、操作とassertionは5秒、navigationは10秒を上限とする（`--debug`ではPlaywrightがタイムアウトを無効化する）。環境構築のrollout待機は各120秒。DBへの新規接続待ちは2秒。障害テストは開始前とDB復旧後に公開API経由でDBへの到達性を待ち、テスト結果と復旧エラーを別々に表示する。SIGKILLなど復旧処理を実行できない終了後は`task e2e:up`でDBを起動し直す。
