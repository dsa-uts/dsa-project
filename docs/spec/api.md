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
| `401` | 未認証。セッションなし・期限切れ、またはregistration credential不正。 |
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
| Admin | ユーザー、Project の公開日時・締切・表示順、Resource の手動インポートを管理する。 |
| System Account | システムが自動作成する Request の actor。ログイン不可。 |

## Projects

### `GET /api/projects`

全 Project を `display_order` 昇順で返す。クライアントの Project 一覧ページ(学生の一層目: 進捗列付き)と管理者の Project Management ページの受け口。

Role による可視範囲:

- Student: 公開済み(`published_at` ≤ 現在)の Project のみ。
- Manager/Admin: 全 Project。未公開を含む。Project の自動アーカイブは行わない。

```json
{
  "projects": [
    {
      "id": "uuid",
      "resource_id": "ex1",
      "name": "DSA Basic",
      "latest_version_id": "uuid",
      "latest_version": "v1.0.0",
      "display_order": 10,
      "published_at": "2026-04-01T00:00:00Z",
      "deadline": "2026-04-15T23:59:59Z",
      "workflows": [
        { "id": "basic", "name": "基本課題" },
        { "id": "applied", "name": "発展課題" }
      ],
      "my_result": {
        "submission_id": "uuid",
        "uploaded_at": "2026-04-10T12:00:00Z",
        "request": {
          "id": "uuid",
          "version_id": "uuid",
          "version": "v1.0.0",
          "state": "completed",
          "status": "WA",
          "workflows": [
            { "id": "basic", "status": "AC" },
            { "id": "applied", "status": "WA" }
          ]
        }
      }
    }
  ]
}
```

- `resource_id`: 対応する Resource の識別子。Project の UUID とは別で、全 Role に返す。
- `published_at` / `deadline` は nullable。`published_at` が `null` は未公開と同義(CONTEXT.md「公開日時」)。
- `my_result`: 自分の validation Submission に属する最新 Request とその Submission を返す。Version で絞らない。Request がなければ `my_result: null`。課題更新だけでは変化しない。
- `my_result.request.workflows`: per-Workflow の Status。進捗セル(「2/3 AC」や status chip)はここからクライアント導出。

### `GET /api/projects/{project_id}`

Project view は常に latest Version を返す。`version_id` による切り替えは受け付けない。過去の実行内容は Request 詳細で参照する。

```json
{
  "id": "uuid",
  "name": "DSA Basic",
  "version": {
    "id": "uuid",
    "version": "v1.0.0",
    "is_latest": true,
    "registered_at": "2026-04-01T00:00:00Z"
  },
  "workflows": [
    {
      "id": "judge",
      "name": "Judge",
      "description_markdown": "# 課題1 ...",
      "jobs": [
        { "id": "build", "name": "コンパイル" },
        { "id": "test-public", "name": "基本テスト" }
      ]
    }
  ]
}
```

