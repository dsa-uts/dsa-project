-- データベースの作成
CREATE DATABASE IF NOT EXISTS dsa CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- データベースを使用
USE dsa;

-- Lectureテーブル(第1回授業, 第2回授業,...)の作成
CREATE TABLE IF NOT EXISTS Lecture (
    id INT PRIMARY KEY, -- 授業エントリのID
    title VARCHAR(255) NOT NULL, -- 授業のタイトル名 e.g., 課題1, 課題2, ...
    start_date DATETIME NOT NULL, -- 課題ページの公開日
    end_date DATETIME NOT NULL -- 課題ページの公開終了日
);

-- Problemテーブル(課題1-1,1-2,2-1,...)の作成
CREATE TABLE IF NOT EXISTS Problem (
    lecture_id INT NOT NULL, -- Lecture.idからの外部キー
    assignment_id INT NOT NULL, -- 何番目の課題か, e.g., 1, 2, ...
    title VARCHAR(255) NOT NULL, -- 課題名 e.g., 基本課題1
    description_path VARCHAR(255) NOT NULL, -- 課題の説明文のファイルパス
    timeMS INT NOT NULL, -- ジャッジの制限時間[ms] e.g., 1000
    memoryMB INT NOT NULL, -- ジャッジの制限メモリ[MB] e.g., 1024
    PRIMARY KEY (lecture_id, assignment_id),
    FOREIGN KEY (lecture_id) REFERENCES Lecture(id) ON DELETE CASCADE
);

-- Problemのデータの最新zipファイルのパス
-- 課題更新時に、アップロードされたzipファイルを保持しておいて、そのファイルパスを記録する
CREATE TABLE IF NOT EXISTS ProblemZipPath (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ts DATETIME DEFAULT CURRENT_TIMESTAMP,
    lecture_id INT NOT NULL,
    assignment_id INT NOT NULL,
    zip_path VARCHAR(255) NOT NULL,
    FOREIGN KEY (lecture_id, assignment_id) REFERENCES Problem(lecture_id, assignment_id) ON DELETE CASCADE
);

-- Executablesテーブル(実行ファイル名のリスト)の作成
CREATE TABLE IF NOT EXISTS Executables (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lecture_id INT,
    assignment_id INT,
    eval BOOLEAN DEFAULT FALSE, -- 課題採点時に追加で要求される実行バイナリの場合、True
    name VARCHAR(255) NOT NULL, -- 実行ファイル名
    FOREIGN KEY (lecture_id, assignment_id) REFERENCES Problem(lecture_id, assignment_id) ON DELETE CASCADE
);

-- ArrangedFilesテーブル(あらかじめこちらで用意したファイルリスト)の作成
CREATE TABLE IF NOT EXISTS ArrangedFiles (
    id INT AUTO_INCREMENT PRIMARY KEY, -- ソースコードのID(auto increment)
    lecture_id INT, -- 何回目の授業で出される課題か, e.g., 1, 2, ...
    assignment_id INT, -- 何番目の課題か, e.g., 1, 2, ...
    eval BOOLEAN DEFAULT FALSE, -- 課題採点時に追加で必要となる場合、True
    path VARCHAR(255) NOT NULL, -- ソースコードのパス(Makefileも全部含める)
    FOREIGN KEY (lecture_id, assignment_id) REFERENCES Problem(lecture_id, assignment_id) ON DELETE CASCADE
);

-- RequiredFilesテーブル(ユーザに提出を求めれているファイルのリスト)の作成
-- ユーザが提出を求められるファイルに関しては、評価用/非評価用に関わらず、必ず提出されるものとする
CREATE TABLE IF NOT EXISTS RequiredFiles (
    id INT AUTO_INCREMENT PRIMARY KEY, -- ソースコードのID(auto increment)
    lecture_id INT, -- 何回目の授業で出される課題か, e.g., 1, 2, ...
    assignment_id INT, -- 何番目の課題か, e.g., 1, 2, ...
    name VARCHAR(255) NOT NULL, -- 提出が求められるファイルの名前
    FOREIGN KEY (lecture_id, assignment_id) REFERENCES Problem(lecture_id, assignment_id) ON DELETE CASCADE
);


