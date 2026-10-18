# OpenAPI のファイル分割調査

調査日: 2026-10-18。実装前の調査・提案の記録。

追記: 本案を採用し実装した。以下は調査時点の記録であり、現在の生成手順は [coding standards](../agents/coding-standards.md) を参照する。分割後の bundle は元の契約と構造的に同一で、Go / TypeScript の再生成結果にも差分はなかった。

## 結論と提案

`api/openapi.yaml` を入口として残し、関連する Path Item と schema を機能ごとの YAML に移す構成を推奨する。生成前に通常の bundle で単一の仕様へまとめ、Go / TypeScript の生成器へ渡す。ファイル分割のためだけに Go package や server interface まで分割する必要はない。

これは本プロジェクト向けの提案である。OpenAPI 標準が特定のディレクトリ構造や一ファイルの大きさを要求するわけではない。標準の外部 `$ref` と、利用する生成器の制約を両方満たすことが重要。

## このリポジトリの現状と影響範囲

- [api/openapi.yaml](../../api/openapi.yaml) は 1,024 行、14 Path Item、16 operation、37 schema。エンドポイント定義が約半分、components が約半分を占める。
- [backend/go.mod](../../backend/go.mod) は oapi-codegen v2.8.0、kin-openapi v0.149.0。[frontend/package.json](../../frontend/package.json) は openapi-typescript ^7.13.0 を指定している。
- [scripts/codegen.nu](../../scripts/codegen.nu) は `go generate ./...` と `npm run generate` を順に実行し、check では Go / TypeScript の生成物 2 ファイルを `git diff` で検査する。現状は両方とも元の `api/openapi.yaml` を直接読む。
- [Go の生成設定](../../backend/internal/api/generated/oapi-codegen.yaml) は models、echo-server、strict-server、embedded-spec を一つの `gen.go` に生成する。
- [API 登録処理](../../backend/internal/api/register.go) は起動時に `generated.GetSpec()` を読み込み、認証宣言を検査して request validation に使う。[生成済み GetSpec](../../backend/internal/api/generated/gen.go) は外部参照を生成済みの `PathToRawSpec` から解決するため、単に YAML を移動して生成成功だけ確認するのでは不十分。

このため、生成前の bundle を推奨する。たとえば `api/openapi.yaml → tmp/openapi.bundle.yaml → Go / TypeScript` とし、中間成果物は既存の `tmp/` ignore を利用できる。これは配置案であり、まだ追加していない。

実装時の変更対象は分割 YAML、`scripts/codegen.nu`、[generate.go](../../backend/internal/api/generated/generate.go)、`frontend/package.json` と lockfile（bundler を直接依存として追加する場合）、生成物 2 ファイル、生成手順の説明。`Taskfile.yml` と CI は既存 task が正しく bundle を実行すれば入口を維持できる。現在 lockfile にある `@redocly/openapi-core` は推移的依存であり、Redocly CLI を導入済みという意味ではない。

bundle は生成のたびに作り直す。`task codegen:generate` だけを正式な入口にするなら、直接 `go generate` / `npm run generate` を案内する説明も更新する。直接コマンドを引き続きサポートするなら、その経路でも新しい bundle を作る必要がある。古い bundle を読み続ける構成は避ける。

[coding standards](../agents/coding-standards.md)、[仕様の索引](../spec/README.md) の「単一ファイルが正」という説明との整合も実装時に取る。生成コードの型名を維持できれば、ハンドラやフロントエンド呼び出し元の変更は想定しない。

## 一次資料から確認できること

### OpenAPI 3.1 の参照規則

- 仕様は複数ファイルに分割でき、内部・外部の値を `$ref` で参照できる。
- 通常の相対参照は**参照を書いたファイル**が基準。Schema Object の `$id` は基準 URI を変える場合がある。
- `paths` 全体や `components.schemas` の辞書全体を `$ref` に置き換える構文はない。個別の Path Item、Schema、Response など、参照を許す位置で分割する。
- Path Item には `$ref` があるが Operation Object にはない。`get` 単独への `$ref` ではなく、その URL の Path Item を参照する。
- Path Item の参照先と参照元に同じフィールドを併記した場合の挙動は未定義。参照を独自のマージ機構として使わない。

