# オンラインジャッジWebアプリ 仕様書

## 1. 概要
プログラミング演習課題のオンラインジャッジWebアプリケーション

### 1.1 プロジェクト名
`dsa-project`

### 1.2 目的
プログラミング演習課題で提出されたプログラムコードのコンパイル・実行・テストケースの確認を
自動で行い、結果をWebアプリケーション上で確認する。

### 1.3 対象ユーザー
- システム管理者 (Admin)
  * 運用管理者の作成・削除
  * 1人のみ、初期設定時に作成される
- 運用管理者 (Manager)
  * 課題の作成・削除
  * 学生ユーザーの作成・削除
  * 提出された課題の詳細なジャッジ
    * 全てのテストケースを実行し、結果を表示
- 学生 (Student)
  * 提出ファイルのバリデーション
    * コンパイルが通るか、実行ができるか検証し、結果を表示

## 2. システム要件

### 2.1 機能要件
- ユーザー認証・認可システム
- コード提出システム
  - 提出されたコードをsandbox上でコンパイル・実行し、結果を表示
  - バリデーションリクエスト
    * 提出されたコードをsandbox上で限られたタスクを実行し、自動採点ができるかチェック
  - 採点リクエスト
    * 提出されたコードをsandbox上で全てのタスクを実行し、結果を表示
    * 運用管理者、システム管理者のみ
- 結果表示システム
  - コンパイル・実行・テストケースの確認結果を表示
- 管理者機能
  - 管理者ユーザーの作成・削除
  - 課題の作成・削除
  - 学生ユーザーの作成・削除
  - 学生が提出したファイルを一つにまとめたzipファイルをアップロードし、まとめてコンパイル・実行・テストケースの確認を行う
    - (高難易度) フォーマットが微妙に異なることでチェックができない提出に対して、その場で修正して再チェックすることができる

### 2.2 非機能要件
- セキュリティ
  - ログイン認証時に、ロール毎に異なる権限を設定
  - 時間が経過すると自動でログアウト
  - パスワードはハッシュ化して保存
  - sandbox上での任意のコード実行時のセキュリティ
    - CPUコア数、メモリ使用量の制限
    - 実行時間制限
    - フォルダ・ファイルの読み込み・書き込み制限
    - ネットワークアクセス制限
  - 監視・ログ収集
    - ダッシュボードでシステム負荷を監視
    - WARN以上のログをメールで通知
    - 高負荷時にメール・Slackメッセージで通知
  - 開発
    - データベースのパスワード、シークレットトークン等はGitリポジトリにハードコーディングせず、Gitで追跡していないenvファイルで設定する。もしくはDocker Secretsを使用する。
- パフォーマンス
  - 同時アクセス対応
    - 必要に応じて、バックエンドサーバーのプロセス数を増やしてスケーリングさせる
  - sandbox環境のパフォーマンス
    - コンパイル・実行・テストケースの確認結果を高速に行える
  - データベースのパフォーマンス
    - 不必要なデータは定期的に削除する
      - ログイン履歴履歴は一週間単位で削除する
      - 学生のバリデーション結果は一週間単位で削除する
- 可用性
  - 24時間稼働
- 可搬性
  - 簡単にデプロイできる
    - ハイパラメータを設定する箇所が少ない、または一か所にまとまっている。
    - コマンド一つでデプロイできる。

## 3. システム構成

