# Resource 仕様

このドキュメントは Resource リポジトリの契約(layout、manifest、Resource Version 登録フロー)と Resource YAML スキーマ、および sandbox hardening の詳細を所有する。REST API の形は [api.md](./api.md)、用語と Principles は [CONTEXT.md](../../CONTEXT.md) を正とする。

## Resource リポジトリ契約

Resource は GitHub org の private repository で管理する。main ブランチ更新を Resource 更新の唯一の入口とする。

### Repository layout

```yaml
resources:
  - id: ex1
    path: ex1/resource.yaml
sandbox-images:
  default:
    build:
      context: sandbox
      dockerfile: sandbox/Dockerfile
      image: ghcr.io/dsa-uts/dsa-resource-sandbox
      platforms: [linux/amd64]
    lock: null
```

共通 Dockerfile は root `sandbox/` に配置する。Resource は専用 directory に `resource.yaml`、課題説明、Preset、期待出力を持つ。
`lock: null` は初回ビルド前であり、インポートできない。

### Resource Version 登録フロー

Actions は main 更新時に source を検証し、未ビルドまたは入力ハッシュが変わったイメージのみ build / GHCR push する。手動で全イメージを再ビルドする入口も設ける。ビルド完了後、tag・digest・input-hash・source-ref・Actions Run IDを定義元YAMLへmainに直接コミットする。生成PRやBackend API呼び出しは行わない。

公開処理は直列とし、開始時の最新mainで検証する。ビルド中にmainが進んだ場合は古い結果をコミットせず拒否し、後続Runで最新mainを処理する。push直前の競合もfast-forward制約で拒否する。生成コミット自身は不要な再ビルドを起動しない。説明文・テストのみの変更は共通build入力に含まれずdigestを維持する。

Admin は main 履歴の commit SHA を指定して全 Resource を手動インポートする。Backend はそのコミット全体を取得し、Schema・参照・依存関係・全イメージlockの入力ハッシュ一致を検証する。未ビルド、失敗したbuild、digest未反映、stale lock は全体をrejectする。取り込み完了までは現在のVersionを維持する。

Backend は各 Resource の実効内容(Resource YAMLのWorkflow/Job/表示名等（image build/lock宣言は除く）、参照する説明/Preset/stdin/expected bytes、解決済みimage名・tag・digest)を比較し、変更Resourceだけ新Versionを作る。map順・監査metadataだけの差や未参照イメージ変更は変更としない。共通digest変更は参照する全Resourceの変更となる。manifestによるactive集合更新とVersion更新を原子的に適用し、同一内容はno-op。新VersionだけQueued Rerunをenqueueする。

repository、指定commit、Admin、build source-ref、Actions Run ID、image tag/digestを監査する。Backend実装は別タスクとする。

### Digest Pinning

イメージのtag・digestはGitの定義元YAMLに保存し、Backend metadataにも取り込み時点の値を保持する。実行時は `image@sha256:...` をpullする。lockは次の全項目を持つ。

```yaml
lock:
  tag: <build-commit>-<actions-run-id>-<attempt>
  digest: sha256:<64-hex>
  input-hash: sha256:<64-hex>
  source-ref: <build-commit-40-hex>
  actions-run-id: "123456789"
```

input-hash は build宣言とcontext全entryの内容・path・実行bit・空directory、Dockerfileに対応する。mtimeは含めない。ハッシュの参照実装とJSON Schemaは `dsa-resource/scripts/resources.py` と `dsa-resource/schemas/`、byte-level契約は同repoの `docs/resource-contract.md` を正とする。Admin管理GitとActionsを信頼境界とし、入力ハッシュを暗号署名とは扱わない。

## Resource YAML

Resource YAML は Project に含まれる Sandbox Image、Workflow、Job、Step、Artifact handoff、課題説明文、Preset file を定義する。

### YAML 例

