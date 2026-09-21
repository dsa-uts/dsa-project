# DSA Project

本 context は、プロジェクト仕様書で使うオンラインジャッジのドメイン言語を定義する。

## Language

**Project**:
1 つのプログラミング演習または judging setup のための Workflow の集合。採点ロジック(Workflow)と表示名(課題タイトル、resource.yaml の `resource.name`)は Resource Version が持ち、表示名は Version 登録のたびに最新値へ更新される。Project 自体はコンソール管理の運用メタデータ(公開日時、締切日時、並び順)を持つ。初回取り込みで作成され、リポジトリから課題が削除されても維持される。公開停止は公開日時を未設定に戻して行う。
_Avoid_: Assignment, repository

**公開日時 (Publish Time)**:
Project のコンソール管理属性。これより前の Project は Student に不可視(一覧にも出ない)。未設定は未公開と同義。Manager/Admin には常に可視。
_Avoid_: リリース日, 開始日

**締切日時 (Deadline)**:
Project のコンソール管理属性。enforcement はしない。evaluation Submission の original_submitted_at と比較して「遅延提出」を表示するためだけに使う。締切後も Submission と Validation Request は可能で、Project も非公開にならない。
_Avoid_: 提出期限, cutoff

**Resource**:
Admin が管理する trusted な Project 定義素材。Resource YAML、Preset file、課題説明文、Sandbox Image の定義と確定済み実行環境を含む。
_Avoid_: Test bundle, judge files

**Resource Version**:
Git 上の確定済み素材と Sandbox Image に紐づく、Resource の immutable な version。課題 ID と正式版 SemVer (`vMAJOR.MINOR.PATCH`) で識別し、Admin が指定して取り込む。latest は取り込み済みの最大 Version であり、リポジトリ上の未取り込み Version は含まない。
_Avoid_: Release, revision

**User Account**:
Request を提出・管理できる人の認証済みアカウント。
_Avoid_: Admin account, Manager account

**Role**:
User Account に一つ割り当てる権限レベルで、Admin > Manager > Student の順に下位 Role の権限をすべて継承する。操作に必要な最低 Role を満たしていても、所有者・公開状態による認可や自己無効化禁止などの業務制約は別に適用される。
_Avoid_: Account type, user type

**System Account**:
システムが自動作成する Request の actor として使う予約 User Account。
_Avoid_: Null user, background actor

**Disabled User Account**:
soft delete された User Account。ログイン不可だがレコードは保持され、過去の Submission / Request から引き続き参照される。User Account の物理削除はドメイン操作として存在しない。
_Avoid_: Deleted user, removed user

**Submission**:
ある Project と Subject User に対してアップロードされた、正規化済み file tree の immutable な記録。uploader、アップロード時刻、content hash、kind(validation / evaluation)を含む。kind はアップロード時に確定し変更しない。kind を変えたい場合は新しい Submission を作る。誤った Submission は編集せず archive して置き換える。
_Avoid_: Upload, answer

**Archived Submission**:
訂正版 Submission に置き換えられたため、Request 作成と通常の結果表示から外された Submission。
_Avoid_: Deleted submission, mutable submission

**Request**:
user または manager が開始する、1 つの Submission と 1 つの Resource Version に対する Workflow 実行。入力部(Submission、Resource Version、actor、作成時刻)は作成時に確定して不変。state は `pending → queued → running → completed` と遷移し、Status と CI Result は completed 到達時に一度だけ書かれて以後不変(write-once)。失敗系の別終端 state は持たない。Request 自体は archive されず、可視性は所属 Submission の archive 状態から導出する。
_Avoid_: Run request, judge request

**Validation Request**:
validation Submission に対する Request の導出語(Request 自体は kind を持たない)。public Job のみ実行する。
_Avoid_: Trial, self-check

**Evaluation Request**:
evaluation Submission に対する Request の導出語(Request 自体は kind を持たない)。public と private の両方の Job を実行する。
_Avoid_: Batch request, delegated request

**Subject User**:
Evaluation Request で Submission が評価される User Account。
_Avoid_: Delegator, owner

**Workflow**:
Resource が定義する、依存順に並んだ Job の pipeline。"workflow" という語はこのドメイン語彙専用とし、GitHub Actions の実行は Actions Run(`actions-run-id`)と呼ぶ。
_Avoid_: CI, pipeline, GitHub Actions workflow

**Job**:
fresh な workspace、resource limit、Step、optional な Artifact handoff を持つ、独立した sandbox 実行単位。
_Avoid_: Task, stage

