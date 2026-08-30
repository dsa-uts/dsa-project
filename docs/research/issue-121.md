# Issue 121 調査: testcontainers 経路の Kubernetes test Job への統合

調査日: 2026-08-30

## 結論

[Issue 121](https://github.com/dsa-uts/dsa-project/issues/121) のゴールは、PostgreSQL を使う旧 backend HTTP テストを「テストプロセス内で Echo server と disposable PostgreSQL を組み立てる経路」から、隔離された k3s namespace に実際の application をデプロイし、Ingress 越しの公開 HTTP interface だけを観測する単一の Kubernetes Job へ移すことである。同時に、cluster なしで走る backend suite には外部依存のない純粋ロジックと静的検査だけを残す。

現在の `main` はインフラ撤去と test Job の土台をほぼ完了しているが、Issue 121 はまだ完了していない。旧テストを削除したコミット `d2b0467` と test Job を追加したコミット `39f7941` の間で、旧 assertion の一部が失われている。したがって中心作業は、`e2e/tests/public-interface.spec.ts` に不足する成功・validation・error assertion を公開 HTTP 検査として戻し、重複しない範囲で browser journey と分担させることである。

## Issue が要求している状態

Issue 本文の acceptance criteria は次の5点である。

1. 既存 DB-backed API の成功・validation・error assertion を Kubernetes test Job で維持する。
2. backend suite から testcontainers dependency と disposable PostgreSQL harness を除く。
3. PostgreSQL、running backend、routing、frontend execution が必要なテストを host/Nix sandbox の単体テスト経路に残さない。
4. dependency-free な純粋ロジックの単体テストと静的検査は cluster なしで高速に実行可能にする。
5. test strategy を ADR 0012 と一致させ、ADR 0011 の superseded scope を明記する。

出典: [Issue 121 本文](https://github.com/dsa-uts/dsa-project/issues/121)。親仕様も、外部依存テストの唯一の seam を deployed public HTTP interface とし、旧 testcontainers assertions を上位 seam へ移すと明記している（[Issue 113](https://github.com/dsa-uts/dsa-project/issues/113)）。直接の blocker だった test Job 作成 Issue は closed である（[Issue 120](https://github.com/dsa-uts/dsa-project/issues/120)）。

## 現状と gap

| 受入条件 | 現状 | 判定 |
| --- | --- | --- |
| 既存 success / validation / error assertions を Job で維持 | Job 内 Playwright suite は browser で greeting 作成・一覧反映、API で empty name の 422/error envelope を検査する（[`public-interface.spec.ts`](../../e2e/tests/public-interface.spec.ts)）。一方、削除された旧 suite が検査していた response の `201`、`id`、`created_at`、2件の newest-first 順序、missing `name`、404 `not_found` envelope は移植されていない（[`d2b0467` の削除差分](https://github.com/dsa-uts/dsa-project/commit/d2b04675601727166b2e25fe3dc8d74b2683e778)）。 | **未達** |
| testcontainers と disposable PostgreSQL harness の削除 | `backend/go.mod` に testcontainers はなく、`backend/internal/testutil/testutil.go` と in-process `server_test.go` は `d2b0467` で削除済み。現行 backend test は config と DB 接続入力の dependency-free test のみ（[`backend/go.mod`](../../backend/go.mod)、[`datastores_test.go`](../../backend/internal/app/datastores_test.go)、[`config_test.go`](../../backend/internal/config/config_test.go)）。 | 達成済み |
| 外部依存テストを host/Nix unit path に残さない | `task backend:test` は `go test ./...` のみで、現行 Go tests は server、PostgreSQL、routing、frontend を起動しない（[`Taskfile.yml`](../../Taskfile.yml)）。外部依存テストは E2E Job の task に分離されている。 | 達成済み |
| cluster なしの高速 unit/static checks | backend test derivation は通常の `buildGoModule` check で、cluster provisioning を含まない（[`nix/backend.nix`](../../nix/backend.nix)）。CI の `flake-check` も静的/Nix checks と image builds だけである（[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)）。 | 達成済み |
| ADR 0012 と ADR 0011 の scope | ADR 0012 は PostgreSQL/running backend test を public interface に移し、testcontainers/in-process assembly を廃止すると明記する。ADR 0011 冒頭も、test strategy だけが superseded で、concrete stores/no repository interfaces は維持すると明記する（[`ADR 0012`](../adr/0012-deployed-interface-tests.md)、[`ADR 0011`](../adr/0011-seam-limited-interfaces-real-db-tests.md)）。coding standards も同じ方針である（[`coding-standards.md`](../agents/coding-standards.md)）。 | 達成済み |

### すでに利用できる test Job 経路

- E2E overlay は base、secret、finite Job を隔離 namespace にまとめる（[`deploy/overlays/e2e/kustomization.yaml`](../../deploy/overlays/e2e/kustomization.yaml)）。
- Job の `E2E_BASE_URL` は Traefik の cluster DNS を指すため、test code は frontend/backend Service や PostgreSQL に直結しない（[`test-job.yaml`](../../deploy/overlays/e2e/test-job.yaml)）。
- `task test` は image build/import、namespace の置換、manifest apply、Job 完了待ち、診断、cleanup を実施する既存 runner を呼ぶ（[`Taskfile.yml`](../../Taskfile.yml)、[`scripts/k3s.nu`](../../scripts/k3s.nu)）。
- この土台は blocker Issue 120 を実装した commit `39f7941` で追加された（[commit](https://github.com/dsa-uts/dsa-project/commit/39f79414021fa8f4a72646dff529f78018ae7cc6)）。

## 解決に必要な作業

### 1. 旧 assertions の対応表を確定する

削除前の `backend/internal/server/server_test.go`（commit `d2b0467` の parent）を基準に、以下を E2E Job の public API checks へ移す。

- 成功系: POST `/api/hello` の `201`、`message`、DB が設定する non-empty `id` / `created_at`。
- 永続化・順序: 2件を public API で作成し、GET `/api/hello` が `200` で、新しい順に返すこと。
- validation: empty `name` に加えて missing `name` も `422` と `validation_failed` envelope を返すこと。
- error: 未知の route が `404` と `not_found` envelope を返すこと。

旧 `database_unavailable` assertion はそのまま復活させない。親仕様 Issue 113 が database-optional API behavior を廃止し、PostgreSQL 未設定・接続失敗時は backend 自体を起動失敗させる方針へ変更しているためである。現行の missing configuration は dependency-free な `TestConnectDatabaseRequiresPostgreSQLURL` が検査している。もし「接続不能時の起動失敗」も Issue 121 の error coverage に含めるなら、通常の healthy E2E deployment 内から DB を壊すテストではなく、deployment/startup policy の別 assertion として設計する必要がある。

### 2. browser test と API test の責務を分ける

主要ユーザー導線（実 frontend のロード、JavaScript、作成操作、一覧反映）は既存 browser test に残す。細かな status/body/order/error envelope は同じ Playwright suite の `request` fixture から Ingress 越しに直接確認する。これは coding standards の「主要正常系は browser、画面から到達しにくい contract は同じ Job から public API」と一致する。

テスト間で件数を共有すると順序依存になるため、unique name を使い、一覧の該当要素の相対順だけを検査するか、各ケースが作成したデータだけで assertion を閉じる。namespace は run ごとに clean だが、同一 run 内の Playwright test isolation は別問題である。

### 3. 受入確認を行う

最低限、次を確認する。

1. `rg -i testcontainers backend` が dependency/harness を検出しない。
2. `task backend:test` が cluster/Docker なしで成功する。
3. `task check` が dependency-free tests、static checks、E2E image と Kustomize render を検証する。
4. configured k3s 上で `task test` を実行し、新旧対応表の全 assertions が単一 `dsa-e2e` Job から成功する。
5. test code が `E2E_BASE_URL` 以外の Service/DB endpoint や datastore seed を使っていないことをレビューする。

## スコープ上の注意

- 現行 CI には k3d を provision して E2E Job を実行する job がまだなく、`flake-check` と `codegen-check` のみである（[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)）。Issue 113 と ADR 0012 は最終的に CI でも同じ Job を走らせるとしているが、Issue 121 の本文は Kubernetes Job への assertion 移行を直接の受入条件としており、CI adapter の追加は別 child issue の可能性が高い。Issue 121 実装時には関連 Issue を確認し、重複実装しないこと。
- ADR 0011 本文の旧 decision paragraph と consequence には今も `testcontainers` / Docker requirement が歴史的記述として残るが、直前に superseded scope が明記されている。削除ではなく decision record として保持するのが自然である。

## 調査資料

- GitHub Issues: [#121](https://github.com/dsa-uts/dsa-project/issues/121), [#120](https://github.com/dsa-uts/dsa-project/issues/120), [#113](https://github.com/dsa-uts/dsa-project/issues/113)
- 旧 testcontainers suite の撤去: [`d2b0467`](https://github.com/dsa-uts/dsa-project/commit/d2b04675601727166b2e25fe3dc8d74b2683e778)
- Kubernetes Job と初期 public-interface tests の追加: [`39f7941`](https://github.com/dsa-uts/dsa-project/commit/39f79414021fa8f4a72646dff529f78018ae7cc6)
- 現行方針: [`ADR 0012`](../adr/0012-deployed-interface-tests.md), [`ADR 0011`](../adr/0011-seam-limited-interfaces-real-db-tests.md), [`coding standards`](../agents/coding-standards.md)

## ノート配置

この repository には ADR (`docs/adr`)、agent 向け規約 (`docs/agents`)、仕様 (`docs/spec`) はあるが、issue 調査ノートの既存規約はなかった。既存文書と混同しないよう、この単一ノートを `docs/research/issue-121.md` に置いた。
