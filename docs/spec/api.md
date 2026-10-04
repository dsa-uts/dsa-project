# REST API 仕様

このドキュメントは Conventions と未実装エンドポイントの API 草稿を所有する。実装時に [OpenAPI](../../api/openapi.yaml) へ移す(ADR 0010)。ドメイン規則は [CONTEXT.md](../../CONTEXT.md)、取得・保存は [Resource 取り込み仕様](resource-imports.md)、Resource の形式は [dsa-resource-spec](https://github.com/dsa-uts/dsa-resource-spec) を参照する。

公開 API の語彙では Project と Version を使う。Resource / Resource Version は internal / admin の概念に留める。ただし Project 一覧には対応する Resource の識別子 `resource_id` を含める。`version_id` は DB 上の UUID、`version` は表示用の正式版 SemVer (`v1.2.3` など)。

## Conventions

- Base path: `/api`
- 認証: backend-managed session cookie。`HttpOnly` / `Secure` / `SameSite=Lax`。
- ID: opaque な UUID 文字列。
- Timestamp: RFC 3339 UTC 文字列。
- User の埋め込みは常に 3 点セット `{"id": "uuid", "userid": "student001", "name": "山田 太郎"}` で統一する。
- Request と Submission のレコードは immutable(Archive-not-Edit)。更新系エンドポイントは存在しない。
- クライアントは polling する。SSE / WebSocket は要件にない。polling の受け口は [`GET /api/requests/{request_id}`](#get-apirequestsrequest_id)。
- 一覧系 API はページネーションを持たず全件を返す。1 クラス分(ユーザー数百・提出数百)という規模がドメインの前提。将来 cursor を後方互換で追加できるよう、一覧レスポンスのトップレベルは配列ではなく object にする。
- Status の集約値(「2/3 AC」等の進捗表示)と遅延表示はクライアント導出。一覧系 API は per-Workflow の Status と素の時刻を返し、判定済みフラグを持たない。

### Roles

各エンドポイントの認可はエンドポイント側に記載する。ここは概要のみ。

| Role | 概要 |
| --- | --- |
| Student | 自分の validation Submission と Request を作成・参照する。 |
| Manager | evaluation の Submission / Request を管理し、全ユーザーの結果を参照する。 |
| Admin | ユーザー、Project の公開日時・締切・表示順、Resource の手動インポートを管理する。 |

## Projects

一覧APIは [OpenAPI](../../api/openapi.yaml) の `GET /api/projects` を参照。

課題詳細APIは [OpenAPI](../../api/openapi.yaml) の `GET /api/projects/{project_id}` を参照。

- 全ロールで常に最新の取り込み済み Version を返す。Version を指定するリクエストパラメータは設けない。
- 一覧の各 Project と同じフィールドに、課題全体の `required_files` と各 Workflow の `description_markdown` を追加する。Workflow は ID の辞書順。Job は返さない。
- `required_files` は Resource の表示用案内を記載順・内容そのままで返す。未指定は `[]`。提出可否の判定には使わない。
- 説明は保存済み Markdown 本文。未指定は空文字。Markdown のファイル添付機能は持たず、添付ファイル配信や URL 書き換えは行わない。
- `my_result` は結果取得実装まで `null`。Student から不可視の課題と不存在の課題はともに `404`。

### `GET /api/projects/{project_id}/versions`

Manager/Admin 専用。過去結果の比較・検索のために取り込み済み Version を列挙する。GitHub 上の取り込み候補一覧ではなく、過去 Version の実行指定にも使わない。

```json
{
  "versions": [
    {
      "id": "uuid",
      "version": "v1.0.0",
      "is_latest": true,
      "registered_at": "2026-04-01T00:00:00Z"
    }
  ]
}
```

- `registered_at` 降順。
- Version は `version` の SemVer を表示する。
- Errors: `403`(Student)

Project の公開日時・締切・表示順の更新は Admin 専用の `PATCH /api/admin/projects` ([OpenAPI](../../api/openapi.yaml)) に統一する。個別更新 API と並び順専用 API は設けない。初回取り込みで作成した Project は末尾に追加し、Version 更新では順序を変更しない。

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
| `archived_at` | evaluation は archive されるまで `null`。validation は常に `null`。 |

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
  - `422 subject_user_required`(evaluation で `subject_user_id` 欠落)
  - `422 original_submitted_at_required`(evaluation で `original_submitted_at` 欠落)
  - `422 original_submitted_at_not_allowed`(validation で `original_submitted_at` を指定)
  - `422 invalid_path`(`..`・絶対パス・重複パス)
  - `422 too_many_files` / `422 upload_too_large`

### `POST /api/submissions/{submission_id}/archive`

Manager/Admin 専用。evaluation Submission を archive し、所属するすべての Request を通常の結果表示から外す(Archive-not-Edit)。validation Submission は全 Role で archive 不可。

- 冪等: 既に archived でも `204` を返す。
- 対象 Submission の pending / queued / running な Request はキャンセルしない。走っているものは走り切る。
- Response: `204`
- Errors: `403`(Student)、`404`(不存在)、`422 submission_kind_not_archivable`(validation Submission)

## Requests

### Request fields

| field | description |
| --- | --- |
| `id` | Request UUID。 |
| `project_id` | 対象 Project。 |
| `version_id` | 作成時点の latest に固定した単一の対象 Version(Single-Version Request)。 |
| `version` | 実行対象 Version の SemVer。 |
| `submission` | 対象 Submission の要約: `id`、`kind`、`subject_user`(3 点セット)、`uploaded_at`、`content_hash`。 |
| `requested_by` | actor の User(3 点セット)。 |
| `requested_at` | Request 作成時刻。 |
| `state` | `pending` / `queued` / `running` / `completed`。 |
| `status` | `completed` まで `null`。完了後は Status(Worst-wins で集約)。 |

上記は未実装の取得 API の草稿であり、作成 API のレスポンスではない。作成の API contract は OpenAPI を参照する。Submission / Request 間の訂正元・再実行元を示す導出関係は保存しない。各 Request の対象 Submission と Resource Version への参照は保持する。

### Request 作成

Validation の作成は `POST /api/projects/{project_id}/validation` ([OpenAPI](../../api/openapi.yaml)) に移行した。multipart による提出と JSON による再実行を受け付ける。作成レスポンスを含む API contract は OpenAPI を参照する。

旧案の共通 `POST /api/projects/{project_id}/requests` は採用しない。Evaluation の作成は未実装で、[設計メモ](../design/request-judge-decisions.md)を参照する。

## Admin

Admin 専用。Student / Manager は `403`。

実装済みの `PATCH /api/admin/projects` と `POST /api/admin/resource-imports` は [OpenAPI](../../api/openapi.yaml) を参照。取り込みのドメイン規則は [Resource取り込み仕様](resource-imports.md) を参照。

## 未定

存在は確定しているが、設計が未決のため本ドキュメントがまだ形を定義しないもの。

- **Status 比較通知**: 手動再実行前後の per-Workflow Status 比較の通知。通知の要否・チャネル・見せ方は未定。
- **初期セットアップ API**: 初回起動時の Admin パスワード等の設定。
