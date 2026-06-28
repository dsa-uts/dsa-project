# Resource YAML 仕様

## 目的

Resource YAML は Project に含まれる Workflow、Job、Step、Artifact handoff、sandbox image build 入力、課題説明文、Preset file を定義する。

Resource YAML は source declaration であり、build 後に決まる image digest は持たない。image digest は Resource Version metadata として Backend/Judge が保持する。

## ファイル構成例

```text
resource.yaml
descriptions/judge.md
sandbox/Dockerfile
presets/Makefile
presets/check.sh
input/sample.txt
expected/test.stdout
```

## YAML 例

```yaml
resource:
  id: dsa-basic

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
        sandbox:
          working-directory: /workspace
          build:
            context: .
            dockerfile: sandbox/Dockerfile
            image: ghcr.io/example/dsa-basic-sandbox
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

## 基本規則

- Resource 側 path (`description-path`, `presets.files[].source`, `stdin.path`, `expected.*.path`, `sandbox.build.context`, `sandbox.build.dockerfile`) は Resource root からの相対 path。
- Preset path (`presets.files[].path`) は fixed read-only `/preset` mount からの相対 path。
- workspace path (`artifacts.*[].path`) は sandbox workspace からの相対 path。
- Resource YAML 上の相対 path は clean な POSIX path として扱う。空 path、`.`、絶対 path、`..` component、NUL byte、backslash を含む path は validation error。
- path は Resource root、fixed read-only `/preset` mount、sandbox workspace のいずれか該当する root の外を指してはいけない。
- map key は機械 ID。`name` は表示名。
- CPU は当面 `1` 固定。`limits.cpu` は省略可。指定する場合は `1` のみ許可する。
- `run` は shell 文字列ではなく argv 配列で指定する。空配列は禁止。
- `run[0]` は executable。Judge は sandbox の `PATH` で解決する。絶対 path / 相対 path も許可する。
- shell expansion、pipe、redirect、glob は解釈しない。必要な場合は script file を Preset として置き、その script 実行用の executable を明示する。
- `expected.*.path` の file は Judge が Resource root から読み込む。sandbox には配置しない。
- `schema-version` は持たない。

## Submission path normalization

Submission archive entry path は、sandbox workspace へ配置する前に canonical POSIX relative path へ正規化する。Resource YAML の path とは異なり、Submission 側は受講者環境の差を吸収するため、安全に正規化できる場合は正規化後の path を使う。

Normalization rules:

- `\` は path separator として扱い、`/` に正規化してよい。
- 正規化後の path が空 path、`.`、絶対 path、`..` component、NUL byte を含む場合は validation error。
- Windows drive path (`C:\...`) と UNC path (`\\server\share\...`) は validation error。
- 正規化後に同じ path へ衝突する複数 entry がある場合は validation error。
- symlink、hardlink、device、FIFO、socket は validation error。
- archive extraction は host filesystem path に対して直接行わない。正規化と validation を in-memory filesystem または sandbox 用一時領域で完了してから workspace copy を作成する。

## Top-level

| field | required | description |
| --- | --- | --- |
| `resource.id` | yes | Resource の安定 ID。 |
| `workflows` | yes | Workflow ID を key にした map。 |

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

Workspace / Preset 適用順:

1. Submission file を workspace に配置する。
2. Artifact input を workspace に配置する。
3. Preset file を `/preset` に read-only で配置する。

同一 Workflow の `presets.files` 内で `path` が重複する場合は validation error。

Preset file は sandbox 内から読み込み可能だが、sandbox user から変更・削除・置換できない。Preset directory は platform 固定の `/preset` であり、Resource YAML では変更できない。Preset file は secret ではない。private test data は `stdin.path` で Judge から stream し、Preset file には置かない。Preset file を writable な sandbox workspace へ配置してはならない。file 単体の owner / permission 変更だけでは、親 directory が writable な場合に unlink / rename で置換されうるため不可。

## Artifact handoff

```yaml
jobs:
  build:
    artifacts:
      outputs:
        - name: program
          path: build/program

  hidden-test:
    visibility: private
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
| `artifacts.inputs[].path` | yes | sandbox workspace 内の配置先 regular file path。 |
| `artifacts.outputs[].name` | yes | 同一 Job 内で一意な Artifact name。 |
| `artifacts.outputs[].path` | yes | sandbox workspace 内の回収元 regular file path。 |

Artifact handoff rules:

- Job は毎回 clean な sandbox workspace から開始する。前 Job の workspace 全体は引き継がない。
- Workflow 内の Job は `depends` から作る dependency graph に従って実行する。
- Judge は ready Job を 1 つずつ、valid topological order で実行する。依存関係のない Job 間の実行順は意味を持たない。
- `depends` は同一 Workflow 内の Job ID 配列。存在しない Job ID、自分自身、cycle は validation error。
- `public` Job は `private` Job に `depends` してはいけない。`private` Job は `public` Job または `private` Job に `depends` できる。
- `artifacts.inputs[].from-job` は同一 Workflow 内の Job ID であり、現在の Job の `depends` に直接含まれていなければならない。
- `depends` していない Job、未実行 Job、自分自身の Artifact 参照は validation error。
- `public` Job は `private` Job が生成した Artifact を入力にできない。`private` Job は `public` Job が生成した Artifact を入力にできる。
- Artifact output は Job の Step 実行後、sandbox cleanup 前に Judge が回収する。
- Artifact output path が存在する場合のみ回収する。存在しない場合は CI Result に Artifact capture status として記録する。
- Artifact input が参照する Artifact が存在しない場合、その Job は sandbox 開始前に setup failure とする。
- CI Result は setup failure、timeout、Step failure、Artifact capture failure のいずれでも回収・保存する。
- Artifact の保存上限は 1 Artifact file あたり `limits.artifact-size` とする。上限を超えた Artifact file は保存せず、CI Result に Artifact capture status として記録する。
- Artifact の mode は regular executable bit のみ維持する。保存時は executable なら `0755`、それ以外は `0644` とし、owner / group / suid / sgid / sticky bit は維持しない。
- Artifact は regular file のみ指定できる。directory path は Artifact capture failure または setup failure とする。
- symlink、hardlink、device、FIFO、socket は Submission / Preset file / Artifact のいずれでも validation error。
- Artifact は sandbox 由来の untrusted data として扱う。Judge は host 上で Artifact を実行しない。

