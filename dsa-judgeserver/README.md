# dsa-judge-server
## 背景・目的
プログラム課題のチェックを自動化するためのジャッジサーバーを作成する。

## 要件
クライアントがDBサーバにジャッジリクエストを登録する。周期的にDBサーバをポーリングしているジャッジ
サーバーがそのリクエストを検知し、リクエストに則ってコンパイル・実行・チェックを行う。その後、結果を
DBサーバーに登録する。

見づらい場合は、[pdf](schema.pdf)を参照

TODO: スキーマの更新

```mermaid 
erDiagram
	Lecture {
		Int id PK "授業エントリのID"
		String title "授業のタイトル名 e.g., 課題1, 課題2, ..."
		TimeStamp start_date "課題ページの公開日"
		TimeStamp end_date "課題ページの公開終了日"
	}
	Problem {
		Int lecture_id PK "Lecture.idからの外部キー"
		Int assignment_id PK "何番目の課題か, e.g., 1, 2, ..."
		Boolean for_evaluation PK "課題採点用かどうか, True/False"
		String title "課題名 e.g., 基本課題1"
		String description_path "課題の説明文のファイルパス"
		Int timeMS "ジャッジの制限時間[ms] e.g., 1000"
		Int memoryMB "ジャッジの制限メモリ[MB] e.g., 1024"
	}
	Executables {
		Int id PK "ID(auto increment)"
		Int lecture_id PK "Lecture.idからの外部キー"
		Int assignment_id PK "何番目の課題か, e.g., 1, 2, ..."
		Boolean for_evaluation PK "課題採点用かどうか, True/False"
		String name "実行ファイル名"
	}
	ArrangedFiles {
		String str_id PK "ソースコードのID(auto increment)"
		Int lecture_id FK "何回目の授業で出される課題か, e.g., 1, 2, ..."
		Int assignment_id FK "何番目の課題か, e.g., 1, 2, ..."
		Boolean for_evaluation FK "課題採点用かどうか, True/False"
		String path "ファイルのパス(Makefileも全部含める)"
	}
	RequiredFiles {
		Int id PK "ソースコードのID(auto increment)"
		Int lecture_id FK "何回目の授業で出される課題か, e.g., 1, 2, ..."
		Int assignment_id FK "何番目の課題か, e.g., 1, 2, ..."
		Boolean for_evaluation FK "課題採点用かどうか, True/False"
		String name "ファイル名(Makefileも全部含める)"
	}
	EvaluationItems {
		String str_id PK "評価項目のID(auto increment)"
		Int lecture_id FK "何回目の授業で出される課題か, e.g., 1, 2, ..."
		Int assignment_id FK "何番目の課題か, e.g., 1, 2, ..."
		Boolean for_evaluation FK "課題採点用かどうか, True/False"
		String title "e.g., func1"
		String description "説明"
		Int score "評価点"
		Enum type "Built, Judge"
		Int arranged_files_id FK "紐づいているソースコードのID, NULLABLE"
		String message_on_fail "失敗した場合のメッセージ(一行、10文字程度)"
	}
	TestCases {
		Int id PK "テストケースのID(auto increment)"
		Int eval_id FK "紐づいている評価項目のID"
		String description "簡単な一行の説明"
		String command "e.g., './run.sh', 'ls', ..."
		String argument_path  "スクリプト/executableの引数のファイルパス"
		String stdin_path "標準入力のパス, path/to/stdin.txt"
		String stdout_path "想定される標準出力のパス, path/to/stdout.txt"
		String stderr_path "想定される標準エラー出力のパス, path/to/stderr.txt"
		Int exit_code "想定される戻り値"
	}
	Lecture ||--|{ Problem : "has many problems"
	Problem ||--|{ RequiredFiles : "has many required files"
	Problem ||--|{ ArrangedFiles : "has many arranged files"
	Problem ||--|{ Executables : "has many executables"
	Problem ||--|{ EvaluationItems : "has many evaluation items"
	ArrangedFiles o|--|{ EvaluationItems : "has associated arranged files or none"
	EvaluationItems ||--|{ TestCases : "has many test cases"

	Users {
		String user_id PK "ユーザID"
		String username "ユーザ名"
		String email "メールアドレス"
		String hashed_password ""
		Boolean is_admin ""
		Boolean disabled
		TimeStamp created_at
		TimeStamp updated_at
		TimeStamp active_start_date
		TimeStamp active_end_date
	}
	BatchSubmission {
		Int id PK "バッチ採点のID(auto increment)"
		TimeStamp ts "バッチ採点のリクエスト時刻"
		Int user_id FK "リクエストした管理者のID"
	}
	Submission {
		Int id PK "提出されたジャッジリクエストのID(auto increment)"
		TimeStamp ts "リクエストされた時刻"
		Int batch_id FK "ジャッジリクエストが属しているバッチリクエストのID, 学生のフォーマットチェック提出ならNULL"
		String user_id FK "採点対象のユーザのID"
		Int lecture_id FK "何回目の授業で出される課題か, e.g., 1, 2, ..."
		Int assignment_id FK "何番目の課題か, e.g., 1, 2, ..."
		Boolean for_evaluation FK "課題採点用かどうか, True/False"
		Enum progress "リクエストの処理状況, pending/queued/running/done"
	}
	UploadedFiles {
		Int id PK "アップロードされたファイルのID(auto increment)"
		TimeStamp ts "アップロードされた時刻"
		Int submission_id FK "そのファイルが必要なジャッジリクエストのID"
		String path "アップロードされたファイルのパス"
	}
	JudgeResult {
		Int id PK "ジャッジ結果のID(auto increment)"
		Timestamp ts "ジャッジ結果が出た時刻"
		Int submission_id FK "ジャッジ結果に紐づいているジャッジリクエストのID"
		Int testcase_id FK "ジャッジ結果に紐づいているテストケースのID"
		Int timeMS "実行時間[ms]"
		Int memoryKB "消費メモリ[KB]"
		Enum result "実行結果のステータス、 AC/WA/TLE/MLE/RE/CE/OLE/IE"
		String stdout "標準出力"
		String stderr "標準エラー出力"
		Int exit_code "戻り値"
	}
	EvaluationSummary {
		Int id PK "挿入ID"
		Int submission_id FK "対象のSubmissionリクエストのID"
		Int batch_id FK "Submissionリクエストに紐づいたBatchリクエストのID"
		String user_id FK "採点対象のユーザID"
		Int lecture_id FK "何回目の授業で出される課題か, e.g., 1, 2, ..."
		Int assignment_id FK "何番目の課題か, e.g., 1, 2, ..."
		Boolean for_evaluation FK "課題採点用かどうか, True/False"
		String eval_id FK "評価項目の文字列ID"
		String arranged_files_id FK "評価項目に紐づいているソースコードのID"
		Enum result "評価項目に含まれる全TestCaseの実行結果"
		String message "メッセージ(5文字～10文字程度)"
		String detail "詳細"
		Int score "集計結果"
	}

	SubmissionSummary {
		Int submission_id PK "対象のSubmissionリクエストのID"
		Int batch_id FK "Submissionリクエストに紐づいたBatchリクエストのID"
		String user_id FK "採点対象のユーザID"
		Int lecture_id FK "何回目の授業で出される課題か, e.g., 1, 2, ..."
		Int assignment_id FK "何番目の課題か, e.g., 1, 2, ..."
		Boolean for_evaluation FK "課題採点用かどうか, True/False"
		Enum result "評価項目に含まれる全TestCaseの実行結果"
		String message "メッセージ(5文字～10文字程度)"
		String detail "詳細"
		Int score "集計結果"
	}

	Users ||--|{ BatchSubmission : "has many batch submissions"
	Users ||--|{ Submission : "has many single submissions"
	BatchSubmission ||--|{ Submission : "is composed of single submissions"
	Problem ||--|{ Submission : "has many requested submissions"
	Submission ||--|{ UploadedFiles : "has many associated uploaded files"
	Submission ||--|| SubmissionSummary: ""
	SubmissionSummary ||--|{ EvaluationSummary: ""
	EvaluationSummary ||--|{ JudgeResult: ""
	
```