**Private Job**:
Manager / Admin のみが実行・参照できる Job。
_Avoid_: Hidden job, secret job

**Step**:
Job 内の 1 回の argv 形式 command 実行。
_Avoid_: Command, script

**Sandbox Image**:
Resource 間で共有、または Resource 固有として定義し、Job が ID で参照する container image。ビルド済み digest を Git に記録し、Resource Version はその確定済み実行環境を保持する。
_Avoid_: Job image, build config

**Preset File**:
sandbox 内の Job から参照できる trusted な Resource file。
_Avoid_: Template file, provided file

**Preset Directory**:
Job 用の Preset File を置く、固定の read-only `/preset` mount。
_Avoid_: Preset workspace, preset path

**Artifact**:
sandbox cleanup 後の永続化と後続 Job での利用のために、Job が宣言する named regular file 出力。
_Avoid_: Workspace copy, build output

**Public Artifact**:
生成元 Job がそのクライアントに可視な場合に、クライアントへ公開されると宣言された Artifact。
_Avoid_: Download, attachment

**CI Result**:
Request から回収した Step の status / stdout / stderr、Artifact capture status、judge Status、関連する実行 metadata。
_Avoid_: Artifact, output files

**Status**:
CI Result に対する judge の判定。AC, WA, TLE, MLE, RE, OLE, IE。インフラ起因の失敗(sandbox 構築失敗、Judge クラッシュ等)も IE に畳み込み、Request の state は常に completed で終端する。
_Avoid_: Result, state

**Sandbox Workspace**:
Submission、Preset file、宣言された input Artifact file から組み立てる、Job ごとの filesystem view。
_Avoid_: Worktree, project directory

## Principles

システムを貫く規則の名前。仕様書は規則を再説明せず、この名前で参照する。

**Isolated Job Workspace**:
Job は毎回 clean な Sandbox Workspace から開始する。前 Job の workspace 全体は引き継がない。(ADR 0001)

**Explicit Artifact Handoff**:
Job 間の受け渡しは宣言された Artifact file のみ。暗黙の workspace 共有はない。(ADR 0001)

**Normalized Submission Identity**:
Submission の同一性は正規化済み file tree とその content hash で定義する。(ADR 0002)

**Single-Version Request**:
1 Request は 1 Submission × 1 Resource Version × その Version の全 Workflow を対象とする。Submission と Resource Version は同一 Project に属する。新規・手動再実行とも作成時点の latest に固定し、待機中も変更しない。利用者は Version を指定できない。(ADR 0003)

**Archive-not-Edit**:
訂正は Submission の編集ではなく、archive して新しい Submission を作ることで行う。(ADR 0004)

**Worst-wins**:
Status の集約は最悪値優先。`IE > OLE > MLE > TLE > RE > WA > AC`。

**Digest Pinning**:
Resource Version は Sandbox Image を tag ではなく `repo@sha256:...` digest で固定参照する。

**Private-by-Default**:
Job と Artifact の `visibility` は省略時 `private`。クライアントに見せるものは常に明示的に `public` 宣言する。

**Manual Resource Import**:
Admin が課題 ID と Version を指定して 1 課題を取得・検証し、最新版として採用する操作。完了までは現在の Version を維持する。同じ Version は変更なし、古い Version は拒否する。validation / evaluation とも自動再実行は行わない。

**Fix-Forward Resource**:
Resource Version は archive も撤回もできない。訂正は Resource repo への push と手動インポートによる新 Version 登録のみで行い、latest は常に最新の登録済み Version。Resource の編集入口を git に一本化し、コンソール側に第二の編集経路を作らない。(ADR 0006)

**Git-for-Logic, Console-for-Operations**:
採点ロジック(Workflow、Job、Preset、Sandbox Image)と課題タイトルは git 管理の Resource が所有する。運用メタデータ(公開日時、締切日時、並び順)はコンソール管理の Project 属性が所有し、変更に Resource Version 登録を要しない。(ADR 0006)

**Request-Based Results**:
結果一覧・詳細は Request と実行対象の Resource Version に紐づく。課題更新によって過去の結果を置換・非表示にしない。学生も自分の過去 Version の Validation Request を参照でき、本採点も過去の結果を保持する。課題詳細は latest を参照する。(ADR 0007)

**Topology-Agnostic Manifests**:
アプリケーションのmanifestはクラスタのノード構成を仮定しない。Pod同士のノード同居に依存する機構(hostPath等)は使わない。デプロイの既定がシングルノードであっても、マルチノードクラスタでそのまま動作する。(ADR 0008)
