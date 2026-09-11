# 開発運用

基本手順は[README](../README.md)。OrbStackとLinux builderの保守はリポジトリ外で行う。
開発操作は`orbstack` context、CIは`K3D_CLUSTER`に対応するcontextを選択する。

## 証明書とブラウザ

Mac devShellはキーチェーンのOrbStack公開CAを
`$XDG_CACHE_HOME/dsa-project/orbstack-ca.pem`
（未設定時は`~/Library/Caches/dsa-project/orbstack-ca.pem`）へ書き出し、
`NODE_EXTRA_CA_CERTS`へ設定する。既存の指定は尊重する。
CAを信頼した後はdevShellへ入り直し、証明書検証を有効のまま使う。

Macの`task e2e:install`はlocked PlaywrightのChromiumを標準OSキャッシュへ導入する。
LinuxはNix提供ブラウザを使う。Linuxの`PLAYWRIGHT_BROWSERS_PATH`や
ダウンロード抑止設定をMacへ持ち込まない。

## ビルドとデータ

ビルドだけを診断する場合は`task backend:image:build` / `task frontend:image:build`を使う。
Macのimage出力を直接指定する例は`nix build .#packages.aarch64-linux.backend-image`。
backend依存metadataの自動更新は`nix/backend-vendor-hash.nix`の差分として残るのでレビューする。

`task reset`は`dsa-dev` namespaceと開発データを削除する。
dev/E2Eの固定credentialは開発専用。production deploymentとcredential管理は未定義。

## E2Eの障害調査

通常・障害テストのtraceとスクリーンショットは`e2e/test-results/{normal,outage}`、
HTML reportは`e2e/playwright-report/{normal,outage}`に保存される。
同じ種類の次の実行で上書きされるため、必要な結果は先にコピーする。
`e2e/`で`npx playwright show-trace <trace.zip>`を実行して調査できる。
常にtraceを採取する場合は`task e2e:test -- --trace on`を使う。
タイムアウト値は[Playwright設定](../e2e/playwright.config.ts)を参照する。

障害テストはDB復旧を試み、テスト結果と復旧エラーを別々に表示する。
SIGKILLなど復旧処理が走らない終了後は`task e2e:up`でDBを起動し直す。
CIは両スイートの結果とKubernetesログをartifactに保存してから環境を削除する。

## 既存k3dでの実行

クラスタ作成は[CI定義](../.github/workflows/ci.yml)を参照する。
内蔵Traefikを無効化し、共有chartを導入する。

```sh
export K3D_CLUSTER=dsa-e2e
export E2E_BASE_URL=http://e2e.localhost:8080
kubectl config use-context "k3d-$K3D_CLUSTER"
task cluster:setup -- --k3d-cluster "$K3D_CLUSTER"
task e2e:up -- --k3d-cluster "$K3D_CLUSTER"
```

Ingressを`8080:80@loadbalancer`で公開し、`e2e.localhost`を`127.0.0.1`へ名前解決する。
`E2E_BASE_URL`を変える場合はIngressのhostと公開portも合わせる。
