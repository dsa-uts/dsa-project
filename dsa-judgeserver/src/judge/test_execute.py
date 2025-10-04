# テストプログラム実行方法
# $ cd src
# $ pytest --log-cli-level=INFO test_execute.py
import pytest
from .sandbox.execute import ContainerInfo
from .sandbox.execute import DockerVolume
from .sandbox.execute import VolumeMountInfo
from .sandbox.execute import TaskInfo, WatchDogResult
import logging
from datetime import timedelta
from tempfile import TemporaryDirectory
from pathlib import Path
import time
import docker
from dotenv import load_dotenv
import os

from .db.crud import *
from .db.database import SessionLocal

# ロガーの設定
logging.basicConfig(level=logging.INFO)
test_logger = logging.getLogger(__name__)

load_dotenv()
GUEST_UID = os.getenv("GUEST_UID")
GUEST_GID = os.getenv("GUEST_GID")

# Dockerコンテナを起動して、Hello, World!を出力するテスト
def test_RunHelloWorld():
    client = docker.client.from_env()
    container = ContainerInfo(
        client=client,
        imageName="binary-runner",
        arguments=["sleep", "3600"],
        interactive=False,
        user=GUEST_UID,
        groups=[GUEST_GID],
        workDir="/home/guest",
        memoryLimitMB=256,
    )
    
    err = container.start()
    assert err.message == ""

    result, err = container.exec_run(
        command=["echo", "Hello, World!"],
        user=f"{GUEST_UID}:{GUEST_GID}",
        workDir="/home/guest",
        timeoutSec=5.0
    )

    test_logger.info(result)
    test_logger.info(err)

    assert err.message == ""

    assert result.exitCode == 0

    assert result.stdout == "Hello, World!\n"

    assert result.stderr == ""
    
    err = container.remove()
    assert err.message == ""


# sandboxの戻り値をきちんとチェックできているか確かめるテスト
def test_ExitCode():
    client = docker.client.from_env()
    container = ContainerInfo(
        client=client,
        imageName="binary-runner",
        arguments=["sleep", "3600"],
        interactive=False,
        user=GUEST_UID,
        groups=[GUEST_GID],
        workDir="/home/guest",
        memoryLimitMB=256,
    )
    err = container.start()
    assert err.message == ""
    
    result, err = container.exec_run(
        command=["sh", "-c", "exit 123"],
        user=f"{GUEST_UID}:{GUEST_GID}",
        workDir="/home/guest",
        timeoutSec=5.0
    )

    test_logger.info(result)
    test_logger.info(err)

    assert err.message == ""
    assert result.exitCode == 123
    assert result.stdout == ""
    assert result.stderr == ""
    
    err = container.remove()
    assert err.message == ""


# 標準出力をきちんとキャプチャできているか確かめるテスト
def test_Stdout():
    client = docker.client.from_env()
    container = ContainerInfo(
        client=client,
        imageName="binary-runner",
        arguments=["sleep", "3600"],
        interactive=False,
        user=GUEST_UID,
        groups=[GUEST_GID],
        workDir="/home/guest",
        memoryLimitMB=256,
    )
    err = container.start()
    assert err.message == ""

    result, err = container.exec_run(
        command=["echo", "dummy"],
        user=f"{GUEST_UID}:{GUEST_GID}",
        workDir="/home/guest",
        timeoutSec=5.0
    )

    test_logger.info(result)
    test_logger.info(err)

    assert err.message == ""
    assert result.exitCode == 0
    assert result.stdout == "dummy\n"
    assert result.stderr == ""
    
    err = container.remove()
    assert err.message == ""


# 標準エラー出力をちゃんとキャプチャできているか確かめるテスト
def test_Stderr():
    client = docker.client.from_env()
    container = ContainerInfo(
        client=client,
        imageName="binary-runner",
        arguments=["sleep", "3600"],
        interactive=False,
        user=GUEST_UID,
        groups=[GUEST_GID],
        workDir="/home/guest",
        memoryLimitMB=256,
    )
    err = container.start()
    assert err.message == ""
    
    result, err = container.exec_run(
        command=["sh", "-c", "echo dummy >&2"],
        user=f"{GUEST_UID}:{GUEST_GID}",
        workDir="/home/guest",
        timeoutSec=5.0
    )

    test_logger.info(result)
    test_logger.info(err)

    assert err.message == ""
    assert result.exitCode == 0
    assert result.stdout == ""
    assert result.stderr == "dummy\n"
    
    err = container.remove()
    assert err.message == ""


