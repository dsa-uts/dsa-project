# dsa-project

データ構造とアルゴリズム演習のためのオンラインジャッジシステム。ドメイン言語の定義は [CONTEXT.md](CONTEXT.md) を参照。

## ディレクトリ構成

| ディレクトリ | 役割 |
| --- | --- |
| `frontend/` | Web フロントエンド(Node.js / TypeScript) |
| `backend/` | API サーバー(Go) |
| `deploy/` | Kubernetes manifest の Kustomize base / overlay |
| `nix/` | nix 定義の置き場(devShell 定義など)。`flake.nix` から import される |
| `docs/` | 仕様書(`docs/spec/`)と ADR(`docs/adr/`) |
| `scripts/` | Taskfile から呼ばれる Nushell 実装 |

エージェント向けの実装規約は [docs/agents/coding-standards.md](docs/agents/coding-standards.md) にある。

## 開発環境のセットアップ

開発に必要なツールチェーン(Go / Node.js / Kustomize / kubectl)は nix flake で管理している。サポート対象は Linux(x86_64 / aarch64)である。macOS では OrbStack の Linux machine に SSH 接続し、その中でリポジトリを clone して開発する。

### 1. Nix のインストール

flakes を有効にした Nix をインストールする。[Determinate Systems installer](https://github.com/DeterminateSystems/nix-installer) を使うと flakes が最初から有効になる:

```sh
curl -fsSL https://install.determinate.systems/nix | sh -s -- install
```

[公式インストーラ](https://nixos.org/download/) を使う場合は、`~/.config/nix/nix.conf` に以下を追記して flakes を有効にする:

```
experimental-features = nix-command flakes
```

### 2. devShell に入る

リポジトリのルートで:

```sh
nix develop
```

これで Task / Nushell / Go / Node.js / k3s / Kustomize / kubectl がすべて使えるシェルに入る。開発・ローカル運用コマンドの公開 interface は `task` であり、利用可能なタスクは `task --list` で確認できる。

### 3. direnv(推奨)

[direnv](https://direnv.net/) を使うと、ディレクトリに `cd` するだけで devShell が自動で有効になる。[nix-direnv](https://github.com/nix-community/nix-direnv) の併用を推奨(評価結果がキャッシュされ、シェル起動が速くなる)。

direnv をセットアップ済みなら、リポジトリのルートで一度だけ:

```sh
direnv allow
```

## 開発ループ

アプリケーションはホスト上で直接起動せず、PostgreSQL、Redis、backend、frontendを
含む完全な構成をローカルk3sへデプロイして確認する。最初は次を実行する:

```sh
task start
```

`start` はk3sクラスタの準備、backend依存metadataのrefresh、content-derived tagを
持つapplication imageのbuildとimport、local Kustomize overlayのapply、rollout、
全application Podのreadiness確認まで行う。完了時に表示されるIngressのURLを
ブラウザで開く。

コードを編集した後は、明示的に再デプロイする:

```sh
task redeploy
```

`redeploy` はimageを再構築してk3sへ搬入し、現在のcontent-derived tagをmanifestへ
注入する。内容が変わればDeploymentのPod templateも変わるため、rolloutが発生する。
進行状況は `dependencies`、`build`、`import`、`secrets`、`apply`、`rollout`、
`readiness` の段階ごとに表示される。ホットリロードやファイル監視は行わない。

local overlayのapplication resourceは専用namespace `dsa-dev` に配置される。現在の
rolloutとPodのreadinessは次で確認できる:

```sh
task status
```

componentのログは `backend`、`frontend`、`postgresql`、`redis` のいずれかを指定して
取得する。指定を省略すると全componentのログを取得する:

```sh
task logs -- backend
task logs
```

`start` または `redeploy` のrollout/readinessが失敗した場合は、workloadとPodの状態、
rollout state、namespace内のKubernetes events、関連component logsが自動表示される。

通常の終了には次を使う:

```sh
task stop
```

`stop` はk3s serverを止めるだけで、`dsa-dev` namespaceとPostgreSQL PVCを削除しない。
次回の `start` ではセッションをまたいでPostgreSQLデータを利用できる。Redisは
`emptyDir`を使用するため、そのstateは通常の永続データ契約に含まれない。

PostgreSQLを含むdevelopment dataを破棄するときだけ `reset` を使う。最初の実行は
削除対象のnamespaceとPVCを表示して停止する。内容を確認後、表示されたnamespace名を
明示して再実行する:

```sh
task reset
task reset -- dsa-dev
```

`reset` は `dsa-dev` namespaceだけを削除し、他namespaceやcluster-wide resourceを
削除対象にしない。次回の `start` で空のdevelopment環境が作成される。

## API contract と codegen

クライアント向け REST API は `docs/spec/openapi.yaml` が single source of truth([ADR 0010](docs/adr/0010-openapi-contract-with-codegen.md))。変更したら両側のコードを再生成してコミットする:

```sh
task codegen:generate
```

反映漏れは `task codegen:check` で検査できる(CI でも実行される)。

## backend のビルド

```sh
nix build .#backend         # バイナリ
task backend:image:build    # 依存 metadata を refresh してコンテナイメージをビルド
```
devShell 内では通常の Go ワークフローも使える:

```sh
task backend:test      # 外部依存のない unit test
```

依存を変更したら `go mod tidy` を実行する。開発向けの backend image build と
deploy は、ビルド前に Nix の依存 metadata (`nix/backend-vendor-hash.nix`) を検査し、
必要なら自動更新する。更新結果はコミットされず、レビュー可能な作業ツリー変更として残る。

依存 metadata だけを明示的に修復・検査する場合は次を使う:

```sh
task backend:deps:refresh # drift があれば作業ツリーを更新
task backend:deps:check   # checkout を変更せず drift を検査 (CI と同じ)
```

## frontend の検査とビルド

```sh
nix build .#frontend          # 静的ビルド成果物 (Vite の dist)
nix build .#frontend-image    # コンテナイメージ (下記参照)
```

devShell 内では通常の npm ワークフローも使える:

```sh
task frontend:install   # 初回と依存変更時
task frontend:test      # vitest
task frontend:typecheck # tsc -b
task frontend:lint      # oxlint
```

依存を変更したら `package.json` と `package-lock.json` をコミットする。Nix の frontend build は lockfile から依存を取得するため、Nix 固有の dependency hash の更新は不要。

## コンテナイメージ

`task backend:image:build` / `task frontend:image:build` で得る Nix の出力はイメージ tar を stdout に流すスクリプト。タグは derivation hash 由来で、内容が変わればタグも変わる。k3s へは registry を経由せず直接 import できる(後述の `task k3s:load-images` がこれを自動で行う):

```sh
task backend:image:build
./result | sudo k3s ctr -n k8s.io images import -
```

frontend イメージは [static-web-server](https://static-web-server.net/) が `:8080` で静的ファイルを配信する。

この直接 import は既定のシングルノードローカル環境だけを対象とする。local overlay は `imagePullPolicy: Never` なので、マルチノードクラスタでは import されていないノードで `ErrImageNeverPull` になる。マルチノードで動かす場合はレジストリを立ててpushするか、全ノードにimportすること。本番CDはGHCRからdigest指定でpullする。

## k3s 環境 (シングルノード)

デプロイの既定はシングルノード k3s クラスタ ([ADR 0008](docs/adr/0008-topology-agnostic-manifests.md))。Linux ホスト上で k3s server が systemd の一時 unit `dsa-k3s` として動く。`k3s-up` は `sudo systemd-run` を使うため、systemd と sudo が必要になる。OrbStack を使う場合も Linux machine 内で以下のコマンドを実行する。

### 低レベルのクラスタ操作

通常は前述の `task start` を使う。クラスタだけを操作または診断する場合は次を使う:

```sh
task k3s:up           # 起動し、ノードが Ready になるまで待つ
export KUBECONFIG=$PWD/.k3s/kubeconfig
kubectl get nodes     # 1 ノードが Ready

task k3s:down         # 停止
```

状態はリポジトリ直下の `.k3s/` に置かれる (`DSA_K3S_STATE_DIR` で変更可):

| ファイル | 内容 |
| --- | --- |
| `.k3s/kubeconfig` | ホスト用 kubeconfig (k3s server が直接生成) |

クラスタ状態はホストの `/var/lib/rancher/k3s` にある。

### 制約と補足

- `k3s-up` は非 NixOS ホストでも動くが、systemd を前提とする
- `k3s-down` で server を止めてもワークロードのコンテナは残り、次回起動時に再管理される

## 低レベルのデプロイ操作 (Kustomize)

通常の開発ループでは `task start` と `task redeploy` を使う。k3s環境が起動済みで、
デプロイ部分だけを診断する場合は次を実行できる:

```sh
task k3s:deploy        # イメージ搬入 + local overlay の apply
```

`k3s-deploy` は以下を行う:

1. **イメージ搬入** (`task k3s:load-images` 単体でも実行可)
   - イメージの stream script をホストの containerd へ直接 pipe する (`sudo` が必要)
2. **Secret基盤の収束** — version固定したSecrets Store CSI DriverとOpenBaoをHelmでinstall/upgradeし、disposableなdev serverへKubernetes auth、最小権限policy/role、既知の開発用passwordを冪等に設定する
3. **local manifest のrenderとapply** — image tagはderivation hash由来で毎ビルド変わるため、一時コピー上のlocal overlayへ現在のtagを自動注入する。Git管理されたmanifestは変更しない
4. **rollout待機** — PostgreSQL / Redis / backend / frontend のrollout完了を待つ
5. **readiness確認** — application PodがすべてReadyになるまで待つ
6. 完了後にアクセス URL (`http://<node-ip>/`) を表示する

ブラウザで URL を開くと hello ページが表示され、backend の health check 結果 (`ok`) が出る。Ingress は `/health` と `/api` を backend へ、それ以外を frontend へ route する。

追跡されているlocal / production overlayの静的なrender結果は次で確認できる。localの実際のNix hash tag注入は`k3s-deploy`が一時コピー上で行う:

```sh
kubectl kustomize deploy/overlays/local
kubectl kustomize deploy/overlays/production
```

本番overlay (`deploy/overlays/production`) のimage repositoryはGHCRを指す。記載されているゼロdigestは誤デプロイを防ぐsentinelであり、本番CDがGHCRへのpushで得たbackend/frontendのdigestに一時コピー上で置き換えてからapplyする。本番OpenBaoの初期化、unseal、初期Secret投入は [production bootstrap runbook](docs/runbooks/openbao-production-bootstrap.md) に従う。

## flake の検査

```sh
task check
```

CI や手元での確認に使う。内部では `nix flake check -L` を実行し、go test / vitest も各 derivation の検査として走る。全サポートシステム分を評価する場合は `nix flake check --all-systems`。

GitHub Actions (`.github/workflows/ci.yml`) が PR と main への push で同じ `nix flake check` を実行する。Linux runner では checks にコンテナイメージ (`backend-image` / `frontend-image`) のビルドも含まれる。Nix store は [cache-nix-action](https://github.com/nix-community/cache-nix-action) で GitHub Actions cache にキャッシュされる。

PostgreSQL、Redis、実行中の backend、Ingress、frontend を必要とするテストは、ADR 0012 に従い k3s にデプロイしたアプリケーションの公開 HTTP interface 経由で実行する。CI の `codegen-check` job は codegen ドリフト検査を実行する。
