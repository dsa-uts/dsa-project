# REST API 仕様

このドキュメントはクライアント向け REST API の形を所有する。Resource リポジトリと Resource YAML の仕様は [resource.md](./resource.md)、用語と Principles は [CONTEXT.md](../../CONTEXT.md) を正とする。

公開 API の語彙では Project と Version を使う。Resource / Resource Version は internal / admin の概念に留める。

## Conventions

- Base path: `/api`
- 認証: backend-managed session cookie。
- ID: opaque な UUID 文字列。
- Timestamp: RFC 3339 UTC 文字列。
- Request と Submission のレコードは immutable。訂正は Archive-not-Edit に従い、旧 Submission を archive して新規作成する。
- Request は Single-Version Request に従い、1 Project、1 Submission、1 Version、その Version の全 Workflow を対象とする。
- クライアントは polling する。SSE / WebSocket は要件にない。

## Roles

| Role | 概要 |
| --- | --- |
| Student | 自分の validation Submission と Request を作成する。最新 Version に対する自分の public な validation 結果を見る。 |
| Manager | 自分の validation Request と、任意の Subject User への evaluation Request を作成する。全ユーザーの validation / evaluation 結果を見る。1 Submission に対する複数 Request を見て Version 間比較ができる。 |
| Admin | ユーザー、Project の表示順、Resource 登録の credential を管理する。 |
| System Account | 新しい Version 登録後に作成される queued rerun Request の actor。 |

## Auth

### `POST /api/session`

セッションを作成する。

```json
{
  "userid": "student001",
  "password": "..."
}
```

### `DELETE /api/session`

現在のセッションを削除する。

### `GET /api/me`

現在の User Account と Role を返す。

## Projects

### `GET /api/projects`

Project を `display_order` 順で返す。

```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "DSA Basic",
      "latest_version_id": "uuid",
      "display_order": 10
    }
  ]
}
```

### `GET /api/projects/{project_id}`

既定では最新の Project view を返す。

Query:

| name | role | description |
| --- | --- | --- |
| `version_id` | Manager/Admin | 明示的な Version ID。Student は古い Version を指定できない。 |

### `GET /api/projects/{project_id}/versions`

Manager/Admin 専用。diff 表示と手動 rerun のために Version を列挙する。

### `PATCH /api/projects/order`

Admin 専用。drag-and-drop の表示順を DB に永続化する。初期順序は Resource リポジトリの root manifest から import する。

```json
{
  "project_ids": ["uuid-1", "uuid-2", "uuid-3"]
}
```

## Submissions

### Submission fields

| field | description |
| --- | --- |
| `id` | Submission UUID。 |
| `project_id` | 対象 Project。 |
| `kind` | `validation` または `evaluation`。 |
| `subject_user_id` | 判定対象の User Account。 |
| `uploader_id` | archive をアップロードした User Account。 |
| `uploaded_at` | アップロード時刻。 |
| `original_submitted_at` | evaluation import 用の外部提出時刻。optional。 |
| `content_hash` | path normalization 後の file tree の hash(Normalized Submission Identity)。 |
| `archived_at` | archive されるまで null。 |

Rules:

- file 内容、`project_id`、`kind`、`subject_user_id`、`uploader_id`、`uploaded_at`、`original_submitted_at`、`content_hash` は immutable。
- `kind=validation` は `subject_user_id == uploader_id` を要求する。
- `kind=evaluation` は別の Subject User を指定できる。
- 2 つの Submission が同じ `content_hash` を持ちうる。その場合も `id` は異なる。

### `POST /api/projects/{project_id}/submissions`

Submission archive をアップロードする。

Request: `multipart/form-data`

| field | required | description |
| --- | --- | --- |
| `archive` | yes | Submission archive file。 |
| `kind` | yes | `validation` または `evaluation`。 |
| `subject_user_id` | evaluation のみ | evaluation では必須。validation では現在のユーザーを使う。 |
| `original_submitted_at` | no | evaluation import 用の外部提出時刻。 |