-- TestCasesテーブル(実行するテストのリスト)の作成
CREATE TABLE IF NOT EXISTS TestCases (
    id INT AUTO_INCREMENT PRIMARY KEY, -- テストケースのID(auto increment)
    lecture_id INT, -- 何回目の授業で出される課題か, e.g., 1, 2, ...
    assignment_id INT, -- 何番目の課題か, e.g., 1, 2, ...
    eval BOOLEAN DEFAULT FALSE, -- 課題採点用かどうか, True/False
    type ENUM('Built', 'Judge') NOT NULL, -- 採点するタイミング
    score INT NOT NULL, -- スコア
    title VARCHAR(255) NOT NULL, -- テストケースのタイトル
    description TEXT, -- 簡単な1行の説明
    message_on_fail VARCHAR(255), -- 失敗した場合のメッセージ(一行、10文字程度)
    command VARCHAR(255) NOT NULL, -- e.g., "./run.sh", "ls", ...
    args VARCHAR(255), -- スクリプトもしくは実行バイナリに渡す引数
    stdin_path VARCHAR(255), -- 標準入力のパス, path/to/stdin.txt
    stdout_path VARCHAR(255), -- 想定される標準出力のパス, path/to/stdout.txt
    stderr_path VARCHAR(255), -- 想定される標準エラー出力のパス, path/to/stderr.txt
    exit_code INT NOT NULL DEFAULT 0, -- 想定される戻り値
    FOREIGN KEY (lecture_id, assignment_id) REFERENCES Problem(lecture_id, assignment_id) ON DELETE CASCADE
);


-- Users テーブル
CREATE TABLE IF NOT EXISTS Users (
    user_id VARCHAR(255) PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'manager', 'student') NOT NULL,
    disabled BOOLEAN DEFAULT false NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    active_start_date DATETIME NOT NULL,
    active_end_date DATETIME NOT NULL
);


-- LoginHistory テーブル
CREATE TABLE IF NOT EXISTS LoginHistory (
    user_id VARCHAR(255) NOT NULL,
    login_at DATETIME NOT NULL,
    logout_at DATETIME NOT NULL, -- ログアウト予定の時刻(リフレッシュトークンにより更新される予定あり)
    refresh_count INT DEFAULT 0,  -- リフレッシュした回数、回数制限つける
    PRIMARY KEY (user_id, login_at),
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
);


-- BatchSubmissionテーブルの作成
CREATE TABLE IF NOT EXISTS BatchSubmission (
    id INT AUTO_INCREMENT PRIMARY KEY, -- バッチ採点のID(auto increment)
    ts DATETIME DEFAULT CURRENT_TIMESTAMP, -- バッチ採点のリクエスト時刻
    user_id VARCHAR(255), -- リクエストした管理者のID
    lecture_id INT NOT NULL, -- 何回目の授業で出される課題が採点対象か
    message TEXT DEFAULT NULL, -- バッチ採点時のメッセージ(ある学生はUserテーブルに登録されていないため採点されない、など)
    complete_judge INT DEFAULT NULL, -- ジャッジが完了したSubmissionの数
    total_judge INT DEFAULT NULL, -- 採点対象のSubmissionの数
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (lecture_id) REFERENCES Lecture(id) ON DELETE CASCADE
);