### 3.1 アーキテクチャ
- フロントエンド: React (Vite) + TypeScript + TailwindCSS
- バックエンド: Go
  - バックエンドフレームワーク: [Echo](https://github.com/labstack/echo)
  - ORM: [Bun](https://github.com/uptrace/bun)
  - Validator: [GoPlayground/validator](https://github.com/go-playground/validator)
- データベース: PostgreSQL
- ジャッジサーバー: Go
  - ORM: [Bun](https://github.com/uptrace/bun)
  - Sandbox: Docker SDK for Go

## 4. データベース設計

### 4.1 主要テーブル
強調したカラムは必須項目。また、"ディレクトリ"や"パス"は絶対パスではなく相対パスを表す。

- **UserList**: ユーザ情報管理
  - **id**: ID (整数, auto increment)
  - **userid**: ユーザーID (文字列, unique)
    - 学籍番号などの一意な識別子を使用
  - **name**: ユーザー名 (文字列)
  - **hashed_password**: パスワードのハッシュ値 (文字列)
  - **role_id**: ユーザーの権限 (**UserRole.id**)
  - **disabled_at**: ユーザーが無効化されているかどうか (datetime, 1s精度)
  - email: メールアドレス (文字列)
- **UserRole**: ユーザーの権限
  - **id**: ユーザー権限ID (整数)
  - **name**: ユーザー権限名 (文字列)
    - デフォルトで、(id, name)の組み合わせは以下の通り。
      - (1, 'admin'): 管理者
      - (2, 'manager'): 運用管理者
      - (3, 'student'): 学生
- **LoginHistory**: ログイン履歴を用いた認証、及び強制ログアウト機能のためのテーブル
  - **id**: ログイン履歴ID (auto increment)
  - **user_id**: ユーザーID (**UserList.id**)
  - **login_at**: ログイン時刻 (datetime, 1s精度)
  - **logout_at**: ログアウト時刻 (datetime, 1s精度)
    - JWTの有効期限と同じ時刻を設定する
    - ユーザーが能動的にログアウトした場合、ログアウト時刻を現在時刻に更新する
- **Lecture**: 授業情報管理
  - **id**: 授業 (整数)
  - **title**: 授業タイトル (文字列)
  - **start_date**: 公開開始日時 (datetime, 1s精度)
  - **deadline**: 課題提出締め切り日時 (datetime, 1s精度)
- **Problem**: 課題情報管理
  - **lecture_id**: 授業ID (整数)
  - **problem_id**: 課題ID (整数)
    - 小課題の番号を表す、e.g., "課題3-1"の"1", "課題3-2"の"2"
    - 授業IDと課題IDの組み合わせで一意
  - **registered_at**: 登録日時 (datetime, 1s精度)
  - **title**: 課題タイトル (文字列)
  - **resource_location_id**: 課題リソースファイルへのパス (FileLocation.id)
  - **detail**: 課題の詳細 (JSON)
- **ValidationRequest**: 提出されたコードのバリデーションリクエスト
  - **id**: リクエストID (auto increment)
  - **ts**: リクエスト時刻 (datetime, 1s精度)
  - **usercode**: リクエストしたユーザーのコードID (**UserList.id**)
    - ユーザのroleがmanager, adminの場合、全てのタスクが実行される (デバッグ用)。
    - ユーザがstudentの場合、バリデーション用のタスクのみが実行される。
  - **lecture_id**: 授業ID (**Lecture.id**)
  - **problem_id**: 課題ID (**Problem.problem_id**)
  - **upload_dir_id**: 提出ファイルが格納されたディレクトリのID (**FileLocation.id**)
  - **result**: バリデーション結果 (**ResultValues.value**)
    - 種類: **ResultValues.name**を参照
    - デフォルトは10 (WJ)
    - 各タスクの実行結果の内、最大値がストアされる
  - **log**: バリデーションログ (JSON)
    - 各タスクの実行結果が記録される
      - 実行結果 (AC～IE)、実行時間、消費メモリ、実行コマンド、標準入力、標準出力、標準エラー出力
    - その他、最大実行時間、最大消費メモリ等のログも記録される。
- **GradingRequest**: 採点リクエスト
  - **lecture_id**: 授業ID (**Lecture.id**)
  - **problem_id**: 課題ID (**Problem.problem_id**)
  - **usercode**: 採点対象のユーザーのコードID (**UserList.id**)
  - **submission_ts**: 提出時刻 (datetime, 1s精度)
    - 提出時刻は、実際に課題がManaba等の媒体で提出された際の時刻
    - 採点リクエスト時に提出時刻が指定される
    - (**lecture_id**, **problem_id**,  **usercode**, **submission_ts**) の組み合わせで一意
  - **id**: リクエストID (auto increment, unique)
    - 採点リクエストが一意に識別されるためのID
    - PKではないが、ユニーク制約があり、インデックスが張られる
    - ジョブキューに登録する際に使用される
  - **ts**: リクエスト時刻 (datetime, 1s精度)
    - 採点リクエストが行われた時刻
  - **request_usercode**: リクエストしたユーザーのコードID (**UserList.id**)
    - 管理者が学生の提出ファイルをジャッジする場合、提出者と採点対象が一致しないことがある
  - **upload_dir_id**: 提出ファイルが格納されたディレクトリのID (**FileLocation.id**)
  - **result**: 採点結果 (**ResultValues.value**)
    - 種類: **ResultValues.name**を参照
    - デフォルトは10 (WJ)
    - 各タスクの実行結果の内、最大値がストアされる
  - **log**: ジャッジログ (JSON)
    - 各テストケースの実行結果が記録される
      - 実行結果 (AC～IE)、実行時間、消費メモリ、実行コマンド、標準入力、標準出力、標準エラー出力
    - その他、最大実行時間、最大消費メモリ等のログも記録される。
- **FileLocation**: アップロードされたファイルの管理
  - **id**: アップロードファイルID (auto increment)
  - **path**: アップロードファイルへのパス (文字列)
  - **ts**: アップロード日時 (datetime, 1s精度)
- **ResultValues**: ジャッジ結果の値
  - **value**: ジャッジ結果の値 (整数)
  - **name**: ジャッジ結果の名前 (文字列)
    - デフォルトで、(value, name)の組み合わせは以下の通り。
      - (0, 'AC'): Accepted, all tasks have passed
      - (1, 'WA'): Wrong Answer, some judge tasks have wrong answer
      - (2, 'TLE'): Time Limit Exceeded, execution time exceeds the limit in some tasks
      - (3, 'MLE'): Memory Limit Exceeded, memory usage exceeds the limit in some tasks
      - (4, 'RE'): Runtime Error, runtime error occurs in some tasks
      - (5, 'CE'): Compile Error, compile error occurs in some tasks
      - (6, 'OLE'): Output Limit Exceeded, output exceeds the limit in some tasks
      - (7, 'IE'): Internal Error, internal error occurs in some tasks
      - (8, 'FN'): File Not Found, all tasks have aborted because some required file not found
      - (9, 'Judging'): Judging now
      - (10, 'WJ'): Wait for Judge
- **FileReference**: ファイルの管理。課題リソースファイルのdescription (markdown) にリンクされたファイル(テキスト、画像)の管理
  - **id**: リファレンスID (auto increment)
  - **lecture_id**: 授業ID (**Lecture.id**)
  - **problem_id**: 課題ID (**Problem.problem_id**)
  - **location_id**: ファイルへのパス (**FileLocation.id**)
- **JobQueue**: ジョブキュー
  - **id**: ジョブID (PK, auto increment)
  - **request_type**: リクエストの種類 (文字列)
    - "validation" or "grading"
  - **request_id**: リクエストID (整数)
    - **ValidationRequest.id** or **GradingRequest.id**
  - **status**: ジョブの状態 (文字列)
    - "pending", "processing", "done"
  - **created_at**: ジョブ作成日時 (datetime, 1s精度)
  - **detail**: ジョブの詳細 (JSON)
    - 実行するタスクの情報 (標準入力ファイル、想定される標準出力ファイル、実行時間制限、メモリ使用量制限等)
    - プログラムコードのディレクトリパス、実行結果を格納する予定のディレクトリパス等
- **ResultQueue**: ジョブの結果を格納するキュー
  - **id**: リファレンスID (PK, auto increment)
  - **job_id**: ジョブID (**JobQueue.id**)
  - **created_at**: 結果作成日時 (datetime, 1s精度)
  - **result**: ジョブの結果 (**ResultValues.value**)
    - 種類: **ResultValues.name**を参照
    - 各タスクの実行結果の内、最大値がストアされる
  - **log**: 詳細 (JSON)
    - 各タスクの戻り値、出力、実行時間、消費メモリ等の情報
    - その他、最大実行時間、最大消費メモリ等のログも記録される。

* 実装の簡潔さのために、課題情報が更新された場合、古い課題情報及びその課題に対するジャッジ結果・アップロードファイルは全て削除される。

## 9. 付録
### 9.1 用語集
- Task: 課題に対して実行されるタスク。以下の種類がある。
  - Build Task: ソースコードをコンパイルするタスク
  - Judge Task: コンパイルされたプログラムを実行し、与えられた入力に対して想定された出力をするか確認するタスク
- Request: 提出されたソースコードに対してタスクを実行するリクエスト。以下の種類がある。
  - Validation Request
    - 提出されたソースコードがコンパイルが通るか、実行ができるか確認すること。全てのタスクは実行しない。
    - ユーザが試行錯誤で何回も頻繁にリクエストされることを想定している。
    - 古いリクエスト結果は重要ではない。
  - Grading Request
    - 提出されたソースコードに対して全てのタスクを実行し、結果を表示すること。
    - 別の提出プラットフォーム(Manaba等)で提出されたソースコードをジャッジすることを想定している。
    - 古いリクエスト結果も重要である。
- Lecture (授業): 複数の課題を含む、授業の単位。具体例としては、「ハッシュ」「木構造」「グラフ」「動的計画法」等がある。
- Problem (課題): 授業内の課題。具体例としては、「必須課題1」「必須課題2」「応用課題」等がある。
- ユーザー: 二種類のIDを持つ
  - コードID: 登録順に自動で割り振られる整数ID。データベースの主キーとして使用される。
    - "登録順"を保持するために用いられている。
  - ユーザーID: 学籍番号などの一意な識別子
    - ログインする際に使用される。