Response:

```json
{
  "id": "uuid",
  "content_hash": "sha256:..."
}
```

### `POST /api/submissions/{submission_id}/archive`

Submission を archive し、その Request を通常の結果表示から隠す。訂正は Submission metadata の編集ではなく、この API で行う(Archive-not-Edit)。

## Requests

### Request fields

| field | description |
| --- | --- |
| `id` | Request UUID。 |
| `submission_id` | 判定対象の Submission。 |
| `version_id` | 単一の対象 Version(Single-Version Request)。 |
| `requested_by` | actor の User Account。System Account を含む。 |
| `requested_at` | Request 作成時刻。 |
| `derived_from_request_id` | 訂正・retry の lineage link。nullable。 |
| `state` | `pending`, `queued`, `running`, `completed`。 |
| `status` | 完了まで null。完了後 `AC`, `WA`, `TLE`, `MLE`, `RE`, `OLE`, `IE`。 |

Rules:

- Request はその Version の全 Workflow を必ず実行する。
- Student は自分の non-archived な validation Submission に対してのみ validation Request を作成できる。
- Manager は non-archived な evaluation Submission に対して evaluation Request を作成できる。
- Version 省略時は latest。
- Student は latest Version のみ使える。Manager は明示的な Version ID を渡せる。

### `POST /api/projects/{project_id}/requests`

Request を作成する。

```json
{
  "submission_id": "uuid",
  "version_id": "uuid",
  "derived_from_request_id": null
}
```

### `GET /api/projects/{project_id}/requests`

可視な Request を列挙する。archived Submission の Request は既定で除外する。

Query:

| name | description |
| --- | --- |
| `kind` | `validation` または `evaluation`。 |
| `subject_user_id` | Manager/Admin 用 filter。 |
| `version_id` | diff 表示用 filter。 |
| `include_archived` | Manager/Admin の監査 view 専用。 |

### `GET /api/requests/{request_id}`

1 つの Request、Workflow ごとの集約結果、可視な Job 結果を返す。

## Results

Step 単位の詳細結果を保存する。Job / Workflow / Request の `status` は導出された集約値であり、Worst-wins に従う:

```text
IE > OLE > MLE > TLE > RE > WA > AC
```

Status 比較通知は、新しい latest Version と旧 latest Version の per-Workflow 集約 Status を比較する。

## Artifacts

Artifact は Private-by-Default。Resource YAML で `public` 宣言され、かつ生成元の Job がそのクライアントに可視な場合のみ配信する。`content-type` の許可リストは [resource.md](./resource.md) が所有する。

### `GET /api/requests/{request_id}/artifacts/{artifact_id}`

認証済み API のみ。現在のユーザーに可視な public Artifact を、宣言された `Content-Type` で返す。

private Artifact にはクライアント向けダウンロード API がない。

## Queued Reruns

新しい Version が latest になったとき、システムは先に pending Request を作成し、その後実行を enqueue する。

各 `(project_id, kind, subject_user_id)` について、source Submission は `uploaded_at` が最新の non-archived Submission とする。

Queued rerun の対象:

- 最新の validation Submission
- 最新の evaluation Submission

`requested_by` の actor は System Account。

## Admin Resource Registration

### `POST /api/admin/resource-versions`

Registration-only API。sandbox image の build / push 後に GitHub Actions が呼ぶ。登録フロー、Backend 側の validation、payload の意味は [resource.md](./resource.md) の「Resource Version 登録フロー」を正とする。

```json
{
  "resource_id": "dsa-basic",
  "source_ref": "git-commit-sha",
  "workflow_run_id": "github-actions-run-id",
  "sandbox_images": {
    "default": {
      "image": "ghcr.io/example/dsa-basic-sandbox",
      "tag": "git-commit-sha",
      "digest": "sha256:..."
    }
  }
}
```

`sandbox_images` の key は Resource YAML の `sandbox-images` ID。全 ID に digest が揃っていない場合、登録は reject される。
