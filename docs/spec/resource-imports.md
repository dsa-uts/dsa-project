# Resource の取得・保存

Admin が課題 ID と Version を指定し、GitHub 上の公開済み課題 JSON を取得・検証して DB に保存する。保存完了と最新版への切り替えを一体の同期操作にする。API の形は [OpenAPI](../../api/openapi.yaml)、用語は [CONTEXT.md](../../CONTEXT.md) を参照する。

## 取得元と認証

- GitHub のみ対応し、環境ごとに 1 つのリポジトリ URL を環境変数で固定する。DB 設定や設定変更 API は設けない。
- Backend は `main` をコミット SHA に解決し、`release/index.json` と対象 JSON を必ず同じコミットから取得する。
- index は `resources[resource_id][version]` に `path`、`source-commit`、`resource-hash` を持つ。`path` は `release/<resource_id>/<version>.json` を指すリポジトリ内のパスとして検証し、任意 URL やパストラバーサルを許可しない。
- index の `source-commit` は JSON の生成元コミットであり、JSON の取得 ref には使わない。取得元コミットへの固定は読み取りの整合性のために行い、監査記録の保存は要求しない。
- private リポジトリ用と private GHCR 用の認証情報は別々に設定する。public リポジトリ・public イメージでは省略可能。
- リポジトリ取得には対象リポジトリの Contents 読み取り権限を持つ fine-grained PAT、GHCR の pull には `read:packages` を持つ classic PAT を利用できる。各トークンの所有者にも対象へのアクセス権が必要。認証情報は取得を担当する側にのみ渡す。
- Backend の `RESOURCE_REPOSITORY_URL` に HTTPS の GitHub リポジトリ URL を設定する（必須）。private リポジトリでは `RESOURCE_GITHUB_TOKEN_FILE` にトークンファイルのパスを指定する（任意）。GHCR の認証情報とは共有しない。
- 外部取得は全体60秒、各HTTPリクエスト30秒、各レスポンス64 MiBまで。上限超過は `resource_source_unavailable` とする。

認証方式の根拠: [GitHub Contents API](https://docs.github.com/en/rest/repos/contents)、[GHCR authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。

## 取り込み処理

1. 認証・認可と課題 ID・Version の入力を検証する。Version は `vMAJOR.MINOR.PATCH` の正式版のみ。大小は数値の SemVer 順で比較し、文字列順では比較しない。
2. DB の現在の Version と同じなら外部アクセスせず変更なしで成功する。古ければ、取り込み済みであっても拒否する。Version の内容は不変として扱う。
3. 固定した Git コミットの index から指定課題 ID・Version を探し、対象 JSON を取得する。
4. `github.com/dsa-uts/dsa-resource-spec` を **v1.1.0 に固定**し、`resource.DecodeResource` で読み込み・検証する。Backend は指定 ID・Version との一致も確認する。
5. `Resource.Hash()` と index の `resource-hash` を照合する。受信バイト列の SHA-256 ではなく、復元した Resource の JSON エンコードに対するハッシュを使う。
6. 検証済み Resource の JSON と Version を DB に保存し、Project の最新版とタイトルを同じトランザクションで更新する。初回なら Project も作成する。

外部取得・検証は DB 更新前に完了させる。同時取り込みでも課題 ID・Version の登録が重複したり最新版が逆行したりしないよう、書き込み時にも現在の Version を確認する。同じ Version が先に登録されていれば変更なし、より新しい Version が先に登録されていれば古い Version として拒否する。

失敗時には部分的な Project / Version 登録や最新版の変更を残さない。成功レスポンスはコミット後に返し、応答喪失後の同じ Version の再送も変更なしで成功する。

## 保存と利用

- 課題 ID ごとに Project を対応付け、Version ごとに immutable な課題 JSON を DB に保存する。SQL のテーブル・カラム定義は実装時の migration が所有する。
- JSON は説明文・Preset File・標準入力・期待出力を含む自己完結したデータ。教材用の別ファイル保存先は設けず、取り込み後の表示・採点には保存済みデータを使う。
- private Job や期待出力を含むため、保存 JSON をそのまま一般ユーザーに配信しない。API は既存の Job / Artifact の可視性規則に従って必要な表示内容を返す。
- 初回の Project はタイトルを Resource から設定し、公開日時・締切は未設定、表示順は末尾にする。更新時はタイトルだけを追従させ、公開日時・締切・表示順を維持する。
- イメージは JSON の digest 参照を保持する。取り込み時にはレジストリへアクセスせず、イメージ本体の保存・存在確認・認証確認をしない。採点時に取得し、失敗時は既存のインフラエラー規則に従う。
- 新Versionでも実効内容の差分判定は行わず登録する。同一性は課題 ID と Version で扱う。
- 取り込みで Request を作成しない。validation / evaluation とも手動再実行のみで、新規 Request は作成時点の最新版に固定する。
- index から消えた Project も維持する。自動アーカイブや物理削除は行わず、公開停止は運用者が公開日時を未設定に戻して行う。
- 専用の監査 DB・実行者記録は設けない。ロギング・アラート検知の要否や詳細は今後の運用で検討する。

## E2E

public の `dsa-uts/dsa-resource-spec` と、その課題 JSON が参照する public GHCR イメージを使う。課題 ID・Version はテストコードで固定し（初期対象: `ex1` / `v1.0.0`）、リポジトリ上の最新版へ自動追従しない。ライブラリの固定 Version `v1.1.0` と課題 Version は別物。

実装時には実際の取り込み・保存データによる実行に加え、同Version再送の no-op、古いVersionの拒否、検証失敗時の未更新を確認する。private 認証は Dev / Prod の設定として扱う。