# sleepした分ちゃんと実行時間が計測されているか確かめるテスト
def test_SleepTime():
    client = docker.client.from_env()
    container = ContainerInfo(
        client=client,
        imageName="binary-runner",
        arguments=["sleep", "3600"],
        interactive=False,
        user=GUEST_UID,
        groups=[GUEST_GID],
        workDir="/home/guest",
        memoryLimitMB=256,
    )
    err = container.start()
    assert err.message == ""
    
    result, err = container.exec_run(
        command=["sleep", "3"],
        user=f"{GUEST_UID}:{GUEST_GID}",
        workDir="/home/guest",
        timeoutSec=5.0
    )

    test_logger.info(result)
    test_logger.info(err)

    assert err.message == ""
    assert result.exitCode == 0
    assert result.stdout == ""
    assert result.stderr == ""
    assert result.timeMS >= 2000 and result.timeMS <= 5000
    
    err = container.remove()
    assert err.message == ""


# コンテナにファイルがコピーできているか確かめるテスト
def test_FileCopy():
    client = docker.client.from_env()
    container = ContainerInfo(
        client=client,
        imageName="binary-runner",
        arguments=["sleep", "3600"],
        interactive=False,
        user=GUEST_UID,
        groups=[GUEST_GID],
        workDir="/home/guest",
        memoryLimitMB=256,
    )
    err = container.start()
    assert err.message == ""
    
    with TemporaryDirectory() as tmpdir:
        with open(Path(tmpdir) / "dummy.txt", "w") as f:
            f.write("dummy\n")
        
        err = container.uploadFile(srcInHost=Path(tmpdir) / "dummy.txt", dstInContainer=Path("/home/guest"))
        assert err.message == ""
    
    res, err = container.exec_run(
        command=["cat", "/home/guest/dummy.txt"],
        user=f"{GUEST_UID}:{GUEST_GID}",
        workDir="/home/guest",
        timeoutSec=5.0
    )
    assert err.message == ""
    assert res.exitCode == 0
    assert res.stdout == "dummy\n"
    assert res.stderr == ""
    
    err = container.remove()
    assert err.message == ""

# タイムアウトをきちんと検出できているか確かめるテスト
def test_Timeout():
    client = docker.client.from_env()
    container = ContainerInfo(
        client=client,
        imageName="binary-runner",
        arguments=["sleep", "3600"],
        interactive=False,
        user=GUEST_UID,
        groups=[GUEST_GID],
        workDir="/home/guest",
        memoryLimitMB=256,
    )
    err = container.start()
    assert err.message == ""
    
    result, err = container.exec_run(
        command=["sleep", "100"],
        user=f"{GUEST_UID}:{GUEST_GID}",
        workDir="/home/guest",
        timeoutSec=3.0
    )

    test_logger.info(result)
    test_logger.info(err)

    assert err.message != ""
    assert result.timeMS >= 2000 and result.timeMS <= 5000
    
    # コンテナがkillされたので、コンテナを再起動
    err = container.start()
    assert err.message == ""
    
    # WatchDogを用いて、タイムアウトを検出できるか確かめる
    task_info = TaskInfo(
        command="sleep 100",
        stdin="",
        timeoutMS=3000,
        memoryLimitMB=256,
        uid=int(GUEST_UID),
        gid=int(GUEST_GID),
    )

    with TemporaryDirectory() as tmpdir:
        with open(Path(tmpdir) / "task.json", "w") as f:
            f.write(task_info.model_dump_json())

        err = container.uploadFile(srcInHost=Path(tmpdir) / "task.json", dstInContainer=Path("/home/guest"))
        assert err.message == ""
        
        res, err = container.exec_run(
            command=["chown", "root:root", "/home/guest/task.json"],
            user="root",
            workDir="/home/guest",
            timeoutSec=2.0
        )
        assert err.message == ""
        
        res, err = container.exec_run(
            command=["chmod", "600", "/home/guest/task.json"],
            user="root",
            workDir="/home/guest",
            timeoutSec=2.0
        )
        assert err.message == ""

        res, err = container.exec_run(
            command=["/home/watchdog", "task.json"],
            user="root",
            workDir="/home/guest",
            timeoutSec=8.0
        )
        assert err.message == ""
        
        test_logger.info(res)
        
        watchdog_result = WatchDogResult.model_validate_json(res.stdout)
        assert watchdog_result.TLE == True

    err = container.remove()
    assert err.message == ""