- `description_markdown`: Workflow の `description-path`([Resource 定義書](https://github.com/dsa-uts/dsa-resource-spec/blob/v1.1.0/docs/resource.md) 所有)の Markdown 本文をインラインで埋め込む。宣言がなければ空文字。
- `jobs`: 現在の Role で見れる Job のみ(Private-by-Default)。Student は public Job のみ、Manager/Admin は全 Job 見れる。
- Errors: `404`(Project 不存在、または未公開で Student から不可視)、`422 version_not_allowed`(`version_id` を指定)

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

Project の公開日時・締切・表示順の更新は Admin 専用の [`PATCH /api/admin/projects`](#patch-apiadminprojects) に統一する。個別更新 API と並び順専用 API は設けない。初回取り込みで作成した Project は末尾に追加し、Version 更新では順序を変更しない。

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
| `requested_by` | actor の User(3 点セット)。System Account を含む。 |
| `requested_at` | Request 作成時刻。 |
| `state` | `pending` / `queued` / `running` / `completed`。 |
| `status` | `completed` まで `null`。完了後は Status(Worst-wins で集約)。 |

上記を Request コアオブジェクトと呼ぶ。作成 API のレスポンスはコアのみ、詳細 API はコア + `workflows` を返す。Submission / Request 間の訂正元・再実行元を示す導出関係は保存しない。各 Request の対象 Submission と Resource Version への参照は保持する。

### `POST /api/projects/{project_id}/requests`

Request を作成する。Request はその Version の全 Workflow を実行する(Single-Version Request)。

```json
{
  "submission_id": "uuid"
}
```

- サーバーが Request 作成時点の latest を確定する。初回・手動再実行とも同じ規則で、待機中の課題更新でも Version は変更しない。`version_id` は受け付けない。
- 認可:
  - Student: 自分の validation Submission に対してのみ。Version は latest のみ。
  - Manager/Admin: non-archived な evaluation Submission と、自分の validation Submission。いずれも作成時点の latest。
- Response: `201` + Request コアオブジェクト(`state` は `pending`)
- Errors:
  - `404`(Submission が不可視・不存在)
  - `409 submission_archived`
  - `422 version_not_allowed`(`version_id` を指定)
  - `409 duplicate_request`(同一 `(submission_id, version_id)` の Request が `pending` / `queued` / `running` に存在する間。完了後の再実行は許可)

### `GET /api/requests/{request_id}`

1 つの Request の全結果ツリーを返す。polling の受け口。Version が古くなっても参照可能で、学生は自分の validation Request を閲覧できる。Workflow の構成・実行内容は Request に固定された Version を使う。Project の公開状態・所有者・evaluation Submission の archive・Job の可視性による認可は維持する。

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "version_id": "uuid",
  "version": "v1.0.0",
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
- `stdout` / `stderr` はインラインで返す。サイズ上限は Job の `limits`([Resource 定義書](https://github.com/dsa-uts/dsa-resource-spec/blob/v1.1.0/docs/resource.md) 所有)が保証する。
- 未実行の Step の `exit_code` / `status` / `stdout` / `stderr` / `duration_ms` は `null`。
- `artifacts` の `capture_status`: `captured` / `missing`。Artifact の取得は [Artifacts](#artifacts) を参照。
- Errors: `404`(不存在・不可視)

## Results

一覧系の読み取りはビュー専用エンドポイントで返す。validation / evaluation とも Request-Based Results に従う。

- 1 行 = 1 Request。同じ Submission の再実行も別の行として残す。
- archived evaluation Submission とその Request は通常の結果一覧に表示しない。validation に archive による非表示はない。
- 過去 Version の Request も返す。課題更新だけで一覧・詳細を置換したり「未実行」の行を作ったりしない。
- 各行に `version_id` と SemVer の `version` を含める。`request` は必ず存在する。
- `request.workflows` はその Request の Version の `{id, name, status}`。Workflow 数や進捗は行ごとに導出し、latest の Workflow 構成を流用しない。
- `requested_at` 降順、同時刻は Request ID 順で全件返す。

### `GET /api/projects/{project_id}/my-results`

現在のユーザー自身の、この Project における validation Request 履歴。全 Role が使える。

```json
{
  "results": [
    {
      "submission": {
        "id": "uuid",
        "uploaded_at": "2026-04-10T12:00:00Z",
        "content_hash": "sha256:..."
      },
      "request": {
        "id": "uuid",
        "version_id": "uuid",
        "version": "v1.0.0",
        "state": "completed",
        "status": "WA",
        "requested_at": "2026-04-10T12:01:00Z",
        "requested_by": { "id": "uuid", "userid": "student001", "name": "山田 太郎" },
        "workflows": [
          { "id": "basic", "name": "Basic Test", "status": "AC" },
          { "id": "graphs", "name": "Graph Test", "status": "WA" }
        ]
      }
    }
  ]
}
```

- 自分の validation Submission に属する Request を返す。Request がなければ `results: []`。
- Errors: `404`(Project 不存在・不可視)

### `GET /api/projects/{project_id}/results`

Manager/Admin 専用。この Project の全ユーザーの evaluation Request 履歴。未提出者を含む名簿ではなく Request 単位の一覧を返す。

Query:

| name | description |
| --- | --- |
| `version_id` | 任意の取り込み済み Version で絞り込む。省略時は全 Version。実行対象の指定ではない。 |

```json
{
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
        "version_id": "uuid",
        "version": "v1.0.0",
        "state": "completed",
        "status": "WA",
        "requested_at": "2026-04-16T09:01:00Z",
        "requested_by": { "id": "uuid", "userid": "manager001", "name": "教員" },
        "workflows": [
          { "id": "basic", "name": "Basic Test", "status": "WA" }
        ]
      }
    }
  ]
}
```

- non-archived evaluation Submission の Request を返す。無効化済みユーザーの結果も含む。Request がなければ `rows: []`。
- 遅延強調はクライアント導出: Project の `deadline` が設定済み ∧ `original_submitted_at` > `deadline`。
- Errors: `403`(Student)、`404`(Project / Version 不存在、または Version が別 Project に属する)

## Artifacts

Artifact は Private-by-Default。Resource YAML で `public` 宣言され、かつ生成元の Job がそのクライアントに可視な場合のみ配信する。`artifact_id` は [`GET /api/requests/{request_id}`](#get-apirequestsrequest_id) の `artifacts` 配列で発見する。`content-type` の許可リストは [Resource 定義書](https://github.com/dsa-uts/dsa-resource-spec/blob/v1.1.0/docs/resource.md) が所有する。

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

## Admin

Admin 専用。Student / Manager は `403`。

### `PATCH /api/admin/projects`

全 Project の公開日時・締切・表示順を一括更新する(Git-for-Logic, Console-for-Operations)。Project Management ページの「変更を保存」の受け口。

- 認証: 通常の Admin session cookie と CSRF 対策。

```json
{
  "projects": [
    {
      "id": "uuid-1",
      "published_at": "2026-09-12T10:59:00Z",
      "deadline": "2026-09-19T10:59:00Z"
    },
    {
      "id": "uuid-2",
      "published_at": null,
      "deadline": null
    }
  ]
}
```

- `projects` は必須。全 Project の ID を過不足なく含むこと。欠落・重複・未知の ID は拒否する。Project が存在しない場合は空配列を許可する。
- 各要素の `id` / `published_at` / `deadline` は必須。日時は RFC 3339 UTC 文字列または `null`。`null` は未設定を表し、フィールド省略による部分更新は許可しない。
- 両日時が設定されている場合は `published_at <= deadline` を必須とする。同時刻、および片方・両方が `null` の設定は許可する。
- 配列順を `display_order` に反映する。更新対象は公開日時・締切・表示順のみで、名前・Resource・Version は変更しない。
- 検証と全 Project の更新を1トランザクションで行う。不備があれば何も更新しない。
- リビジョン等による同時編集の競合検知は設けない。後から保存した日時・表示順で上書きする。ただし、全 ID の過不足チェックは保存時に行う。
- Response: `204 No Content`。クライアントは保存後に [`GET /api/projects`](#get-apiprojects) を再取得する。
- Errors:
  - `401`(未認証)、`403`(Admin 以外)
  - `422 project_ids_mismatch`(ID の欠落・重複・未知の ID)
  - `422`(必須フィールドの欠落、日時の形式違反、締切が公開日時より前)

### `POST /api/admin/resource-imports`

Manual Resource Import。Admin が課題 ID と Version を指定し、1 課題を同期的に取り込む。取得・検証・保存の規則は [Resource 取り込み仕様](resource-imports.md) を参照する。

- 認証: 通常の Admin session cookie と CSRF 対策。
- リポジトリは環境変数で固定。URL・コミット SHA・image の上書きは受け付けない。

```json
{
  "resource_id": "ex1",
  "version": "v1.2.3"
}
```

- `version`: `vMAJOR.MINOR.PATCH` 形式の正式版 SemVer。プレリリース・ビルドメタデータ・数値の不要な先頭ゼロは不可。
- Response: `200`。初回登録・更新・変更なしとも同形。

```json
{
  "project_id": "11111111-1111-4111-8111-111111111111",
  "version_id": "22222222-2222-4222-8222-222222222222",
  "resource_id": "ex1",
  "version": "v1.2.3",
  "changed": true
}
```

- 現在と同じ Version は GitHub にアクセスせず、既存 ID と `changed: false` を返す。
- 古い Version は取り込み済みでも拒否。新Versionでは `changed: true`。
- 初回は未公開の Project を自動作成。更新時はタイトルを更新し、公開日時・締切・並び順を維持する。
- validation / evaluation とも自動再採点を行わない。
- Errors（DB の部分更新はしない）:
  - `401`（未認証）、`403`（Admin 以外）
  - `404 resource_version_not_found`（指定課題 ID・Version が index にない）
  - `409 older_resource_version`（現在より古い Version）
  - `422 invalid_resource_version`（Version の形式違反）
  - `422 invalid_resource`（課題 JSON の検証失敗、ID・Version の不一致、index の構造不正）
  - `422 resource_hash_mismatch`（index とのハッシュ不一致）
  - `503 resource_source_unavailable`（認証失敗、レート制限、通信障害、index や参照先 JSON の取得失敗）
- エラーコードで原因を区別し、レスポンスにトークンや upstream のレスポンス本文を含めない。ログ・アラートの詳細は未定。
- 取り込み候補を列挙する API、取り込みジョブ・進捗 API は設けない。

## 未定

存在は確定しているが、設計が未決のため本ドキュメントがまだ形を定義しないもの。

- **Status 比較通知**: 手動再実行前後の per-Workflow Status 比較の通知。通知の要否・チャネル・見せ方は未定。
- **初期セットアップ API**: 初回起動時の Admin パスワード等の設定。
