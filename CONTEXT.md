# DSA Project

本 context は、プロジェクト仕様書で使うオンラインジャッジのドメイン言語を定義する。

## Language

**Project**:
1 つのプログラミング演習または judging setup のための Workflow の集合。採点ロジック(Workflow)と表示名(課題タイトル、resource.yaml の `resource.name`)は Resource Version が持ち、表示名は Version 登録のたびに最新値へ更新される。Project 自体はコンソール管理の運用メタデータ(公開日時、締切日時、並び順)を持つ。
_Avoid_: Assignment, repository

**公開日時 (Publish Time)**:
Project のコンソール管理属性。これより前の Project は Student に不可視(一覧にも出ない)。未設定は未公開と同義。Manager/Admin には常に可視。
_Avoid_: リリース日, 開始日

**締切日時 (Deadline)**:
Project のコンソール管理属性。enforcement はしない。evaluation Submission の original_submitted_at と比較して「遅延提出」を表示するためだけに使う。締切後も Submission と Validation Request は可能で、Project も非公開にならない。
_Avoid_: 提出期限, cutoff

**Resource**:
Admin が管理する trusted な Project 定義素材。Resource YAML、Preset file、課題説明文、sandbox image build 入力を含む。
_Avoid_: Test bundle, judge files

**Archived Project**:
root manifest から entry が外された Project(manifest 掲載 = active の定義)。新規 Submission / Request の対象にできず Student に不可視だが、Manager/Admin は過去の結果を引き続き閲覧できる。復活は manifest への再追加。Project の物理削除はドメイン操作として存在しない。
_Avoid_: Deleted project, disabled project

**Resource Version**:
source 履歴と sandbox image metadata に紐づく、Resource の immutable な version。
_Avoid_: Release, revision

**User Account**:
Request を提出・管理できる人の認証済みアカウント。
_Avoid_: Admin account, Manager account

**Role**:
User Account に割り当てる権限レベル。Admin、Manager、Student など。
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

**Queued Rerun**:
新しい Resource Version の登録を契機に、System Account 名義で自動作成される Request。対象は Project × ユーザーごとに直近の non-archived validation Submission(件数は運用設定値)と、Project × Subject User ごとに最新の non-archived evaluation Submission 1 件。
_Avoid_: Auto rejudge, batch rerun

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
Resource YAML の top-level `sandbox-images` で一度だけ定義し、Job が ID で参照する container image。Resource Version ごとに build され、digest は Resource YAML ではなく Resource Version metadata が持つ。
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
1 Request は 1 Submission × 1 Resource Version × その Version の全 Workflow を対象とする。Submission と Resource Version は同一 Project に属していなければならない。(ADR 0003)

**Archive-not-Edit**:
訂正は Submission の編集ではなく、archive して新しい Submission を作ることで行う。(ADR 0004)

**Worst-wins**:
Status の集約は最悪値優先。`IE > OLE > MLE > TLE > RE > WA > AC`。

**Digest Pinning**:
Resource Version は Sandbox Image を tag ではなく `repo@sha256:...` digest で固定参照する。

**Private-by-Default**:
Job と Artifact の `visibility` は省略時 `private`。クライアントに見せるものは常に明示的に `public` 宣言する。

**Registration-only API**:
GitHub Actions が呼ぶ Admin API の権限は Resource Version の作成のみに限定する。

**Fix-Forward Resource**:
Resource Version は archive も撤回もできない。訂正は Resource repo への push による新 Version 登録のみで行い、latest は常に最新の登録済み Version。Resource の編集入口を git に一本化し、コンソール側に第二の編集経路を作らない。(ADR 0006)

**Git-for-Logic, Console-for-Operations**:
採点ロジック(Workflow、Job、Preset、Sandbox Image)と課題タイトルは git 管理の Resource が所有する。運用メタデータ(公開日時、締切日時、並び順)はコンソール管理の Project 属性が所有し、変更に Resource Version 登録を要しない。(ADR 0006)

**Converge-to-Latest**:
既定の結果表示は latest Resource Version 上の Request に固定する。latest 上の Request を持たない Submission は「未実行」として扱い、Queued Rerun が表示を latest へ収束させる。古い Version 上の結果は明示的な Version 選択(Manager/Admin のみ)でしか見えない。(ADR 0007)
