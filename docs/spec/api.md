# REST API 仕様

このドキュメントはクライアント向け REST API の形(path、method、リクエスト/レスポンススキーマ、ステータスコード、エンドポイントごとの認可)を所有する。ドメイン規則はここで再説明せず、[CONTEXT.md](../../CONTEXT.md) の用語と Principles を名前で参照する。Resource リポジトリと Resource YAML の仕様は [resource.md](./resource.md) を正とする。

公開 API の語彙では Project と Version を使う。Resource / Resource Version は internal / admin の概念に留める(例外は [Versions](#get-apiprojectsproject_idversions) の `source_ref` を参照)。

## Conventions

- Base path: `/api`
- 認証: backend-managed session cookie。`HttpOnly` / `Secure` / `SameSite=Lax`。例外として [`POST /api/admin/resource-versions`](#post-apiadminresource-versions) のみ Bearer token 認証。
- ID: opaque な UUID 文字列。
- Timestamp: RFC 3339 UTC 文字列。
- User の埋め込みは常に 3 点セット `{"id": "uuid", "userid": "student001", "name": "山田 太郎"}` で統一する。
- Request と Submission のレコードは immutable(Archive-not-Edit)。更新系エンドポイントは存在しない。
- クライアントは polling する。SSE / WebSocket は要件にない。polling の受け口は [`GET /api/requests/{request_id}`](#get-apirequestsrequest_id)。
- 一覧系 API はページネーションを持たず全件を返す。1 クラス分(ユーザー数百・提出数百)という規模がドメインの前提。将来 cursor を後方互換で追加できるよう、一覧レスポンスのトップレベルは配列ではなく object にする。
- Status の集約値(「2/3 AC」等の進捗表示)と遅延表示はクライアント導出。一覧系 API は per-Workflow の Status と素の時刻を返し、判定済みフラグを持たない。

### エラーレスポンス

エラーは統一エンベロープで返す:

```json
{
  "error": {
    "code": "submission_archived",
    "message": "Cannot create a request for an archived submission."
  }
}
```

- `code` は snake_case の機械可読文字列。クライアントの分岐と UI 文言の選択に使う。
- `message` は開発者向けの英語文。UI にそのまま表示しない。

ステータスコードの方針:

| status | 意味 |
| --- | --- |
| `401` | 未認証。セッションなし・期限切れ・Bearer token 不正。 |
| `403` | 存在が自明なリソース・エンドポイントへの Role 不足。 |
| `404` | リソースが存在しない、**または現在の Role から不可視**。存在を漏らさないため両者を区別しない。 |
| `409` | 状態競合。 |
| `422` | バリデーション失敗。 |

## Roles

各エンドポイントの認可はエンドポイント側に記載する。ここは概要のみ。

| Role | 概要 |
| --- | --- |
| Student | 自分の validation Submission と Request を作成・参照する。 |
| Manager | evaluation の Submission / Request を管理し、全ユーザーの結果を参照する。 |
| Admin | ユーザー、Project の表示順、Resource 登録の credential を管理する。 |
| System Account | システムが自動作成する Request の actor。ログイン不可。 |

## Auth

### `POST /api/session`

セッションを作成する。

```json
{
  "userid": "student001",
  "password": "..."
}
```

- Response: `200` + [`GET /api/me`](#get-apime) と同一の User オブジェクト。cookie を設定する。
- Errors: `401 invalid_credentials`(userid 不存在とパスワード誤りは区別しない)

### `DELETE /api/session`

現在のセッションを削除する。冪等: セッションが既に無くても `204` を返す。

### `GET /api/me`

現在の User Account を返す。

```json
{
  "id": "uuid",
  "userid": "student001",
  "name": "山田 太郎",
  "role": "student"
}
```

- `role`: `student` / `manager` / `admin`
- Errors: `401`

## Projects

### `GET /api/projects`

全 Project を `display_order` 昇順で返す。クライアントの Project 一覧ページ(学生の一層目: 進捗列付き)の受け口。

Role による可視範囲:

- Student: 公開済み(`published_at` ≤ 現在)かつ non-archived な Project のみ。
- Manager/Admin: 全 Project。未公開・Archived Project(CONTEXT.md)を含む。

```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "DSA Basic",
      "latest_version_id": "uuid",
      "display_order": 10,
      "published_at": "2026-04-01T00:00:00Z",
      "deadline": "2026-04-15T23:59:59Z",
      "archived": false,
      "my_result": {
        "submission_id": "uuid",
        "uploaded_at": "2026-04-10T12:00:00Z",
        "request": {
          "id": "uuid",
          "state": "completed",
          "status": "WA",
          "workflows": [
            { "id": "basic", "status": "AC" },
            { "id": "graphs", "status": "WA" }
          ]
        }
      }
    }
  ]
}
```

- `published_at` / `deadline` は nullable。`published_at` が `null` は未公開と同義(CONTEXT.md「公開日時」)。
- `my_result`: 現在のユーザー自身の進捗。Role を問わず、自分の最新 non-archived validation Submission と、その latest Version 上の最新 Request を返す。Submission がなければ `my_result: null`、latest Version 上の Request がなければ `request: null`(未実行。Converge-to-Latest)。
- `my_result.request.workflows`: per-Workflow の Status。進捗セル(「2/3 AC」や status chip)はここからクライアント導出。

### `GET /api/projects/{project_id}`

Project view を返す。既定では latest Version を解決する。

Query:

| name | role | description |
| --- | --- | --- |
| `version_id` | Manager/Admin | 明示的な Version ID。 |

```json
{
  "id": "uuid",
  "name": "DSA Basic",
  "version": {
    "id": "uuid",
    "is_latest": true,
    "registered_at": "2026-04-01T00:00:00Z"
  },
  "workflows": [
    {
      "id": "judge",
      "name": "Judge",
      "description_markdown": "# 課題1 ...",
      "jobs": [
        { "id": "build", "name": "Build" },
        { "id": "test-public", "name": "Public Test" }
      ]
    }
  ]
}
```

- `description_markdown`: Workflow の `description-path`(resource.md 所有)の Markdown 本文をインラインで埋め込む。宣言がなければ `null`。
- `jobs`: 現在の Role に可視な Job のみ(Private-by-Default)。Student には public Job のみ、Manager/Admin には全 Job。
- Errors: `404`(Project 不存在、または未公開・Archived で Student から不可視)、`403 version_not_allowed`(Student が latest 以外の `version_id` を指定)

### `GET /api/projects/{project_id}/versions`

Manager/Admin 専用。diff 表示と手動 rerun のために Version を列挙する。

```json
{
  "versions": [
    {
      "id": "uuid",
      "is_latest": true,
      "registered_at": "2026-04-01T00:00:00Z",
      "source_ref": "3f2a9c1d..."
    }
  ]
}
```

- `registered_at` 降順。
- `source_ref` は git commit SHA の完全形。Version の人間可読な識別に commit SHA しか実用手段がないため、Project / Version 語彙の例外としてここでのみ露出する。クライアントは先頭数文字に切り詰めて表示する。
- Errors: `403`(Student)

### `PATCH /api/projects/{project_id}`

Manager/Admin 専用。コンソール管理の運用メタデータを部分更新する(Git-for-Logic, Console-for-Operations)。

```json
{
  "published_at": "2026-04-01T00:00:00Z",
  "deadline": null
}
```

- 更新できるのは `published_at` / `deadline` のみ。`null` 指定で未設定に戻す。並び順は [`PATCH /api/projects/order`](#patch-apiprojectsorder) が所有する。
- Response: `200` + [`GET /api/projects`](#get-apiprojects) の要素と同形
- Errors: `403`(Student)、`404`、`422`

### `PATCH /api/projects/order`

Admin 専用。表示順を永続化する。初期順序は Resource リポジトリの root manifest から import する。

```json
{
  "project_ids": ["uuid-1", "uuid-2", "uuid-3"]
}
```

- 全 Project の ID を過不足なく含むこと。部分更新は許可しない。
- Response: `204`
- Errors: `403`、`422 project_ids_mismatch`(欠落・重複・未知の ID)

## Submissions

### Submission fields

| field | description |
| --- | --- |
| `id` | Submission UUID。 |
| `project_id` | 対象 Project。 |
| `kind` | `validation` または `evaluation`。 |
| `subject_user` | 判定対象の User(3 点セット)。 |
| `uploader` | アップロードした User(3 点セット)。 |
| `uploaded_at` | アップロード時刻。 |
| `original_submitted_at` | 外部ツール(Manaba 等)上の提出時刻。evaluation では必須、validation では持たない(`null`)。遅延表示の判定(Deadline との比較)にのみ使う。 |
| `content_hash` | `sha256:...`(Normalized Submission Identity)。 |
| `archived_at` | archive されるまで `null`。 |

`archived_at` 以外の全フィールドと file 内容は immutable(Archive-not-Edit)。

### `POST /api/projects/{project_id}/submissions`

Submission を構成する file 群をアップロードする。

Request: `multipart/form-data`

| field | required | description |
| --- | --- | --- |
| `files` | yes(複数可) | Submission を構成する各 file。part の `filename` に file tree 内の相対パスを入れる(例: `src/main.c`)。 |
| `kind` | yes | `validation` または `evaluation`。 |
| `subject_user_id` | evaluation のみ | validation では現在のユーザーを使う。 |
| `original_submitted_at` | evaluation のみ(必須) | RFC 3339 UTC。外部ツール上の提出時刻。validation で指定すると `422`。 |

- Backend は archive の展開をしない。zip / tar.gz の展開と Subject User ごとの振り分けはフロントエンドの責務であり、複数ユーザー分の一括アップロードは本エンドポイントの連続呼び出しで実現する。一括用エンドポイントは存在しない。
- 上限: 300 files、合計 50 MB。
- `kind=validation` は `subject_user_id == 現在のユーザー` になる。
- Response: `201`

```json
{
  "id": "uuid",
  "content_hash": "sha256:..."
}
```

- Errors:
  - `403`(Student が `kind=evaluation` を指定)
  - `404`(Project 不存在・不可視)
  - `409 project_archived`(Archived Project への新規 Submission)
  - `422 subject_user_required`(evaluation で `subject_user_id` 欠落)
  - `422 original_submitted_at_required`(evaluation で `original_submitted_at` 欠落)
  - `422 original_submitted_at_not_allowed`(validation で `original_submitted_at` を指定)
  - `422 invalid_path`(`..`・絶対パス・重複パス)
  - `422 too_many_files` / `422 upload_too_large`

### `POST /api/submissions/{submission_id}/archive`

Manager/Admin 専用。Submission を archive し、その Request を通常の結果表示から外す(Archive-not-Edit)。

- 冪等: 既に archived でも `204` を返す。
- 対象 Submission の pending / queued / running な Request はキャンセルしない。走っているものは走り切る。
- Response: `204`
- Errors: `403`(Student)、`404`(不存在)

## Requests

### Request fields

| field | description |
| --- | --- |
| `id` | Request UUID。 |
| `project_id` | 対象 Project。 |
| `version_id` | 単一の対象 Version(Single-Version Request)。 |
| `submission` | 対象 Submission の要約: `id`、`kind`、`subject_user`(3 点セット)、`uploaded_at`、`content_hash`。 |
| `requested_by` | actor の User(3 点セット)。System Account を含む。 |
| `requested_at` | Request 作成時刻。 |
| `state` | `pending` / `queued` / `running` / `completed`。 |
| `status` | `completed` まで `null`。完了後は Status(Worst-wins で集約)。 |

上記を Request コアオブジェクトと呼ぶ。作成 API のレスポンスはコアのみ、詳細 API はコア + `workflows` を返す。

### `POST /api/projects/{project_id}/requests`

Request を作成する。Request はその Version の全 Workflow を実行する(Single-Version Request)。

```json
{
  "submission_id": "uuid",
  "version_id": "uuid"
}
```

- `version_id` 省略時は latest。
- 認可:
  - Student: 自分の non-archived な validation Submission に対してのみ。Version は latest のみ。
  - Manager/Admin: non-archived な evaluation Submission(任意の Version)と、自分の validation Submission。
- Response: `201` + Request コアオブジェクト(`state` は `pending`)
- Errors:
  - `404`(Submission が不可視・不存在)
  - `409 submission_archived`
  - `409 project_archived`(Archived Project への新規 Request)
  - `403 version_not_allowed`(Student が latest 以外を指定)
  - `409 duplicate_request`(同一 `(submission_id, version_id)` の Request が `pending` / `queued` / `running` に存在する間。完了後の再実行は許可)

### `GET /api/requests/{request_id}`

1 つの Request の全結果ツリーを返す。polling の受け口。

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "version_id": "uuid",
  "submission": {
    "id": "uuid",
    "kind": "validation",
    "subject_user": { "id": "uuid", "userid": "student001", "name": "山田 太郎" },
    "uploaded_at": "2026-04-10T12:00:00Z",
    "content_hash": "sha256:..."
  },
  "requested_by": { "id": "uuid", "userid": "student001", "name": "山田 太郎" },
  "requested_at": "2026-04-10T12:01:00Z",
  "state": "running",
  "status": null,
  "workflows": [
    {
      "id": "judge",
      "name": "Judge",
      "state": "running",
      "status": null,
      "jobs": [
        {
          "id": "build",
          "name": "Build",
          "state": "completed",
          "status": "AC",
          "steps": [
            {
              "index": 0,
              "command": ["make", "all"],
              "exit_code": 0,
              "status": "AC",
              "stdout": "...",
              "stderr": "...",
              "duration_ms": 312
            }
          ],
          "artifacts": [
            {
              "id": "uuid",
              "name": "result.json",
              "public": true,
              "capture_status": "captured"
            }
          ]
        }
      ]
    }
  ]
}
```

- `jobs` は現在の Role に可視なもののみ(Private-by-Default)。
- Workflow / Request の `status` は可視性に関係なく全 Job から Worst-wins で導出した値。
- `stdout` / `stderr` はインラインで返す。サイズ上限は Job の `limits`(resource.md 所有)が保証する。
- 未実行の Step の `exit_code` / `status` / `stdout` / `stderr` / `duration_ms` は `null`。
- `artifacts` の `capture_status`: `captured` / `missing`。Artifact の取得は [Artifacts](#artifacts) を参照。
- Errors: `404`(不存在・不可視)

## Results

一覧系の読み取りはビュー専用エンドポイントで返す(汎用の Request 一覧 API は作らない)。教員名簿での「ユーザーごとに最新 Submission の最新 Request」をクライアント join で組むと N+1 になるため、各画面 1 リクエストで完結する形をサーバー側が所有する。共通規則:

- archived Submission とその Request は表示しない。
- `request` は表示対象 Version 上の最新 Request のみ(Converge-to-Latest)。存在しなければ `null`(未実行)。古い Version 上の Request はこれらの API に現れない。
- `request.workflows` は per-Workflow の `{id, status}`。集約表示(「2/3 AC」、Worst-wins バッジ、遅延強調)はすべてクライアント導出。

### `GET /api/projects/{project_id}/my-results`

現在のユーザー自身の、この Project における validation 試行履歴(学生の二層目)。全 Role が使える。

```json
{
  "version_id": "uuid",
  "workflows": [
    { "id": "basic", "name": "Basic Test" },
    { "id": "graphs", "name": "Graph Test" }
  ],
  "results": [
    {
      "submission": {
        "id": "uuid",
        "uploaded_at": "2026-04-10T12:00:00Z",
        "content_hash": "sha256:..."
      },
      "request": {
        "id": "uuid",
        "state": "completed",
        "status": "WA",
        "requested_at": "2026-04-10T12:01:00Z",
        "requested_by": { "id": "uuid", "userid": "system", "name": "System" },
        "workflows": [
          { "id": "basic", "status": "AC" },
          { "id": "graphs", "status": "WA" }
        ]
      }
    }
  ]
}
```

- 行 = 自分の non-archived validation Submission。`uploaded_at` 降順、全件。
- `version_id` / `workflows` は latest Version のもの。全行の分母(Workflow 数)はこれで揃う。
- `requested_by` で学生自身の Request と Queued Rerun(System Account)を区別できる。
- Errors: `404`(Project 不存在・不可視)

### `GET /api/projects/{project_id}/results`

Manager/Admin 専用。特定 Version 上の全ユーザーの evaluation 結果名簿。

Query:

| name | description |
| --- | --- |
| `version_id` | 対象 Version。省略時は latest。 |

```json
{
  "version": { "id": "uuid", "is_latest": true, "registered_at": "2026-04-01T00:00:00Z" },
  "workflows": [
    { "id": "basic", "name": "Basic Test" }
  ],
  "rows": [
    {
      "user": { "id": "uuid", "userid": "student001", "name": "山田 太郎" },
      "disabled": false,
      "submission": {
        "id": "uuid",
        "uploaded_at": "2026-04-16T09:00:00Z",
        "original_submitted_at": "2026-04-15T23:50:00Z",
        "content_hash": "sha256:..."
      },
      "request": {
        "id": "uuid",
        "state": "completed",
        "status": "WA",
        "requested_at": "2026-04-16T09:01:00Z",
        "workflows": [
          { "id": "basic", "status": "WA" }
        ]
      }
    }
  ]
}
```

- `rows` は [`PATCH /api/users/order`](#patch-apiusersorder) のグローバル表示順。System Account を除く全ユーザー(disabled 含む)を、Submission の有無に関わらず全件返す。未提出者の把握も本 API の要件。
- `submission` = その Project × Subject User の最新 non-archived evaluation Submission。なければ `null`(未提出)。同一ユーザーの過去の Submission はドリルダウン(Submission 単位の参照)で辿る。
- 遅延強調はクライアント導出: Project の `deadline` が設定済み ∧ `original_submitted_at` > `deadline`。
- Errors: `403`(Student)、`404`(Project / Version 不存在)

## Artifacts

Artifact は Private-by-Default。Resource YAML で `public` 宣言され、かつ生成元の Job がそのクライアントに可視な場合のみ配信する。`artifact_id` は [`GET /api/requests/{request_id}`](#get-apirequestsrequest_id) の `artifacts` 配列で発見する。`content-type` の許可リストは [resource.md](./resource.md) が所有する。

### `GET /api/requests/{request_id}/artifacts/{artifact_id}`

認証済み API のみ。現在のユーザーに可視な public Artifact の実体を返す。

- Response: `200`、body は Artifact そのもの。
- Response headers:
  - `Content-Type`: Resource YAML の宣言値。
  - `X-Content-Type-Options: nosniff`(必須。sandbox 由来の untrusted バイト列のため)
  - `Content-Disposition`: `image/*` と `text/plain` は `inline`、それ以外は `attachment; filename="<宣言名>"`。
  - `Cache-Control: private, max-age=3600`(Artifact は immutable)
- 生成元 Job の完了時点で配信可能とする。Request 全体の完了は待たない。
- Errors: `404`(Request 不可視 / Artifact が private / capture 失敗で実体なし、のいずれも区別しない)

private Artifact にはクライアント向けダウンロード API がない。

## Users

### `PATCH /api/users/order`

Manager/Admin 専用。ユーザーの表示順を永続化する。外部ツール(Manaba 等)の並び順に合わせるための機能で、順序はグローバルに 1 本(Manager 個人ごとの設定ではない)。

```json
{
  "user_ids": ["uuid-1", "uuid-2", "uuid-3"]
}
```

- System Account を除く全ユーザー(無効化済みを含む)の ID を過不足なく含むこと。
- [`GET /api/admin/users`](#get-apiadminusers) と今後のダッシュボード系 API のユーザー列挙は、この順序を既定とする。
- Response: `204`
- Errors: `403`(Student)、`422 user_ids_mismatch`(欠落・重複・未知の ID)

## Admin

Admin 専用。Student / Manager は `403`。

### `GET /api/admin/users`

全ユーザーを表示順で返す。ページネーションなし。System Account は含めない。

```json
{
  "users": [
    {
      "id": "uuid",
      "userid": "student001",
      "name": "山田 太郎",
      "role": "student",
      "disabled": false
    }
  ]
}
```

### `POST /api/admin/users`

ユーザーを作成する。スプレッドシートからの一括作成はフロントエンドが解析して本エンドポイントを連続呼び出しする。一括用エンドポイントは存在しない。

```json
{
  "userid": "student001",
  "name": "山田 太郎",
  "password": "initial-password",
  "role": "student"
}
```

- 初期パスワードは Admin 側が supply する。自動生成はしない。
- Response: `201` + 作成された User(`GET /api/admin/users` の要素と同形)
- Errors: `409 userid_taken`、`422`

### `PATCH /api/admin/users/{user_id}`

`name` / `role` / `password`(リセット)/ `disabled` の部分更新。`disabled: false` で無効化を解除する。

- Response: `200` + 更新後の User
- Errors: `404`、`422`

### `DELETE /api/admin/users/{user_id}`

soft delete。ログインを無効化し、レコードは保持する(Submission / Request の履歴が参照するため物理削除しない)。無効化済みユーザーは一覧に `disabled: true` で残る。

- Response: `204`
- Errors: `404`、`409 cannot_delete_system_account`、`409 cannot_delete_self`

### `POST /api/admin/resource-versions`

Registration-only API。sandbox image の build / push 後に GitHub Actions が呼ぶ。登録フロー、Backend 側の validation、payload の意味は [resource.md](./resource.md) の「Resource Version 登録フロー」を正とする。

- 認証: `Authorization: Bearer <registration-token>`。session cookie は使わない。token はデプロイ時に OpenBao 側で設定する static credential であり、MVP では token 管理 API を作らない(ローテーションは運用作業)。

```json
{
  "resource_id": "dsa-basic",
  "source_ref": "git-commit-sha",
  "actions_run_id": "github-actions-run-id",
  "sandbox_images": {
    "default": {
      "image": "ghcr.io/example/dsa-basic-sandbox",
      "tag": "git-commit-sha",
      "digest": "sha256:..."
    }
  }
}
```

- `sandbox_images` の key は Resource YAML の `sandbox-images` ID。
- 登録成功の副作用として Queued Rerun(CONTEXT.md)を enqueue する: 新 Version に対し、Project × ユーザーごとに直近の non-archived validation Submission(遡り件数は運用設定値、既定 5)と、Project × Subject User ごとに最新の non-archived evaluation Submission 1 件へ、System Account 名義の Request を自動作成する。
- Response: `201`
- Errors:
  - `401`(token 不正)
  - `409 version_already_registered`(同一 `source_ref` の再登録。GitHub Actions の再実行で起きうる)
  - `422 invalid_resource_yaml`(Resource YAML の validation 失敗)
  - `422 missing_image_digest`(全 `sandbox-images` ID に digest が揃っていない)

## 未定

存在は確定しているが、設計が未決のため本ドキュメントがまだ形を定義しないもの。

- **Status 比較通知**: 新旧 latest Version 間の per-Workflow Status 比較の通知。Queued Rerun の挙動は確定済み([Results](#results) / CONTEXT.md)だが、比較結果の通知チャネルと見せ方が未決。
- **初期セットアップ API**: 初回起動時の Admin パスワード等の設定。
