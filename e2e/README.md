# E2E

Playwright + TypeScript

## セットアップ

```sh
cd e2e
npm ci
npx playwright install chromium
```

## テストの追加・実行

`tests/` に `*.spec.ts` を追加します。`test` と `expect` は `@playwright/test` からインポートしてください。

リポジトリルートの README に従って開発環境を起動してから実行します。
接続先の既定値は `http://localhost:5173` です。

```sh
npm test
# ブラウザを表示して実行する場合
npm test -- --headed
# 接続先を変更する場合
E2E_BASE_URL=http://localhost:15173 npm test
```

## 静的チェック・整形

```sh
npm run lint
npm run format
npm run format:check
npm run typecheck
```