* サンドボックス上で実行する処理として、(1) プログラムをコンパイルする「コンパイル」処理 (2) コンパイルしたプログラムを動作させてチェックする「ジャッジ」処理 (3) その他のファイルが存在するかチェックすることや、オブジェクトファイル解析などの「解析」処理 の3つに分けられる。ジャッジ処理は実行時間やメモリ使用量を指定できるが、コンパイル処理と解析処理は制限時間2秒、最大メモリ使用量512MBに固定する。
* サンドボックス上で出力される標準出力(stdout)と標準エラー出力(stderr)の最大サイズは8000bytesとする。

## 設計
アーキテクチャは[imozさんが過去に実装したもの](https://imoz.jp/note/onlinejudge.html)と同一
である。違う所は、ここではジャッジサーバとデータベースしか実装していない点である。
1. 学生がジャッジリクエストをWebサーバに提出し、Webサーバはその内容をデータベースサーバに登録する。
2. 定期的にデータベースをチェックするジャッジサーバがそれを検出し、ジャッジを行い、結果をデータベースサーバ
に登録する。
3. 登録された結果をWebサーバが取得し、選手に返す。
```mermaid
graph LR
  A[選手] --> B[Webサーバ]
	B <--> C[データベース]
	C <--> D[ジャッジサーバ]
```

judgeサーバーはDockerコンテナで動かす。クライアントが登録したタスクを元に、judgeサーバーが
コンパイル・実行用のsandboxコンテナを生成し、その中でコンパイル・実行を行う。
sandboxコンテナ生成は、ホストのDockerデーモンを利用する。

プログラムのビルド・実行などは、以下のような手順で行う。
1. Dockerボリュームを作成し、クライアントがアップロードしたファイルをコピーする
2. サンドボックスコンテナを`docker create`で生成し、ボリュームをマウントする。この際、実行する
    コマンドも指定する
3. サンドボックスコンテナを`docker start -i`で起動する。標準入出力を受け取るた
    め、`-i`オプションを付ける

制限時間のチェックは'docker start'コマンドを実行する関数にタイムアウトを設定する
ことで行う。メモリ消費量・プロセス数・ディスク消費量の制限は、`docker create`す
るときにリソース制限コマンド(cgroupsやulimitが用いられている)を用いて行う。

参考: https://imoz.jp/note/onlinejudge.html

参考: https://github.com/yosupo06/library-checker-judge

## 代替案
[参考資料](https://imoz.jp/note/onlinejudge.html)より、

> ### ジャッジシステムへの攻撃手法とその対処法
> ジャッジシステムはいかなるプログラムをコンパイル・実行してもシステムダウンしてしまってはいけません．そこで，ユーザプログラムに対して監視を行い，システムに危険が及ぶような状況になった場合は実行を停止しなければなりません．近年の国際情報オリンピックで用いられているジャッジシステム MOE は ptrace を用いてユーザプログラムを監視します．しかし，ptrace を用いると各々のシステムコールに対してどのような動作をするか決定しなければならず，また介入を行う必要が発生するために速度の低下も招きます．Imo Judge では出来る限りユーザプログラムを通常の状態に近い状態で実行するため ptrace は用いず，カーネルレベルで処理を行う ulimit や cgroups を用いてユーザプログラムの制限を行います．
> ### メモリを食いつぶす攻撃手法
> ヒープメモリを多量に確保する攻撃手法です．多量のスワップが発生しそれらの影響でジャッジサーバの動作が不安定になることがあります．ulimit ではメモリの制限ができないため cgroups を用いてメモリの制限を行います．制限をかける対象は Virtual Memory ではなく Resident Memory である必要があります．特に Java を実行する場合は Virtual Memory に対して制限をかけた場合，起動さえしない場合があるので注意が必要です．
> ### ディスクを食いつぶす攻撃手法
> ディスク書き込みをし続けることによりディスクの残容量を少なくする攻撃手法です．ジャッジサーバで予期せぬエラーを発生させる場合があるので，ulimit を用いて制限を行います．
> ### fork を用いた攻撃手法
> Fork 爆弾 と呼ばれる攻撃手法です．ulimit を用いてプロセス数の制限を行います．Java は複数のプロセスを生成するため厳しいプロセス制限を行うと Java プログラムを実行することができません．また Fork 爆弾は 1 つずつプロセスを kill しても全て終了させることが (kill している間に次々と新しいプロセスが生成するため) 困難であるので，kill -1 を用いて一掃します．
> ### コンパイルエラーを用いた攻撃手法
> C++ の template は深さ制限がなければチューリング完全であるのでコンパイルが停止しないことがあります．それどころか Warning を履き続けるようなソースコードを作ることも可能であるので，適切にそのような状況があることを考えてコンパイル処理を書かなければなりません．具体的にはコンパイルに時間制限を設け，コンパイルエラーの出力は適切に切り落とす必要があります．
> ### kill を用いた攻撃手法
> ユーザプログラムを監視するプログラムがユーザプログラムと同じ権限で動いている場合，ユーザプログラムによって kill が成功してしまいます．その時はユーザプログラムによる攻撃なのか，ジャッジプログラムがバグによって終了したのかが判断できません．よって，ジャッジプログラムを別の権限で動かす必要があります．
> ### /tmp, /var/tmp を用いた攻撃手法
> /tmp, /var/tmp にプログラムを書き込むプログラムを送り，次にそれらのファイルを include するプログラムを書くと一見ショートコーディングにできます．初代 Imo Judge では /tmp のみの削除を行なっていたため，iwiwi 先生に /var/tmp に書きこまれ攻撃が成功してしまいました．

DMOJのジャッジサーバーはptraceを用いてプログラムの実行を監視しているが、実装が非常に複雑である。
このプロジェクトでは、dockerの機能を用いてコンテナのリソース制限を行うことで、ジャッジサーバーの実装を簡略化する。

参考: https://knowledge.sakura.ad.jp/5118/

参考: https://docs.docker.jp/v19.03/config/container/resource_constraints.html

## セキュリティ上の懸念
JudgeサーバーのDockerソケットをホストマシンのDocker Engineに接続することで、
コンテナ内からホストのDocker Engineを操作できる。これにより、このJudgeサーバーに
侵入した悪意のあるユーザが、ホストマシン上の全てのコンテナを操作してしまう可能性がある。
これにより、ホストのroot権限を奪われる可能性がある？。

https://speakerdeck.com/narupi/dockerkontenakarahosutofalserootwoqu-ruhua?slide=10

対策として、Judgeサーバーのエンドポイントを作らないようにし、DBサーバーに一方的に問い合わせる
ようにしている。
