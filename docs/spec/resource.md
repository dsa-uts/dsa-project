# Resource YAML 仕様

## 目的

Resource YAML は Project に含まれる Workflow、Job、Step、sandbox image build 入力、課題説明文、Preset file を定義する。

Resource YAML は source declaration であり、build 後に決まる image digest は持たない。image digest は Resource Version metadata として Backend/Judge が保持する。

## ファイル構成例

```text
resource.yaml
descriptions/judge.md
sandbox/Dockerfile
presets/Makefile
presets/check.sh
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
        steps:
          - name: Compile
            run: ["make", "build"]
            timeout-seconds: 30
            expected:
              exit-code: 0
              stderr:
                match: exact
                value: ""

          - name: Test
            run: ["make", "test"]
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

- すべての path は Resource root からの相対 path。
- path は Resource root または sandbox workspace の外を指してはいけない。
- map key は機械 ID。`name` は表示名。
- CPU は当面 `1` 固定。`limits.cpu` は省略可。指定する場合は `1` のみ許可する。
- `run` は shell 文字列ではなく argv 配列で指定する。空配列は禁止。
- `run[0]` は executable。Judge は sandbox の `PATH` で解決する。絶対 path / 相対 path も許可する。
- shell expansion、pipe、redirect、glob は解釈しない。必要な場合は script file を Preset として置き、その script 実行用の executable を明示する。
- Preset file と Submission file の path が衝突した場合、Preset file が常に優先される。
- `schema-version` は持たない。

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
| `presets.files` | no | Workflow 実行前に workspace へ配置する Resource file。 |
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
| `path` | yes | sandbox workspace 内の配置先 path。 |

Preset 適用順:

1. Submission file を workspace に配置する。
2. Preset file を workspace に配置する。
3. 同じ `path` がある場合は Preset file で上書きする。

同一 Workflow の `presets.files` 内で `path` が重複する場合は validation error。

## Job

```yaml
jobs:
  <job_id>:
    name: Test submission
    visibility: public
    sandbox: {}
    limits: {}
    steps: []
```

Job は独立 sandbox 実行単位。

| field | required | description |
| --- | --- | --- |
| `name` | no | 表示名。 |
| `visibility` | no | `public` または `private`。省略時 `public`。 |
| `sandbox` | yes | sandbox image build 入力と実行制約。 |
| `limits` | yes | resource limit と timeout。 |
| `steps` | yes | 実行 step。順序を持つ配列。 |

`visibility: private` の Job は Manager 以上の Request でのみ実行できる。隠しテストケースや採点用 Job に使う。一般 User の Request では `private` Job を実行しない。

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

sandbox hardening は platform 側の固定設定とする。Resource YAML では `network=deny`、`Linux capabilities=drop all`、`no_new_privileges` の既定設定を変更できない。

## Filesystem

Filesystem write isolation は platform 側の固定設定とする。Resource YAML では変更できない。

`sandbox.working-directory` は Step 実行時の working directory であり、容量上限は 256MiB 固定とする。

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
| `timeout-seconds` | no | Step wall time timeout。 |
| `expected` | no | 期待結果。 |

`expected.exit-code` は省略時 `0`。`expected.stdout` と `expected.stderr` は省略時、比較しない。

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