```yaml
resource:
  id: dsa-basic
  name: DSA Basic

sandbox-images:
  default:
    build:
      context: sandbox
      dockerfile: sandbox/Dockerfile
      image: ghcr.io/example/dsa-basic-sandbox
      platforms: [linux/amd64]
    lock: null

workflows:
  judge:
    name: Judge
    description-path: descriptions/judge.md

    presets:
      files:
        - source: presets/Makefile
          path: Makefile
        - source: presets/check.sh
          path: scripts/check.sh

    jobs:
      test:
        name: Test submission
        visibility: public
        depends: []
        sandbox-image: default
        working-directory: /workspace
        limits:
          cpu: 1
          memory: 512MiB
          pids: 128
          default-step-timeout-seconds: 10
          timeout-buffer-seconds: 5
          stdout-size: 1MiB
          stderr-size: 1MiB
          workspace-size: 256MiB
          artifact-size: 1MiB
        artifacts:
          outputs:
            - name: program
              path: build/program
        steps:
          - name: Compile
            run: ["make", "-f", "/preset/Makefile", "build"]
            timeout-seconds: 30
            expected:
              exit-code: 0
              stderr:
                match: exact
                value: ""

          - name: Test
            run: ["/preset/scripts/check.sh"]
            stdin:
              path: input/sample.txt
            expected:
              exit-code: 0
              stdout:
                match: exact
                path: expected/test.stdout
              stderr:
                match: exact
                value: ""
```

### 基本規則

- Resource 固有の path(`description-path`, `presets.files[].source`, `stdin.path`, `expected.*.path`, `sandbox-images.<id>.build.context`, `sandbox-images.<id>.build.dockerfile`)は Resource root からの相対 path。
- Preset path(`presets.files[].path`)は fixed read-only `/preset` mount からの相対 path。
- workspace path(`artifacts.*[].path`)は Sandbox Workspace からの相対 path。
- 相対 path は clean POSIX形式。空 path、`.`、絶対 path、`..` component、NUL、backslash、colon、空componentはvalidation error。`build.context` に限り `.` は字句上許可するが、contextは `.git` やmanifestを含まない専用directoryとし、lockが自身の入力になる循環を禁止する。
- root manifest の共通build pathはrepository root基準。Resource固有build pathはResource root基準。共通imageはIDで参照し、Resource pathの越境は許さない。
- path は Resource root、fixed read-only `/preset` mount、Sandbox Workspace のいずれか該当する root の外を指してはいけない。
- map key は機械 ID。`name` は表示名。
- `run` は shell 文字列ではなく argv 配列で指定する。空配列は禁止。
- `run[0]` は executable。Judge は sandbox の `PATH` で解決する。絶対 path / 相対 path も許可する。
- shell expansion、pipe、redirect、glob は解釈しない。必要な場合は script file を Preset として置き、その script 実行用の executable を明示する。
- `expected.*.path` の file は Judge が Resource root から読み込む。sandbox には配置しない。
- `schema-version` は持たない。

## Submission path normalization

Submission archive entry path は、Sandbox Workspace へ配置する前に canonical POSIX relative path へ正規化する。Resource YAML の path とは異なり、Submission 側は受講者環境の差を吸収するため、安全に正規化できる場合は正規化後の path を使う。この正規化は Normalized Submission Identity の前提であり、content hash は正規化後の file tree に対して計算する。

Normalization rules:

- `\` は path separator として扱い、`/` に正規化してよい。
- 正規化後の path が空 path、`.`、絶対 path、`..` component、NUL byte を含む場合は validation error。
- Windows drive path(`C:\...`)と UNC path(`\\server\share\...`)は validation error。
- 正規化後に同じ path へ衝突する複数 entry がある場合は validation error。
- symlink、hardlink、device、FIFO、socket は validation error。
- archive extraction は host filesystem path に対して直接行わない。正規化と validation を in-memory filesystem または sandbox 用一時領域で完了してから workspace copy を作成する。

## Top-level

| field | required | description |
| --- | --- | --- |
| `resource.id` | yes | Resource の安定 ID。root manifest の `id` と一致する。 |
| `resource.name` | yes | Project の表示名。 |
| `sandbox-images` | no | Resource 固有 Sandbox Image ID の map。共通定義とのID衝突は禁止。 |
| `workflows` | yes | Workflow ID を key にした map。 |

## Sandbox Image

```yaml
sandbox-images:
  default:
    build:
      context: sandbox
      dockerfile: sandbox/Dockerfile
      image: ghcr.io/example/dsa-basic-sandbox
      platforms: [linux/amd64]
    lock: null