# メモリ制限を検出できるかチェック
def test_MemoryLimit():
    client = docker.client.from_env()
    container = ContainerInfo(
        client=client,
        imageName="binary-runner",
        arguments=["sleep", "3600"],
        interactive=False,
        user=GUEST_UID,
        groups=[GUEST_GID],
        workDir="/home/guest",
        memoryLimitMB=500,
    )
    err = container.start()
    assert err.message == ""

    result, err = container.exec_run(
        command=["dd", "if=/dev/zero", "of=/dev/null", "bs=800M"],
        user="root",
        workDir="/home/guest",
        timeoutSec=3.0,
    )

    test_logger.info(result)
    test_logger.info(err)
    
    container._container.reload()
    test_logger.info(f"container status: {container._container.status}")
    
    # メモリ制限超過により、OOM Killerがコンテナをkillする。その際、内部のプロセスもkillされ、
    # そのプロセスの終了コードが137となる
    assert result.exitCode == 137
    
    # コンテナを再起動
    # startではなくrestartを使うのは、確実にstop -> startの順でコンテナを確実に停止->起動
    # させるためである。
    # startの場合、コンテナがまだ停止していない場合何も副作用を起こさず、その後OOM Killerにより
    # 停止する、といいったことが起こり、その後のexec_runリクエストを停止したコンテナに送信して
    # 失敗するといったことが起こる。
    err = container.restart()
    assert err.message == ""
    
    container._container.reload()
    test_logger.info(f"container status: {container._container.status}")
    
    # WatchDogを用いて、メモリ制限を検出できるか確かめる
    task_info = TaskInfo(
        command="dd if=/dev/zero of=/dev/null bs=800M",
        stdin="",
        timeoutMS=3000,
        memoryLimitMB=300,
        uid=int(GUEST_UID),
        gid=int(GUEST_GID),
    )
    
    with TemporaryDirectory() as tmpdir:
        with open(Path(tmpdir) / "task.json", "w") as f:
            f.write(task_info.model_dump_json())
        
        err = container.uploadFile(srcInHost=Path(tmpdir) / "task.json", dstInContainer=Path("/home/guest"))
        assert err.message == ""
        
        res, err = container.exec_run(
            command=["chown", "root:root", "/home/guest/task.json"],
            user="root",
            workDir="/home/guest",
            timeoutSec=2.0
        )
        assert err.message == ""
        
        res, err = container.exec_run(
            command=["chmod", "600", "/home/guest/task.json"],
            user="root",
            workDir="/home/guest",
            timeoutSec=2.0
        )
        assert err.message == ""
        
        res, err = container.exec_run(
            command=["/home/watchdog", "task.json"],
            user="root",
            workDir="/home/guest",
            timeoutSec=8.0
        )
        assert err.message == ""
        
        test_logger.info(res)
        
        watchdog_result = WatchDogResult.model_validate_json(res.stdout)
        assert watchdog_result.MLE == True
    
    err = container.remove()
    assert err.message == ""


# ネットワーク制限をできているかチェック
def test_NetworkDisable():
    client = docker.client.from_env()
    
    container = ContainerInfo(
        client=client,
        imageName="ibmcom/ping",
        arguments=["sleep", "3600"],
        enableNetwork=None,
    )
    
    err = container.start()
    assert err.message == ""
    
    res, err = container.exec_run(
        command=["ping", "-c", "5", "google.com"],
        user="root",
        workDir="/home/guest",
        timeoutSec=10.0
    )

    test_logger.info(res)
    test_logger.info(err)

    assert err.message == ""

    assert res.exitCode != 0
    assert res.stdout == ""
    
    err = container.remove()
    assert err.message == ""


# フォークボムなどの攻撃に対処できるように、プロセス数制限ができているかチェック
def test_ForkBomb():
    client = docker.from_env()
    container = ContainerInfo(
        client=client,
        imageName="binary-runner",
        arguments=["sleep", "3600"],
        pidsLimit=20,
        user=GUEST_UID,
        groups=[GUEST_GID],
        workDir="/home/guest",
    )
    
    err = container.start()
    assert err.message == ""

    err = container.uploadFile(srcInHost=Path("/app/sources/sources/fork_bomb.sh"), dstInContainer=Path("/home/guest"))

    assert err.message == ""

    res, err = container.exec_run(
        command=["./fork_bomb.sh"],
        user=GUEST_UID,
        workDir="/home/guest",
        timeoutSec=10.0
    )

    test_logger.info(res)
    test_logger.info(err)

    assert err.message != ""
    assert res.exitCode != 0
    
    err = container.remove()
    assert err.message == ""


