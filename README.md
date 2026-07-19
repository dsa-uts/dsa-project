# dsa-project

データ構造とアルゴリズム演習のためのオンラインジャッジシステム。ドメイン言語の定義は [CONTEXT.md](CONTEXT.md) を参照。

## ディレクトリ構成

| ディレクトリ | 役割 |
| --- | --- |
| `frontend/` | Web フロントエンド(Node.js / TypeScript) |
| `backend/` | API サーバー(Go) |
| `chart/` | Kubernetes へデプロイするための Helm chart |
| `nix/` | nix 定義の置き場(devShell 定義など)。`flake.nix` から import される |
| `docs/` | 仕様書(`docs/spec/`)と ADR(`docs/adr/`) |

## 開発環境のセットアップ

開発に必要なツールチェーン(Go / Node.js / Helm / kubectl)は nix flake で管理している。Linux(x86_64 / aarch64)と macOS(Apple Silicon)をサポートする。

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

これで Go / Node.js / Helm / kubectl がすべて使えるシェルに入る。

### 3. direnv(推奨)

[direnv](https://direnv.net/) を使うと、ディレクトリに `cd` するだけで devShell が自動で有効になる。[nix-direnv](https://github.com/nix-community/nix-direnv) の併用を推奨(評価結果がキャッシュされ、シェル起動が速くなる)。

direnv をセットアップ済みなら、リポジトリのルートで一度だけ:

```sh
direnv allow
```

## backend の実行とビルド

```sh
nix run .#backend           # サーバー起動 (PORT 環境変数で変更可、既定 8080)
nix build .#backend         # バイナリ
nix build .#backend-image   # コンテナイメージ (下記参照)
```

devShell 内では通常の Go ワークフローも使える:

```sh
cd backend
go test ./...
```

依存を変更したら `go mod tidy` の後に `nix/backend.nix` の `vendorHash` を更新する(`pkgs.lib.fakeHash` に置き換えて `nix build .#backend` し、エラーに出る正しい hash を貼り直す)。

### コンテナイメージ

`nix build .#backend-image` の出力はイメージ tar を stdout に流すスクリプト。タグは derivation hash 由来で、内容が変わればタグも変わる。k3s へは registry を経由せず直接 import できる:

```sh
nix build .#backend-image
./result | sudo k3s ctr -n k8s.io images import -
```

イメージは Linux 用 derivation なので、macOS からビルドするには Linux builder が必要。[nix-darwin](https://github.com/nix-darwin/nix-darwin) の [`nix.linux-builder`](https://nix-darwin.github.io/nix-darwin/manual/#opt-nix.linux-builder.enable) を有効にするのが簡単(`nix flake check` は Linux builder が無くても通る)。

## flake の検査

```sh
nix flake check
```

CI や手元での確認に使う。全サポートシステム分を評価する場合は `nix flake check --all-systems`。