```

| field | required | description |
| --- | --- | --- |
| `build.context` | yes | Docker build context。定義を所有するroot基準。 |
| `build.dockerfile` | yes | Dockerfile path。contextではなく定義のroot基準。 |
| `build.image` | yes | GHCRのpush先repository。tag/digestは含めない。 |
| `build.platforms` | yes | 空でない `linux/amd64` / `linux/arm64` の配列。 |
| `lock` | yes | 未ビルドはnull。確定後は上記の全lock項目。 |

- root manifest の共通定義とResourceの固有定義を合成してJobのIDを解決する。ID衝突はrejectし、shadowingはしない。異なるResourceの固有IDは独立。
- Dockerfileは通常のDebian slim系など承認済みbaseをtag＋digestで固定する。現在のbuild契約は単一FROM、追加fileはcontext内COPY、ADD・外部frontend・追加build args/secret/contextは未対応。
- GCC・makeを含めnon-root実行する。FROM固定でもAPT配布物まで完全再現する保証はしない。完成imageのdigestで実行環境を固定する。
- Job未参照entryも定義可。インポート時は全共通・固有entryに現在入力と一致するlockが必要。

### Sandbox hardening

sandbox は gVisor(runsc) RuntimeClass を指定した k8s Pod として専用 Namespace で実行する。以下は platform 側の固定設定であり、Resource YAML では変更できない:

- network egress の既定 deny
- Linux capabilities は全て drop
- `no_new_privileges`
- fixed non-root user で Step を実行
- read-only root filesystem。書き込み可能領域は platform が許可した Sandbox Workspace 等に限定
- 監査ログを必須とする

CPU / memory / pids / 実行時間 / stdout・stderr size の上限は Job の `limits` で宣言する。

## Workflow

```yaml
workflows:
  <workflow_id>:
    name: Judge
    description-path: descriptions/judge.md
    presets:
      files: []
    jobs: {}
```

| field | required | description |
| --- | --- | --- |
| `name` | no | 表示名。 |
| `description-path` | no | 課題説明 Markdown などの path。 |
| `presets.files` | no | Workflow 実行前に read-only `/preset` mount へ配置する Resource file。 |
| `jobs` | yes | Job ID を key にした map。 |

## Preset file

```yaml
presets:
  files:
    - source: presets/Makefile
      path: Makefile
```

| field | required | description |
| --- | --- | --- |
| `source` | yes | Resource root からの相対 path。 |
| `path` | yes | fixed read-only `/preset` mount 内の配置先 path。 |

同一 Workflow の `presets.files` 内で `path` が重複する場合は validation error。

Preset file は sandbox 内から読み込み可能だが、sandbox user から変更・削除・置換できない。Preset directory は platform 固定の `/preset` であり、Resource YAML では変更できない。writable な Sandbox Workspace へ配置してはならない(親 directory が writable だと unlink / rename で置換されうるため、file 単体の permission 変更では不十分)。

Preset file は secret ではない。private test data は `stdin.path` で Judge から stream し、Preset file には置かない。

## Job

```yaml
jobs:
  <job_id>:
    name: Test submission
    visibility: public
    depends: []
    sandbox-image: default
    working-directory: /workspace
    limits: {}
    artifacts: {}
    steps: []
```

Job は独立 sandbox 実行単位。同一 Job 内の Step は同じ workspace を共有するが、Job 間で workspace は共有しない(Isolated Job Workspace)。

| field | required | description |
| --- | --- | --- |
| `name` | no | 表示名。 |
| `visibility` | no | `public` または `private`。省略時 `private`(Private-by-Default)。 |
| `depends` | no | 先行して完了している必要がある Job ID 配列。省略時 `[]`。 |
| `sandbox-image` | yes | 共通＋当該Resource固有の `sandbox-images` の ID。未定義 ID は validation error。 |
| `working-directory` | no | Step 実行時の working directory。省略時 `/workspace`。 |
| `limits` | yes | resource limit と timeout。 |
| `artifacts` | no | Job 間で明示的に受け渡す Artifact。 |
| `steps` | yes | 実行 Step。順序を持つ配列。 |

`visibility: private` の Job は Manager / Admin の Request でのみ実行できる。隠しテストケースや採点用 Job に使う。Validation Request は `public` Job のみ実行する。

`private` Job の CI Result と Artifact は Manager / Admin のみ参照できる。一般 User には stdout / stderr / status を含めて表示しない。

## Artifact handoff

Isolated Job Workspace と Explicit Artifact Handoff に従う。Job は毎回 clean な Sandbox Workspace から開始し、Job 間の受け渡しは宣言された Artifact file のみ。

```yaml
jobs:
  build:
    visibility: public
    artifacts:
      outputs:
        - name: program
          path: build/program
        - name: diagram
          path: out/diagram.png
          visibility: public
          content-type: image/png

  hidden-test:
    depends: [build]
    artifacts:
      inputs:
        - from-job: build
          name: program
          path: build/program
