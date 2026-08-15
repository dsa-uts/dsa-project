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
| `scripts/` | 開発用スクリプト(codegen ドリフト検査など) |

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

これで Go / Node.js / Kustomize / kubectl がすべて使えるシェルに入る。

### 3. direnv(推奨)

[direnv](https://direnv.net/) を使うと、ディレクトリに `cd` するだけで devShell が自動で有効になる。[nix-direnv](https://github.com/nix-community/nix-direnv) の併用を推奨(評価結果がキャッシュされ、シェル起動が速くなる)。

direnv をセットアップ済みなら、リポジトリのルートで一度だけ:

```sh
direnv allow
```

## API contract と codegen

クライアント向け REST API は `docs/spec/openapi.yaml` が single source of truth([ADR 0010](docs/adr/0010-openapi-contract-with-codegen.md))。変更したら両側のコードを再生成してコミットする:

```sh
cd backend && go generate ./...     # → backend/internal/api/gen.go (oapi-codegen)
cd frontend && npm run generate     # → frontend/src/api/schema.d.ts (openapi-typescript)
```

反映漏れは `./scripts/check-codegen.sh` で検査できる(CI でも実行される)。

## backend の実行とビルド

```sh
nix run .#backend           # サーバー起動 (PORT 環境変数で変更可、既定 8080)
nix build .#backend         # バイナリ
nix run .#backend-image-build  # 依存 metadata を refresh してコンテナイメージをビルド
```

backend は `DATABASE_URL` と `REDIS_URL` を必須とする。起動時に PostgreSQL と Redis の初期接続を確認し、`backend/internal/store/migrations/` の embedded migration を自動適用する。設定欠落または初期接続失敗時は HTTP server を起動せず終了する。

devShell 内では通常の Go ワークフローも使える:

```sh
cd backend
go test ./...          # 外部依存のない unit test
```

依存を変更したら `go mod tidy` を実行する。開発向けの backend image build と
deploy は、ビルド前に Nix の依存 metadata (`nix/backend-vendor-hash.nix`) を検査し、
必要なら自動更新する。更新結果はコミットされず、レビュー可能な作業ツリー変更として残る。

依存 metadata だけを明示的に修復・検査する場合は次を使う:

```sh
nix run .#backend-deps-refresh # drift があれば作業ツリーを更新
nix run .#backend-deps-check   # checkout を変更せず drift を検査 (CI と同じ)
```

## frontend の開発とビルド

```sh
nix build .#frontend          # 静的ビルド成果物 (Vite の dist)
nix build .#frontend-image    # コンテナイメージ (下記参照)
```

devShell 内では通常の npm ワークフローも使える:

```sh
cd frontend
npm install       # 初回と依存変更時
npm run dev       # dev server (http://localhost:5173)
npm test          # vitest
npm run typecheck # tsc -b
npm run lint      # oxlint
```

dev server は `/health` と `/api` を backend(`http://localhost:8080`)へ proxy する(`frontend/vite.config.ts`)。別ターミナルで `nix run .#backend` を起動しておくと、hello ページに backend の health check 結果が表示される。

依存を変更したら `package.json` と `package-lock.json` をコミットする。Nix の frontend build は lockfile から依存を取得するため、Nix 固有の dependency hash の更新は不要。

## コンテナイメージ

`nix run .#backend-image-build` / `nix build .#frontend-image` の出力はイメージ tar を stdout に流すスクリプト。タグは derivation hash 由来で、内容が変わればタグも変わる。k3s へは registry を経由せず直接 import できる(後述の `nix run .#k3s-load-images` がこれを自動で行う):

```sh
nix run .#backend-image-build
./result | sudo k3s ctr -n k8s.io images import -
```

frontend イメージは [static-web-server](https://static-web-server.net/) が `:8080` で静的ファイルを配信する。

この直接 import は既定のシングルノードローカル環境だけを対象とする。local overlay は `imagePullPolicy: Never` なので、マルチノードクラスタでは import されていないノードで `ErrImageNeverPull` になる。マルチノードで動かす場合はレジストリを立ててpushするか、全ノードにimportすること。本番CDはGHCRからdigest指定でpullする。

## k3s 環境 (シングルノード)

デプロイの既定はシングルノード k3s クラスタ ([ADR 0008](docs/adr/0008-topology-agnostic-manifests.md))。Linux ホスト上で k3s server が systemd の一時 unit `dsa-k3s` として動く。`k3s-up` は `sudo systemd-run` を使うため、systemd と sudo が必要になる。OrbStack を使う場合も Linux machine 内で以下のコマンドを実行する。

### 起動と停止

```sh
nix run .#k3s-up      # 起動し、ノードが Ready になるまで待つ
export KUBECONFIG=$PWD/.k3s/kubeconfig
kubectl get nodes     # 1 ノードが Ready

nix run .#k3s-down    # 停止
```

状態はリポジトリ直下の `.k3s/` に置かれる (`DSA_K3S_STATE_DIR` で変更可):

| ファイル | 内容 |
| --- | --- |
| `.k3s/kubeconfig` | ホスト用 kubeconfig (`k3s-up` が生成) |

クラスタ状態はホストの `/var/lib/rancher/k3s` にある。

### 制約と補足

- `k3s-up` は非 NixOS ホストでも動くが、systemd を前提とする
- `k3s-down` で server を止めてもワークロードのコンテナは残り、次回起動時に再管理される

## デプロイ (Kustomize)

frontend + backend + PostgreSQL + Redis + Traefik Ingress の共通manifestは `deploy/base/` にあり、環境差は `deploy/overlays/` に限定する。manifestはクラスタのノード構成を仮定しない ([ADR 0008](docs/adr/0008-topology-agnostic-manifests.md))。local overlay の PostgreSQL は PVC に永続化し、Redis は非永続である。SecretはOpenBaoを正本とし、専用ServiceAccountで認証したworkloadへCSI fileとしてmountする ([ADR 0014](docs/adr/0014-openbao-static-secret-delivery.md))。Helmを使わない理由とアプリimage配送の方針は [ADR 0013](docs/adr/0013-kustomize-deployment-manifests.md) を参照。

k3s 環境が起動済みなら 1 コマンド:

```sh
nix run .#k3s-up       # 未起動の場合
nix run .#k3s-deploy   # イメージ搬入 + local overlay の apply
```

`k3s-deploy` は以下を行う:

1. **イメージ搬入** (`nix run .#k3s-load-images` 単体でも実行可)
   - イメージの stream script をホストの containerd へ直接 pipe する (`sudo` が必要)
2. **Secret基盤の収束** — version固定したSecrets Store CSI DriverとOpenBaoをHelmでinstall/upgradeし、disposableなdev serverへKubernetes auth、最小権限policy/role、既知の開発用passwordを冪等に設定する
3. **local manifest のrenderとapply** — image tagはderivation hash由来で毎ビルド変わるため、一時コピー上のlocal overlayへ現在のtagを自動注入する。Git管理されたmanifestは変更しない
4. **rollout待機** — backend / frontend のDeploymentが完了するまで待つ
5. 完了後にアクセス URL (`http://<node-ip>/`) を表示する

ブラウザで URL を開くと hello ページが表示され、backend の health check 結果 (`ok`) が出る。Ingress は `/health` と `/api` を backend へ、それ以外を frontend へ route する。

追跡されているlocal / production overlayの静的なrender結果は次で確認できる。localの実際のNix hash tag注入は`k3s-deploy`が一時コピー上で行う:

```sh
kubectl kustomize deploy/overlays/local
kubectl kustomize deploy/overlays/production
```

本番overlay (`deploy/overlays/production`) のimage repositoryはGHCRを指す。記載されているゼロdigestは誤デプロイを防ぐsentinelであり、本番CDがGHCRへのpushで得たbackend/frontendのdigestに一時コピー上で置き換えてからapplyする。本番OpenBaoの初期化、Shamir 3/2 unseal、初期Secret投入は [production bootstrap runbook](docs/runbooks/openbao-production-bootstrap.md) に従う。

## flake の検査

```sh
nix flake check
```

CI や手元での確認に使う。go test / vitest に加え、local / production Kustomize overlayと動的なローカルtag注入の静的検証 (`nix/manifest-check.nix`) もここで走る。全サポートシステム分を評価する場合は `nix flake check --all-systems`。

GitHub Actions (`.github/workflows/ci.yml`) が PR と main への push で同じ `nix flake check` を実行する。Linux runner では checks にコンテナイメージ (`backend-image` / `frontend-image`) のビルドも含まれる。Nix store は [cache-nix-action](https://github.com/nix-community/cache-nix-action) で GitHub Actions cache にキャッシュされる。

PostgreSQL、Redis、実行中の backend、Ingress、frontend を必要とするテストは、ADR 0012 に従い k3s にデプロイしたアプリケーションの公開 HTTP interface 経由で実行する。CI の `codegen-check` job は codegen ドリフト検査を実行する。