## Job

```yaml
jobs:
  <job_id>:
    name: Test submission
    visibility: public
    depends: []
    sandbox: {}
    limits: {}
    artifacts: {}
    steps: []
```

Job は独立 sandbox 実行単位。

| field | required | description |
| --- | --- | --- |
| `name` | no | 表示名。 |
| `visibility` | no | `public` または `private`。省略時 `public`。 |
| `depends` | no | 先行して完了している必要がある Job ID 配列。省略時 `[]`。 |
| `sandbox` | yes | sandbox image build 入力と実行制約。 |
| `limits` | yes | resource limit と timeout。 |
| `artifacts` | no | Job 間で明示的に受け渡す Artifact。 |
| `steps` | yes | 実行 step。順序を持つ配列。 |

`visibility: private` の Job は Manager / Admin の Request でのみ実行できる。隠しテストケースや採点用 Job に使う。一般 User の Request では `private` Job を実行しない。

`private` Job の CI Result と Artifact は Manager / Admin のみ参照できる。一般 User には stdout / stderr / status を含めて表示しない。

Job は独立 sandbox 実行単位である。同一 Job 内の Step は同じ workspace を共有するが、Job 間で workspace は共有しない。

## Sandbox

```yaml
sandbox:
  working-directory: /workspace
  build:
    context: .
    dockerfile: sandbox/Dockerfile
    image: ghcr.io/example/dsa-basic-sandbox
```

| field | required | description |
| --- | --- | --- |
| `working-directory` | no | Step 実行時の working directory。省略時 `/workspace`。 |
| `build.context` | no | Docker build context。省略時 `.`。 |
| `build.dockerfile` | yes | Dockerfile path。 |
| `build.image` | yes | push 先 image repository。digest は含めない。 |

`build.image` は authoring YAML 上の registry repository 名である。build/push 後の tag と digest は Resource Version metadata に保存する。

Dockerfile は project-approved hardened base image を `FROM` に使う。

sandbox hardening は platform 側の固定設定とする。Resource YAML では `network=deny`、`Linux capabilities=drop all`、`no_new_privileges`、fixed non-root user の既定設定を変更できない。

## Filesystem

Filesystem write isolation は platform 側の固定設定とする。Resource YAML では変更できない。

`sandbox.working-directory` は Step 実行時の working directory である。

Filesystem lifecycle:

1. Job 開始時に clean な sandbox workspace を作成する。
2. Submission file と Artifact input file を writable regular file copy として配置する。
3. Preset file を read-only `/preset` mount に配置する。
4. Step は同一 Job 内で workspace を共有する。
5. Job 終了時に CI Result を必ず回収し、存在する Artifact output file を回収する。
6. sandbox workspace を cleanup する。

Submitted file を immutable にはしない。sandbox 内の Submission は canonical Submission ではなく writable copy であり、compile / test 中に変更されても永続化されない。

`stdin.path` と `expected.*.path` が参照する file は sandbox workspace に配置しない。

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
| `cpu` | no | 現在は `1` のみ。 |
| `memory` | yes | Job 最大 RAM capacity。例: `512MiB`。 |
| `pids` | no | 最大 process 数。 |
| `timeout-seconds` | no | Job 全体 timeout。省略時は自動計算。 |
| `default-step-timeout-seconds` | no | Step timeout の既定値。 |
| `timeout-buffer-seconds` | no | Job timeout 自動計算時の buffer。 |
| `stdout-size` | no | stdout capture 上限。 |
| `stderr-size` | no | stderr capture 上限。 |
| `workspace-size` | no | sandbox workspace の容量上限。省略時 `256MiB`。 |
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

## Step stdin

```yaml
stdin:
  path: input/sample.txt
```

| field | required | description |
| --- | --- | --- |
| `value` | `path` と排他 | インライン標準入力。 |
| `path` | `value` と排他 | Resource root からの標準入力 file path。 |

`value` と `path` の同時指定は禁止。どちらもない場合は validation error。

`stdin.path` で参照される file は Judge 側で bytes として読み込み、Step process の stdin に stream する。sandbox workspace には配置しない。

## Expected stream

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

`path` で参照される期待値 file は Judge 側でのみ使用する。sandbox workspace には配置しない。

## Output checker

stdout/stderr は UTF-8 text として扱う。UTF-8 として decode できない場合、その stream の check は失敗する。

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

## Image digest

Resource YAML には image digest を書かない。

GitHub Actions:

1. `sandbox.build` から Docker image を build/push する。
2. `docker/build-push-action` の `outputs.digest` を取得する。
3. Backend の Resource Version 登録 API に渡す。

Backend/Judge:

1. Resource Version metadata に `source_ref`, `workflow_run_id`, `image`, `tag`, `digest` を保存する。
2. Request 実行時は `image@sha256:...` を pull する。

metadata 例:

```yaml
resource-id: dsa-basic
source-ref: <git-commit-sha>
workflow-run-id: <github-actions-run-id>
images:
  judge/test:
    image: ghcr.io/example/dsa-basic-sandbox
    tag: <git-commit-sha>
    digest: sha256:...
```