```

| field | required | description |
| --- | --- | --- |
| `artifacts.inputs[].from-job` | yes | Artifact producer Job ID。同一 Workflow 内のみ指定可。 |
| `artifacts.inputs[].name` | yes | producer Job の output Artifact name。 |
| `artifacts.inputs[].path` | yes | Sandbox Workspace 内の配置先 regular file path。 |
| `artifacts.outputs[].name` | yes | 同一 Job 内で一意な Artifact name。 |
| `artifacts.outputs[].path` | yes | Sandbox Workspace 内の回収元 regular file path。 |
| `artifacts.outputs[].visibility` | no | `public` または `private`。省略時 `private`(Private-by-Default)。 |
| `artifacts.outputs[].content-type` | public のとき yes | 配信時の `Content-Type`。`private` では指定禁止。 |

### Public Artifact

`visibility: public` の Artifact はクライアントに配信されうる(配信条件と API は [api.md](./api.md))。`content-type` は次の許可リストのみ:

- `image/png`
- `image/jpeg`
- `text/plain`
- `application/json`

SVG は script を実行できるため(stored XSS)public Artifact として許可しない。

### Dependency rules

- Workflow 内の Job は `depends` から作る dependency graph に従って実行する。Judge は ready Job を 1 つずつ、valid topological order で実行する。依存関係のない Job 間の実行順は意味を持たない。
- `depends` は同一 Workflow 内の Job ID 配列。存在しない Job ID、自分自身、cycle は validation error。
- `public` Job は `private` Job に `depends` してはいけない。`private` Job は `public` / `private` どちらの Job にも `depends` できる。
- `artifacts.inputs[].from-job` は現在の Job の `depends` に直接含まれていなければならない。`depends` していない Job、未実行 Job、自分自身の Artifact 参照は validation error。
- `public` Job は `private` Job が生成した Artifact を入力にできない。`private` Job は `public` Job が生成した Artifact を入力にできる。

### Capture rules

- Artifact output は Job の Step 実行後、sandbox cleanup 前に Judge が回収する。
- Artifact output path が存在する場合のみ回収する。存在しない場合は CI Result に Artifact capture status として記録する。
- Artifact input が参照する Artifact が存在しない場合、その Job は sandbox 開始前に setup failure とする。
- CI Result は setup failure、timeout、Step failure、Artifact capture failure のいずれでも回収・保存する。
- 保存上限は 1 Artifact file あたり `limits.artifact-size`。超過した Artifact file は保存せず、CI Result に Artifact capture status として記録する。
- Artifact の mode は regular executable bit のみ維持する。保存時は executable なら `0755`、それ以外は `0644` とし、owner / group / suid / sgid / sticky bit は維持しない。
- Artifact は regular file のみ。directory path は Artifact capture failure または setup failure とする。
- symlink、hardlink、device、FIFO、socket は Submission / Preset file / Artifact のいずれでも validation error。
- Artifact は sandbox 由来の untrusted data として扱う。Judge は host 上で Artifact を実行しない。

## Filesystem

Filesystem write isolation は platform 側の固定設定とする。Resource YAML では変更できない。

Filesystem lifecycle:

1. Job 開始時に clean な Sandbox Workspace を作成する(Isolated Job Workspace)。
2. Submission file と Artifact input file を writable regular file copy として配置する。
3. Preset file を read-only `/preset` mount に配置する。
4. Step は同一 Job 内で workspace を共有する。Step 間では cleanup しない。
5. Job 終了時に CI Result を必ず回収し、存在する Artifact output file を回収する。
6. Sandbox Workspace を cleanup する。

sandbox 内の Submission は canonical Submission ではなく writable copy であり、compile / test 中に変更されても永続化されない。

`stdin.path` と `expected.*.path` が参照する file は Sandbox Workspace に配置しない。

## Limits

```yaml
limits:
  cpu: 1
  memory: 512MiB
  pids: 128
  timeout-seconds: 300
  default-step-timeout-seconds: 10
  timeout-buffer-seconds: 5
  stdout-size: 1MiB
  stderr-size: 1MiB
  workspace-size: 256MiB
  artifact-size: 1MiB
