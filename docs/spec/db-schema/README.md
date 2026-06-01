# Database Design

## users

| type | attribute | PK/FK/unique/nullable | description |
| ---- | --------- | ----- | ----------- |
| UUID |    internal_id  | PK | internal ID |
| varchar(255) | userid |  unique | user ID |
| varchar(255) | name |  | user name |
| varchar(255) | hashed_password | | hashed Password |
| int  | role_id | FK (user_role.id) | specifying user privileges |
| varchar(255) | email | nullable | optional |

## user_role

| type | attribute | PK/FK/unique/nullable | description |
| ---- | --------- | --------------------- | ----------- |
|  int | id        | PK                    |             |
| varchar(255) | name |                    | role name   |

These (id, name) tuples are set:
- (1, 'admin')
- (2, 'manager')
- (3, 'student')

## login_history

| type | attribute | PK/FK/unique/nullable | description |
| ---- | --------- | --------------------- | ----------- |
| UUID | id        | PK    |             |
| UUID | user_id   | FK (users.internal_id)| |
| datetime | login_at |                    | timestamp when a user logs in |
| datetime | logout_at |                   | * timestamp when a user logs out<br>* same as an expiration date of an access token<br>* If user logs out actively, update this field.|

## lecture
Lecture情報を管理する e.g., "二分木", "ソート"

| type | attribute | PK/FK/unique/nullable | description |
| ---- | --------- | --------------------- | ----------- |
| int  | id        | PK                    | * lectures are displayed in ascending order of id |
| varchar(255) | title  |                       |             |
| datetime | start_at |                    | when this lecture will be made public to students |
| datetime | deadline |                    | * submission deadline<br>* this field is used to distinguish late submission from others |

## lecture_resource
Lectureのリソース情報(Problemごとの説明文、テストケース)をバージョン管理する。リソース情報でストレージサーバー経由で取得する。

| type | attribute | PK/FK/unique/nullable | description |
| ---- | --------- | --------------------- | ----------- |
| UUID | id        | PK                    |             |
| int  | lecture_id | FK(lecture.id)   |             |
| datetime | registered_at |            |             |
| varchar(255) | hash | unique             | hash value of resource |
| varchar(255) | hash_pub |                | * hash value of public resource<br>* "eval only" testcases are omitted |
| text | comment | | comment writing a change history | 

## validation_request

| type | attribute | PK/FK/unique/nullable | description |
| ---- | --------- | --------------------- | ----------- |
| UUID  | id        | PK   |             |
| datetime | ts    |                       | time the request was issued |
| UUID  | usercode  | FK(users.id)          | requester id |
| int  | lecture_id | FK (lecture.id)      |             |
| varchar(255)  | hash      | unique                | hash value of uploaded file |

## validation_result

* request_idに紐づいているvalidation_requestのlecture_idと、resource_idに紐づいているlecture_resource.lecture_idが一致していないといけないが、現状スキーマの方で一致させる制約をつけることができてきない。
* PKがない

| type | attribute | PK/PK/unique/nullable | description |
| ---- | --------- | --------------------- | ----------- |
| UUID  | request_id | FK(validation_request.id) |           |
| UUID | resource_id | FK(lecture_resource.id) | |
| int  | result | FK(result_values.value) | |
| varchar(255) | hash | | |

## grading_request


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
      - (2, 'RE'): Runtime Error, runtime error occurs in some tasks
      - (3, 'TLE'): Time Limit Exceeded, execution time exceeds the limit in some tasks
      - (4, 'MLE'): Memory Limit Exceeded, memory usage exceeds the limit in some tasks
      - (5, 'OLE'): Output Limit Exceeded, output exceeds the limit in some tasks
      - (6, 'CE'): Compile Error, compile error occurs in some tasks
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


