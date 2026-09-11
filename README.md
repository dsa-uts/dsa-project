# dsa-project

データ構造とアルゴリズム演習のためのオンラインジャッジシステム。
React / TypeScriptのfrontend、GoのbackendをKubernetesへデプロイする。
[仕様](docs/spec/README.md)、[ドメイン用語](CONTEXT.md)、[設計判断](docs/adr/)、
[開発規約](docs/agents/coding-standards.md)を参照。

## 初回セットアップ

Apple Silicon Mac、起動済みのOrbStack（Docker・Kubernetes）、Nixと
`aarch64-linux`をビルドできるLinux builder（dotfiles側で管理）が必要。

```sh
git clone git@github.com:dsa-uts/dsa-project.git
cd dsa-project
nix develop
kubectl config use-context orbstack
kubectl get nodes
kubectl get storageclass
task cluster:setup
task deploy
```

初回は[OrbStack HTTPS](https://orb.local)の案内に従って開発用CAをMacで信頼し、
devShellへ入り直す。開発URLは **https://dsa.k8s.orb.local**。
`direnv`を使う場合はルートで一度`direnv allow`を実行する。

## 普段の開発

コード変更後は`task deploy`で再ビルド・更新する。通常のデプロイではDBを保持する。
状態は`task status`、ログは`task logs -- backend`で確認できる。
開発データを破棄するときだけ`task reset`を使う。

```sh
task frontend:install           # 初回・lockfile変更時
task frontend:test
task frontend:typecheck
task frontend:lint
task backend:test
task check                      # Nixによる全体検証
```

REST API変更は`api/openapi.yaml`から始め、`task codegen:generate`で生成物を更新する。
利用可能なコマンドは`task --list`、証明書・CI・障害調査の詳細は
[開発運用](docs/development.md)を参照。

## E2E

同じdevShellとOrbStackを使う。開発環境とは別のnamespace・DBへデプロイする。
既定URLは **https://dsa-e2e.k8s.orb.local**。同じ環境への操作は逐次実行する。

```sh
task e2e:install                 # 初回・lockfile変更時
task e2e:up                      # アプリ変更時の更新にも使用
task e2e:test
task e2e:test -- tests/admin-users.spec.ts --grep 'browser Admin'
task e2e:test -- --headed         # ブラウザを表示
task e2e:test -- --debug          # Playwright Inspector
task e2e:diagnostics             # ログ・eventsを確認
task e2e:down                    # 調査終了後に環境とデータを削除
```

テスト成功・失敗後も環境とデータは残る。DBを初期化する場合は`task e2e:reset`、
DB障害テストは`task e2e:test:outage`を個別に実行する。
テストだけの変更では`e2e:up`は不要。