# スタックメモリの制限ができているかチェック
def test_UseManyStack():
    client = docker.from_env()
    container = ContainerInfo(
        client=client,
        imageName="checker-lang-gcc",
        arguments=["sleep", "3600"],
        workDir="/home/guest",
        memoryLimitMB=256,
    )
    
    err = container.start()
    assert err.message == ""

    err = container.uploadFile(srcInHost=Path("/app/sources/sources/use_many_stack.c"), dstInContainer=Path("/home/guest"))
    assert err.message == ""
    
    res, err = container.exec_run(
        command=["gcc", "use_many_stack.c"],
        user=f"{GUEST_UID}:{GUEST_GID}",
        workDir="/home/guest",
        timeoutSec=10.0,
    )

    test_logger.info(res)
    test_logger.info(err)
    assert err.message == ""
    assert res.exitCode == 0
    
    with TemporaryDirectory() as tmpdir:
        err = container.downloadFile(absPathInContainer=Path("/home/guest/a.out"), dstInHost=Path(tmpdir))
        assert err.message == ""
    
        # コンパイル用コンテナを削除
        err = container.remove()
        assert err.message == ""
    
        # 実行用コンテナを起動
        container = ContainerInfo(
            client=client,
            imageName="binary-runner",
            arguments=["sleep", "3600"],
            workDir="/home/guest",
            memoryLimitMB=256,
            stackLimitKB=10240,
        )
    
        err = container.start()
        assert err.message == ""
        
        # ./a.outをアップロード
        err = container.uploadFile(srcInHost=Path(tmpdir) / "a.out", dstInContainer=Path("/home/guest"))
        assert err.message == ""

        res, err = container.exec_run(
            command=["./a.out"],
            user=f"{GUEST_UID}:{GUEST_GID}",
            workDir="/home/guest",
            timeoutSec=10.0,
        )

        test_logger.info(res)
        test_logger.info(err)

        assert err.message == ""
        assert res.exitCode != 0

        err = container.remove()
        assert err.message == ""


def test_OutputLimitExceed():
    client = docker.client.from_env()
    container = ContainerInfo(
        client=client,
        imageName="binary-runner",
        arguments=["sleep", "3600"],
        interactive=False,
        user=GUEST_UID,
        groups=[GUEST_GID],
        workDir="/home/guest",
        memoryLimitMB=500,
    )
    err = container.start()
    assert err.message == ""
    
    task_info = TaskInfo(
        command="while true; do echo 'Hello, World!'; done",
        stdin="",
        timeoutMS=3000,
        memoryLimitMB=1024,
        uid=int(GUEST_UID),
        gid=int(GUEST_GID),
    )
    
    with TemporaryDirectory() as tmpdir:
        with open(Path(tmpdir) / "task.json", "w") as f:
            f.write(task_info.model_dump_json())
        
        err = container.uploadFile(srcInHost=Path(tmpdir) / "task.json", dstInContainer=Path("/home/guest"))
        assert err.message == ""
        
        res, err = container.exec_run(
            command=["chown", "root:root", "/home/guest/task.json"],
            user="root",
            workDir="/home/guest",
            timeoutSec=2.0
        )
        assert err.message == ""
        
        res, err = container.exec_run(
            command=["chmod", "600", "/home/guest/task.json"],
            user="root",
            workDir="/home/guest",
            timeoutSec=2.0
        )
        assert err.message == ""
        
        res, err = container.exec_run(
            command=["/home/watchdog", "task.json"],
            user="root",
            workDir="/home/guest",
            timeoutSec=8.0
        )
        assert err.message == ""
        
        test_logger.info(res)
        
        watchdog_result = WatchDogResult.model_validate_json(res.stdout)
        assert watchdog_result.OLE == True
    
    err = container.remove()
    assert err.message == ""


# 試しにジャッジリクエストを投じてみて、どのような結果になるか見てみる。
def test_submit_judge():
    with SessionLocal() as db:
        # ユーザーを作成
        if not user_exists(db=db, user_id="test_user"):
            create_user(db=db, user_id="test_user")

        # ジャッジリクエストを登録
        submission = register_judge_request(
            db=db,
            evaluation_status_id=None,
            user_id="test_user",
            lecture_id=1,
            assignment_id=1,
            eval=False,
            upload_dir="sample_submission/ex1-1",
        )

        # ジャッジリクエストをキューに並べる
        enqueue_judge_request(db=db, submission_id=submission.id)
    
    
    while True:
        with SessionLocal() as db:
            # ジャッジが完了するまでsubmissionのステータスを見張る
            submission_record = fetch_submission_record(db=db, submission_id=submission.id)
            test_logger.debug(f"progress: {submission_record.completed_task} / {submission_record.total_task}")
            if submission_record.progress == records.SubmissionProgressStatus.DONE:
                break
        time.sleep(1.0)
    
    # 結果を取得する
    with SessionLocal() as db:
        submission_record = fetch_submission_record(db=db, submission_id=submission.id)
        
    test_logger.info(f"entire summary:")
    test_logger.info(submission_record.model_dump_json(indent=2))
    
    # delete_user(db=db, user_id="test_user")
