# DSA Project

本 context は、プロジェクト仕様書で使うオンラインジャッジのドメイン言語を定義する。

## Language

**Project**:
1 つのプログラミング演習または judging setup のための Workflow の集合。
_Avoid_: Assignment, repository

**Resource**:
Admin が管理する trusted な Project 定義素材。Resource YAML、Preset file、課題説明文、sandbox image build 入力を含む。
_Avoid_: Test bundle, judge files

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

**Submission**:
ある Project と Subject User に対してアップロードされた、正規化済み file tree の immutable な記録。uploader、アップロード時刻、content hash を含む。誤った Submission は編集せず archive して置き換える。
_Avoid_: Upload, answer

**Archived Submission**:
訂正版 Submission に置き換えられたため、Request 作成と通常の結果表示から外された Submission。
_Avoid_: Deleted submission, mutable submission

**Request**:
user または manager が開始する、1 つの Submission と 1 つの Resource Version に対する Workflow 実行。
_Avoid_: Run request, judge request

**Validation Request**:
自分の Submission を latest Resource Version に対して実行する Request。public Job のみ実行する。
_Avoid_: Trial, self-check

**Evaluation Request**:
Manager が Subject User のために開始する Request。public と private の両方の Job を実行する。
_Avoid_: Batch request, delegated request

**Subject User**:
Evaluation Request で Submission が評価される User Account。
_Avoid_: Delegator, owner

**Request Lineage**:
訂正・retry された Request から、派生元の Request への関係。
_Avoid_: Batch, duplicate marker

**Workflow**:
Resource が定義する、依存順に並んだ Job の pipeline。
_Avoid_: CI, pipeline

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
CI Result に対する judge の判定。AC, WA, TLE, MLE, RE, OLE, IE。
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
1 Request は 1 Submission × 1 Resource Version × その Version の全 Workflow を対象とする。(ADR 0003)

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