-- 採点対象の学生ごとに、レポートの提出状況(パス)と、全体の採点結果をまとめたもの
CREATE TABLE IF NOT EXISTS EvaluationStatus (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    status ENUM('submitted', 'delay', 'non-submitted') NOT NULL, -- 提出状況 (reportlist.xlsの"# 提出"の値が"提出済"の場合は"submitted", "受付終了後提出"の場合は"delay", "未提出"の場合は"non-submitted")
    result ENUM('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'IE', 'FN') DEFAULT NULL, -- 採点結果
    upload_dir VARCHAR(255) DEFAULT NULL, -- 提出されたファイルがあるディレクトリのパス(未提出の場合はNULL)
    report_path VARCHAR(255) DEFAULT NULL, -- 提出されたレポートのパス(未提出の場合はNULL)
    submit_date DATETIME DEFAULT NULL, -- 提出日時 (reportlist.xlsの"# 提出日時"の値)
    FOREIGN KEY (batch_id) REFERENCES BatchSubmission(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
);


-- Submissionテーブルの作成
CREATE TABLE IF NOT EXISTS Submission (
    id INT AUTO_INCREMENT PRIMARY KEY, -- 提出されたジャッジリクエストのID(auto increment)
    ts DATETIME DEFAULT CURRENT_TIMESTAMP, -- リクエストされた時刻
    evaluation_status_id INT DEFAULT NULL, -- 採点対象のユーザのID
    user_id VARCHAR(255) NOT NULL, -- 採点対象のユーザのID
    lecture_id INT NOT NULL, -- 何回目の授業で出される課題か, e.g., 1, 2, ...
    assignment_id INT NOT NULL, -- 何番目の課題か, e.g., 1, 2, ...
    eval BOOLEAN NOT NULL, -- 課題採点リクエストかどうか, True/False
    upload_dir VARCHAR(255) NOT NULL, -- 提出されたファイルがあるディレクトリへのパス
    progress ENUM('pending', 'queued', 'running', 'done') DEFAULT 'pending', -- リクエストの処理状況, pending/queued/running/done
    total_task INT NOT NULL DEFAULT 0, -- 実行しなければならないTestCaseの数
    completed_task INT NOT NULL DEFAULT 0, -- 現在実行完了しているTestCaseの数
    result ENUM('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'IE', 'FN') DEFAULT NULL, -- 採点結果
    message VARCHAR(255) DEFAULT NULL, -- メッセージ(5文字～10文字程度)
    detail VARCHAR(255) DEFAULT NULL, -- 詳細(ファイルが足りない場合: "main.c func.c....", 実行ファイルが足りない場合: "main, func,...")
    score INT DEFAULT NULL, -- 集計スコア (該当Submissionリクエストの全scoreの合計)
    timeMS INT DEFAULT NULL, -- 実行時間[ms]
    memoryKB INT DEFAULT NULL, -- 消費メモリ[KB]
    FOREIGN KEY (evaluation_status_id) REFERENCES EvaluationStatus(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (lecture_id, assignment_id) REFERENCES Problem(lecture_id, assignment_id) ON DELETE CASCADE
);


-- JudgeResultテーブルの作成
CREATE TABLE IF NOT EXISTS JudgeResult (
    id INT AUTO_INCREMENT PRIMARY KEY, -- ジャッジ結果のID(auto increment)
    submission_id INT NOT NULL, -- ジャッジ結果に紐づいているSubmissionのID
    testcase_id INT NOT NULL, -- ジャッジ結果に紐づいているテストケースのID
    result ENUM('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'IE') NOT NULL, -- 実行結果のステータス、 AC/WA/TLE/MLE/CE/RE/OLE/IE, 参考: https://atcoder.jp/contests/abc367/glossary
    command VARCHAR(255) NOT NULL, -- 実行したコマンド
    timeMS INT NOT NULL, -- 実行時間[ms]
    memoryKB INT NOT NULL, -- 消費メモリ[KB]
    exit_code INT NOT NULL, -- 戻り値
    stdout TEXT NOT NULL, -- 標準出力
    stderr TEXT NOT NULL, -- 標準エラー出力
    FOREIGN KEY (submission_id) REFERENCES Submission(id) ON DELETE CASCADE,
    FOREIGN KEY (testcase_id) REFERENCES TestCases(id) ON DELETE CASCADE
);