```

| field | required | description |
| --- | --- | --- |
| `cpu` | no | 当面 `1` 固定。指定する場合も `1` のみ許可。 |
| `memory` | yes | Job 最大 RAM capacity。例: `512MiB`。 |
| `pids` | no | 最大 process 数。 |
| `timeout-seconds` | no | Job 全体 timeout。省略時は自動計算。 |
| `default-step-timeout-seconds` | no | Step timeout の既定値。 |
| `timeout-buffer-seconds` | no | Job timeout 自動計算時の buffer。 |
| `stdout-size` | no | stdout capture 上限。 |
| `stderr-size` | no | stderr capture 上限。 |
| `workspace-size` | no | Sandbox Workspace の容量上限。省略時 `256MiB`。 |
| `artifact-size` | no | 1 Artifact file あたりの保存上限。省略時 `1MiB`。 |

### Timeout 計算

Step の実効 timeout:

```text
step_timeout =
  step.timeout-seconds
  ?? job.limits.default-step-timeout-seconds
  ?? validation error
```

Job の実効 timeout:

```text
job_timeout =
  job.limits.timeout-seconds
  ?? sum(step_timeout) + buffer
```

Buffer:

```text
buffer =
  job.limits.timeout-buffer-seconds
  ?? max(5, ceil(sum(step_timeout) * 0.1))
```

明示された `job.limits.timeout-seconds` が `sum(step_timeout)` より小さい場合は validation error。

## Step

```yaml
steps:
  - name: Test
    run: ["make", "test"]
    timeout-seconds: 60
    expected:
      exit-code: 0
      stdout:
        match: exact
        path: expected/test.stdout
      stderr:
        match: exact
        value: ""
```

| field | required | description |
| --- | --- | --- |
| `name` | no | 表示名。 |
| `run` | yes | argv 配列。先頭要素が executable、残りが args。空配列は禁止。 |
| `stdin` | no | Step の標準入力。 |
| `timeout-seconds` | no | Step wall time timeout。 |
| `expected` | no | 期待結果。 |

`expected.exit-code` は省略時 `0`。`expected.stdout` と `expected.stderr` は省略時、比較しない。

### Step stdin

```yaml
stdin:
  path: input/sample.txt
```

| field | required | description |
| --- | --- | --- |
| `value` | `path` と排他 | インライン標準入力。 |
| `path` | `value` と排他 | Resource root からの標準入力 file path。 |

`value` と `path` の同時指定は禁止。どちらもない場合は validation error。

`stdin.path` で参照される file は Judge 側で bytes として読み込み、Step process の stdin に stream する。Sandbox Workspace には配置しない。

### Expected stream

```yaml
expected:
  stdout:
    match: exact
    value: "AC\n"
  stderr:
    match: easy
    path: expected/stderr.txt
```

| field | required | description |
| --- | --- | --- |
| `match` | yes | `exact`, `easy`, `sorted` のいずれか。 |
| `value` | `path` と排他 | インライン期待値。 |
| `path` | `value` と排他 | Resource root からの期待値 file path。 |

`value` と `path` の同時指定は禁止。どちらもない場合は validation error。

`path` で参照される期待値 file は Judge 側でのみ使用する。Sandbox Workspace には配置しない。

## Output checker

stdout / stderr は UTF-8 text として扱う。UTF-8 として decode できない場合、その stream の check は失敗する。

### `exact`

完全一致。正規化しない。最後の改行も比較対象。

### `easy`

行ごとに要素列を比較する checker。

正規化:

1. 出力全体と期待値全体から、末尾にある 1 個の line ending を取り除く。対象は `\n`, `\r\n`, `\r`。
2. 行に分割する。
3. 各行の先頭・末尾の Unicode whitespace を trim する。
4. 各行を 1 文字以上の Unicode whitespace で分割し、要素列にする。

比較:

- 行数が同じであること。
- 各行の要素数が同じであること。
- 各行の要素が同じ順序で完全一致すること。

例:

```text
"  A\tB  \nC　D\n"
```

は次と同じ。

```text
"A B\nC D"
```

### `sorted`

`easy` と同じ正規化をした後、各行の要素列を辞書順で sort してから比較する。

比較:

- 行順は維持する。
- 各行内の要素順だけを無視する。
- sort は正規化後の要素文字列の昇順。

例:

```text
"B A\n3 2 1"
```

は次と同じ。

```text
"A B\n1 2 3"
```