出典: [OpenAPI 3.1.0: Document Structure / Relative References / Paths / Path Item / Operation / Reference Object](https://spec.openapis.org/oas/v3.1.0.html)。

### oapi-codegen

`v2.8.0` の公式 README は OpenAPI 3.1 対応を明記している。外部 schema を直接扱う方式では `import-mapping` を使う。同一 Go package へ生成する self mapping (`"-"`) も v2.4.0 以降で利用できるが、仕様ファイルごとの生成呼び出しと設定が必要になる。公式 README は別案として、複数の仕様を一ファイルに bundle する方法も挙げている。

出典: [oapi-codegen v2.8.0 README: Import Mapping](https://github.com/oapi-codegen/oapi-codegen/blob/v2.8.0/README.md#splitting-large-openapi-specs-across-multiple-packages-aka-import-mapping-or-external-references)。

### openapi-typescript

7.x の CLI は Redocly を使って仕様を検証する。実際に `7.13.0` の `validateAndBundle` は外部参照 resolver を使用して lint した後、`bundle({ dereference: false, ... })` を呼ぶ。このため TypeScript 側は複数ファイルを入口から読み込める設計になっている。

出典: [openapi-typescript CLI](https://openapi-ts.dev/cli)、[7.13.0 の実装](https://github.com/openapi-ts/openapi-typescript/blob/openapi-typescript%407.13.0/packages/openapi-typescript/src/lib/redoc.ts)。

### bundle と dereference の違い

Redocly の通常の `bundle` は入口から `$ref` をたどって一ファイルにまとめる。`--dereferenced` は参照を展開する別のオプションで、循環参照がある場合は JSON 出力できない。`join` は複数 API の結合用であり、同一 API のファイル分割を戻す用途は `bundle`。

schema の名前が衝突すると bundler が改名する場合がある。既存の component 名を入口に明示し、生成コードの名前が変わっていないことを確認するのが安全。導入する CLI の対応状況に応じて、名前衝突をエラーにする設定も検討できる。

出典: [Redocly CLI: bundle](https://redocly.com/docs/cli/commands/bundle)。

## 分割粒度の選択肢

| 構成 | 利点 | 負担・適用範囲 |
| --- | --- | --- |
| `paths.yaml` と `schemas.yaml` の大分類 | 最小の移動で導入できる | 各ファイルが再び大きくなりやすい |
| 機能ごとのファイル | API と関連 schema を近くで編集できる | 共有型と機能間の参照方針が必要。本件の推奨 |
| Path Item ごと・component ごとのファイル | 個々の定義を小さく保てる | 多数の小ファイルと参照移動が生じる |
| 複数の独立 OpenAPI + Go import mapping | package を独立させる場合に適する | 設定・生成・interface の管理が増える |

Redocly の `split` コマンドは Path Item ごとの `paths/` と、component 種別ごとの `components/` を生成する。標準的な機械分割の参考にはなるが、その細かさをそのまま採用する必要はない。

出典: [Redocly CLI: split](https://redocly.com/docs/cli/commands/split)。表の選択判断は本調査の提案。

## 具体的な配置案

```text
api/
  openapi.yaml               # メタデータ・全 URL の索引・公開 component 名
  sessions.yaml              # session / me と関連 schema
  users.yaml                 # User Account 管理
  projects.yaml              # Project 一覧・詳細・管理
  resource-imports.yaml      # Resource Import
  validation.yaml            # Validation Request と結果・file・Artifact
  common.yaml                # 共通 response / parameter / schema
```

各機能ファイルには `paths` と `schemas` を置く。独立した API 定義ではなく、参照される断片として扱う。必要な場合のみ `responses` などを加える。`securitySchemes.sessionAuth` は入口に残してよい。

入口の例（既存の契約名を維持する）:

```yaml
paths:
  /api/session:
    $ref: './sessions.yaml#/paths/~1api~1session'
components:
  schemas:
    CreateSessionRequest:
      $ref: './sessions.yaml#/schemas/CreateSessionRequest'
```

`sessions.yaml` 側の例（説明用の抜粋）:

```yaml
paths:
  /api/session:
    post:
      operationId: createSession
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/schemas/CreateSessionRequest'
      # responses は現行定義を移す
schemas:
  CreateSessionRequest:
    # 現行 schema を移す
```

JSON Pointer のキー中の `/` は `~1`、`~` は `~0` にする。たとえば `/api/session` は `~1api~1session`。この記法を避けたければ `paths.session` のようなローカル名にできるが、入口と断片で URL を追える構成を優先する。出典: [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901#section-3)。

機能内参照は同ファイル、機能を越える参照は対象ファイル、共通定義は `common.yaml` を指す。移動後の `#/components/...` が旧入口を指し続けるわけではないため、参照元を基準に書き換える。単なる分割のために `$id` を導入する必要はない。

## 実装時の確認項目

以下は推奨する移行手順であり、この調査では実装していない。

1. パス・`operationId`・component 名・認証宣言・validation・description を変更せず移す。
2. 既存生成処理の前に、バージョンを固定した bundler の処理を置く。bundle は手編集しない中間成果物として扱う。
3. Go と TypeScript の生成入力を同じ bundle にそろえる。別々の入口でも動作するが、同一入力なら比較しやすい。
4. bundle 後の構造を元の契約と比較する。特に component 名、認証、multipart、nullable、独自拡張を確認する。
5. 再生成して既存の型名・server interface が維持されることと、embedded spec が外部ファイルなしで読み込めることを確認する。
6. 既存の codegen drift 検査でも毎回 bundle を再生成し、全参照先の変更を反映させる。`task codegen:check`、`task check` と、デプロイ環境での認証・API contract の確認を行う。単に分割ファイルを追加しただけなら、既存の生成物比較対象を増やす必要はない。
7. single source of truth の説明を「入口とその参照先」に改める。`task codegen:generate` を bundle 込みの正規入口にし、直接の `go generate ./...` / `npm run generate` も古い bundle を読まないようにする。各コマンドでも前処理を実行するか、直接実行の案内を正規入口に置き換え、必要な前提を明記する。

通常の bundle を推奨し、完全 dereference、独自 YAML マージ処理、Go package 分割は今回の目的に含めない。分割後の実際の生成互換性は、利用中の固定バージョンで検証する必要がある。

今回確認したのは公式仕様・公式ドキュメント・生成器のソースとローカルの生成経路。分割、依存追加、コード再生成、テスト実行は行っていない。
