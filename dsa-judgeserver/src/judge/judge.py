from pathlib import Path
from .sandbox.execute import ContainerInfo, DockerVolume, VolumeMountInfo, TaskInfo, WatchDogResult
from .sandbox.my_error import Error
from dotenv import load_dotenv
from .db import records, crud
from .db.database import SessionLocal
from .checker import StandardChecker
from pydantic import BaseModel, ValidationError
import tempfile
import os
import docker

# ロガーの設定
from .log.config import judge_logger

load_dotenv()

RESOURCE_DIR = Path(os.getenv("RESOURCE_PATH"))
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR_PATH"))
GUEST_UID = os.getenv("GUEST_UID")
GUEST_GID = os.getenv("GUEST_GID")
CGROUP_PARENT = os.getenv("CGROUP_PARENT")
OUTPUT_LIMIT_STDOUT_BYTES = int(os.getenv("OUTPUT_LIMIT_STDOUT_BYTES"))
OUTPUT_LIMIT_STDERR_BYTES = int(os.getenv("OUTPUT_LIMIT_STDERR_BYTES"))

class JudgeInfo:
    submission_record: records.Submission # Submissionテーブル内のジャッジリクエストレコード

    problem_record: records.Problem # Problemテーブル内のテーブルレコード
    
    client: docker.DockerClient

    def __init__(
        self,
        submission: records.Submission
    ):
        self.submission_record = submission

        with SessionLocal() as db:
            problem_record = crud.fetch_problem(
                db=db,
                lecture_id=self.submission_record.lecture_id,
                assignment_id=self.submission_record.assignment_id,
                eval=self.submission_record.eval
            )

            if problem_record is None:
                # Submissionテーブルのstatusをdoneに変更
                self.submission_record.progress = records.SubmissionProgressStatus.DONE
                message = f"Error on Problem {self.submission_record.lecture_id}-{self.submission_record.assignment_id}: Not found"
                detail = ""

                self.submission_record.result = records.SubmissionSummaryStatus.IE
                self.submission_record.message = message
                self.submission_record.detail = detail
                self.submission_record.score = 0
                self.submission_record.timeMS = 0
                self.submission_record.memoryKB = 0

                crud.update_submission_record(db=db, submission_record=self.submission_record)
                raise ValueError(message)
            else:
                self.problem_record = problem_record

            judge_logger.debug(f"JudgeInfo.__init__: problem_record: {self.problem_record}")
        
        self.client = docker.from_env()


    def _update_progress_of_submission(self) -> None:
        with SessionLocal() as db:
            crud.update_submission_status_and_progress(db=db, submission_record=self.submission_record)

    def _exec_built_task(
        self,
        container: ContainerInfo,
        testcase_list: list[records.TestCases],
    ) -> list[records.JudgeResult]:
        judge_result_list: list[records.JudgeResult] = []
        for testcase in testcase_list:
            # 実行コマンド + 引数
            args = testcase.command
            
            # 引数を追加
            if testcase.args is not None:
                args += ' '
                args += ' '.join(testcase.args.strip().split())

            stdin = ""
            if testcase.stdin_path is not None:
                with open(RESOURCE_DIR / Path(testcase.stdin_path), mode='r', encoding='utf-8') as f:
                    stdin = f.read()
            
            task_info = TaskInfo(
                command=args,
                stdin=stdin,
                timeoutMS=2000,
                memoryLimitMB=512,
                uid=int(GUEST_UID),
                gid=int(GUEST_GID)
            )
            
            judge_result = records.JudgeResult(
                submission_id=self.submission_record.id,
                testcase_id=testcase.id,
                result=records.SingleJudgeStatus.AC,
                command=args,
                timeMS=0,
                memoryKB=0,
                exit_code=0,
                stdout="",
                stderr=""
            )
            
            # TaskInfoの内容をJSONにして/home/guest/task.jsonに書き込む
            # uid:gid=root:root, パーミッションは600
            task_info_json = task_info.model_dump_json(indent=4)
            with tempfile.TemporaryDirectory() as temp_dir:
                with open(Path(temp_dir) / "task.json", mode='w', encoding='utf-8') as f:
                    f.write(task_info_json)
                
                # コンテナ内にコピー
                err = container.uploadFile(srcInHost=Path(temp_dir) / "task.json", dstInContainer=Path("/home/guest"))
                if not err.silence():
                    self.submission_record.progress = records.SubmissionProgressStatus.DONE
                    self.submission_record.result = records.SubmissionSummaryStatus.IE
                    self.submission_record.message = f"Failed to send task information to sandbox. Please reupload or tell the administrator."
                    self.submission_record.timeMS = 0
                    self.submission_record.memoryKB = 0
                    with SessionLocal() as db:
                        crud.update_submission_record(db=db, submission_record=self.submission_record)
                    raise ValueError(f"Failed to copy task.json to container: {err.message}")
                    continue
                
                # uid:gid=root:root
                res, err = container.exec_run(
                    command=["chown", "root:root", "/home/guest/task.json"],
                    user="root",
                    workDir="/home/guest",
                    timeoutSec=2
                )
                if not err.silence() or res.exitCode != 0:
                    self.submission_record.progress = records.SubmissionProgressStatus.DONE
                    self.submission_record.result = records.SubmissionSummaryStatus.IE
                    self.submission_record.message = f"Failed to setup sandbox(1), Please reupload or tell the administrator. (exit code: {res.exitCode})"
                    self.submission_record.score = 0
                    self.submission_record.timeMS = 0
                    self.submission_record.memoryKB = 0
                    with SessionLocal() as db:
                        crud.update_submission_record(db=db, submission_record=self.submission_record)
                    raise ValueError(f"Failed to chown task.json: {err.message} (exit code: {res.exitCode})")

                # パーミッションを600にする
                res, err = container.exec_run(
                    command=["chmod", "600", "/home/guest/task.json"],
                    user="root",
                    workDir="/home/guest",
                    timeoutSec=2
                )
                if not err.silence() or res.exitCode != 0:
                    self.submission_record.progress = records.SubmissionProgressStatus.DONE
                    self.submission_record.result = records.SubmissionSummaryStatus.IE
                    self.submission_record.message = f"Failed to setup sandbox(2), Please reupload or tell the administrator. (exit code: {res.exitCode})"
                    self.submission_record.score = 0
                    self.submission_record.timeMS = 0
                    self.submission_record.memoryKB = 0
                    with SessionLocal() as db:
                        crud.update_submission_record(db=db, submission_record=self.submission_record)
                    raise ValueError(f"Failed to chmod task.json: {err.message} (exit code: {res.exitCode})")

            # watchdogによる実行
            result, err = container.exec_run(
                command=["/home/watchdog", "task.json"],
                user="root",
                workDir="/home/guest",
                timeoutSec=8
            )

            if not err.silence():
                # 内部エラーにより失敗
                judge_result.result = records.SingleJudgeStatus.IE
                judge_result.stderr = f"exec_run error: {err.message}"
                judge_result_list.append(judge_result)
                # 内部エラーの場合は即座に終了する
                return judge_result_list

            if result.exitCode != 0:
                judge_result.result = records.SingleJudgeStatus.IE
                judge_result.exit_code = result.exitCode
                judge_result.stderr = f"watchdog error: {result.stderr}"
                judge_result_list.append(judge_result)
                # 内部エラーの場合は即座に終了する
                return judge_result_list
            
            # watchdogが正常に終了すれば、result.stdoutは以下のようなJSON文字列になる
            # {
            #     "exit_code": 0,
            #     "stdout": "...",
            #     "stderr": "...",
            #     "timeMS": 123,
            #     "memoryKB": 456,
            #     "TLE": false,
            #     "MLE": false
            # }
            
            try:
                watchdog_result = WatchDogResult.model_validate_json(result.stdout)
                
                judge_result.exit_code = watchdog_result.exit_code
                judge_result.stdout = watchdog_result.stdout
                judge_result.stderr = watchdog_result.stderr
                judge_result.timeMS = watchdog_result.timeMS
                judge_result.memoryKB = watchdog_result.memoryKB
                if watchdog_result.TLE:
                    judge_result.result = records.SingleJudgeStatus.TLE
                if watchdog_result.MLE:
                    judge_result.result = records.SingleJudgeStatus.MLE

            except ValidationError as e:
                judge_result.result = records.SingleJudgeStatus.IE
                judge_result.stderr = f"validation error: {e}\nwatchdog error: {result.stderr}"
                judge_result_list.append(judge_result)
                # 内部エラーの場合は即座に終了する
                return judge_result_list

            # 進捗状況を更新
            self.submission_record.completed_task += 1
            self._update_progress_of_submission()

            # NOTE: ビルドの際は、標準出力、標準エラー出力の確認はせず、戻り値のみの確認とする。
            # それは、Makefileによるビルドログの出力まで一致確認するのは厳格すぎるから。
            
            stdout_byte_size = len(judge_result.stdout.encode('utf-8'))
            stderr_byte_size = len(judge_result.stderr.encode('utf-8'))

            if stdout_byte_size > OUTPUT_LIMIT_STDOUT_BYTES or stderr_byte_size > OUTPUT_LIMIT_STDERR_BYTES:
                judge_result.result = records.SingleJudgeStatus.OLE
                if stdout_byte_size > OUTPUT_LIMIT_STDOUT_BYTES:
                    too_long_warning = f"stdout is too long: capacity ({OUTPUT_LIMIT_STDOUT_BYTES} bytes) exceeded"
                    judge_result.stderr = judge_result.stderr[:OUTPUT_LIMIT_STDERR_BYTES - len(too_long_warning)] + too_long_warning
                if stderr_byte_size > OUTPUT_LIMIT_STDERR_BYTES:
                    too_long_warning = f"stderr is too long: capacity ({OUTPUT_LIMIT_STDERR_BYTES} bytes) exceeded"
                    judge_result.stderr = judge_result.stderr[:OUTPUT_LIMIT_STDERR_BYTES - len(too_long_warning)] + too_long_warning
            # コンパイルエラーかチェック
            if watchdog_result.exit_code != testcase.exit_code:
                judge_result.result = records.SingleJudgeStatus.CE

            # TestCaseで設定されていたコンパイルジョブが正常に実行完了した
            # judge_result_listに追加
            judge_result_list.append(judge_result)

        # 全部のビルドが終了した
        return judge_result_list

    def _exec_judge_task(
        self,
        container: ContainerInfo,
        testcase_list: list[records.TestCases]
    ) -> list[records.JudgeResult]:
        judge_result_list: list[records.JudgeResult] = []
        for testcase in testcase_list:
            # 実行コマンド + 引数
            args = testcase.command

            if testcase.args is not None:
                args += ' '
                args += ' '.join(testcase.args.strip().split())

            # 標準入力、想定される標準出力・標準エラー出力の取得
            stdin = ""
            expected_stdout = None
            expected_stderr = None
            expected_terminate_normally = True if testcase.exit_code == 0 else False

            if testcase.stdin_path is not None:
                with open(RESOURCE_DIR / Path(testcase.stdin_path), mode='r', encoding='utf-8') as f:
                    stdin = f.read()

            if testcase.stdout_path is not None:
                with open(RESOURCE_DIR / Path(testcase.stdout_path), mode='r', encoding='utf-8') as f:
                    expected_stdout = f.read()

            if testcase.stderr_path is not None:
                with open(RESOURCE_DIR / Path(testcase.stderr_path), mode='r', encoding='utf-8') as f:
                    expected_stderr = f.read()

            task_info = TaskInfo(
                command=args,
                stdin=stdin,
                timeoutMS=self.problem_record.timeMS,
                memoryLimitMB=self.problem_record.memoryMB,
                uid=int(GUEST_UID),
                gid=int(GUEST_GID)
            )
            
            # TaskInfoの内容をJSONにして/home/guest/task.jsonに書き込む
            # uid:gid=root:root, パーミッションは600
            task_info_json = task_info.model_dump_json(indent=4)
            with tempfile.TemporaryDirectory() as temp_dir:
                with open(Path(temp_dir) / "task.json", mode='w', encoding='utf-8') as f:
                    f.write(task_info_json)
                
                # コンテナ内にコピー
                err = container.uploadFile(srcInHost=Path(temp_dir) / "task.json", dstInContainer=Path("/home/guest"))
                if not err.silence():
                    self.submission_record.progress = records.SubmissionProgressStatus.DONE
                    self.submission_record.result = records.SubmissionSummaryStatus.IE
                    self.submission_record.message = f"Failed to send task information to sandbox. Please reupload or tell the administrator."
                    self.submission_record.score = 0
                    self.submission_record.timeMS = 0
                    self.submission_record.memoryKB = 0
                    with SessionLocal() as db:
                        crud.update_submission_record(db=db, submission_record=self.submission_record)
                    raise ValueError(f"Failed to copy task.json to container: {err.message}")
                    continue
                
                # uid:gid=root:root
                res, err = container.exec_run(
                    command=["chown", "root:root", "/home/guest/task.json"],
                    user="root",
                    workDir="/home/guest",
                    timeoutSec=2
                )
                if not err.silence() or res.exitCode != 0:
                    self.submission_record.progress = records.SubmissionProgressStatus.DONE
                    self.submission_record.result = records.SubmissionSummaryStatus.IE
                    self.submission_record.message = f"Failed to setup sandbox(1), Please reupload or tell the administrator. (exit code: {res.exitCode})"
                    self.submission_record.score = 0
                    self.submission_record.timeMS = 0
                    self.submission_record.memoryKB = 0
                    with SessionLocal() as db:
                        crud.update_submission_record(db=db, submission_record=self.submission_record)
                    raise ValueError(f"Failed to chown task.json: {err.message} (exit code: {res.exitCode})")

                # パーミッションを600にする
                res, err = container.exec_run(
                    command=["chmod", "600", "/home/guest/task.json"],
                    user="root",
                    workDir="/home/guest",
                    timeoutSec=2
                )
                if not err.silence() or res.exitCode != 0:
                    self.submission_record.progress = records.SubmissionProgressStatus.DONE
                    self.submission_record.result = records.SubmissionSummaryStatus.IE
                    self.submission_record.message = f"Failed to setup sandbox(2), Please reupload or tell the administrator. (exit code: {res.exitCode})"
                    self.submission_record.score = 0
                    self.submission_record.timeMS = 0
                    self.submission_record.memoryKB = 0
                    with SessionLocal() as db:
                        crud.update_submission_record(db=db, submission_record=self.submission_record)
                    raise ValueError(f"Failed to chmod task.json: {err.message} (exit code: {res.exitCode})")

            # watchdogによる実行
            result, err = container.exec_run(
                command=["/home/watchdog", "task.json"],
                user="root",
                workDir="/home/guest",
                timeoutSec=8
            )
            
            judge_result = records.JudgeResult(
                submission_id=self.submission_record.id,
                testcase_id=testcase.id,
                result=records.SingleJudgeStatus.AC,
                command=args,
                timeMS=0,
                memoryKB=0,
                exit_code=0,
                stdout="",
                stderr=""
            )
            
            if not err.silence():
                judge_result.result = records.SingleJudgeStatus.IE
                judge_result.stderr = f"exec_run error: {err.message}"
                judge_result_list.append(judge_result)
                # 内部エラーの場合は即座に終了する
                return judge_result_list
            
            if result.exitCode != 0:
                judge_result.result = records.SingleJudgeStatus.IE
                judge_result.exit_code = result.exitCode
                judge_result.stderr = f"watchdog error: {result.stderr}"
                judge_result_list.append(judge_result)
                # 内部エラーの場合は即座に終了する
                return judge_result_list
            
            try:
                watchdog_result = WatchDogResult.model_validate_json(result.stdout)
                
                judge_result.exit_code = watchdog_result.exit_code
                judge_result.stdout = watchdog_result.stdout
                judge_result.stderr = watchdog_result.stderr
                judge_result.timeMS = watchdog_result.timeMS
                judge_result.memoryKB = watchdog_result.memoryKB
                if watchdog_result.TLE:
                    judge_result.result = records.SingleJudgeStatus.TLE
                if watchdog_result.MLE:
                    judge_result.result = records.SingleJudgeStatus.MLE
            except ValidationError as e:
                judge_result.result = records.SingleJudgeStatus.IE
                judge_result.stderr = f"validation error: {e}\nwatchdog error: {result.stderr}"
                judge_result_list.append(judge_result)
                # 内部エラーの場合は即座に終了する
                return judge_result_list

            # 進捗状況を更新
            self.submission_record.completed_task += 1
            self._update_progress_of_submission()

            stdout_byte_size = len(judge_result.stdout.encode('utf-8'))
            stderr_byte_size = len(judge_result.stderr.encode('utf-8'))
            
            # 出力オーバーフローチェック
            if stdout_byte_size > OUTPUT_LIMIT_STDOUT_BYTES or stderr_byte_size > OUTPUT_LIMIT_STDERR_BYTES:
                judge_result.result = records.SingleJudgeStatus.OLE
                if stdout_byte_size > OUTPUT_LIMIT_STDOUT_BYTES:
                    too_long_warning = f"stdout is too long: capacity ({OUTPUT_LIMIT_STDOUT_BYTES} bytes) exceeded"
                    judge_result.stderr = judge_result.stderr[:OUTPUT_LIMIT_STDERR_BYTES - len(too_long_warning)] + too_long_warning
                if stderr_byte_size > OUTPUT_LIMIT_STDERR_BYTES:
                    too_long_warning = f"stderr is too long: capacity ({OUTPUT_LIMIT_STDERR_BYTES} bytes) exceeded"
                    judge_result.stderr = judge_result.stderr[:OUTPUT_LIMIT_STDERR_BYTES - len(too_long_warning)] + too_long_warning

            # TLEチェック
            if watchdog_result.TLE:
                judge_result.result = records.SingleJudgeStatus.TLE
            # MLEチェック
            elif watchdog_result.MLE:
                judge_result.result = records.SingleJudgeStatus.MLE
            # OLEチェック
            elif watchdog_result.OLE:
                judge_result.result = records.SingleJudgeStatus.OLE
            # RE(Runtime Errorチェック)
            elif expected_terminate_normally and judge_result.exit_code != 0:
                # テストケースは正常終了を想定しているが、実行結果は異常終了した場合
                judge_result.result = records.SingleJudgeStatus.RE
            # Wrong Answerチェック
            elif (
                expected_stdout is not None
                and not StandardChecker.match(expected_stdout, judge_result.stdout)
            ) or (
                expected_stderr is not None
                and not StandardChecker.match(expected_stderr, judge_result.stderr)
            ):
                judge_result.result = records.SingleJudgeStatus.WA
            elif not expected_terminate_normally and judge_result.exit_code == 0:
                # テストケースは異常終了を想定しているが、実行結果は正常終了した場合
                # そのプログラムは異常検知できていないため、WAとする。
                judge_result.result = records.SingleJudgeStatus.WA
            else:
                # AC(正解)
                judge_result.result= records.SingleJudgeStatus.AC

            # TestCaseで設定されていたジョブが正常に実行完了した
            # judge_result_listに追加
            judge_result_list.append(judge_result)

        return judge_result_list

    def _closing_procedure(self, submission_record: records.Submission, container: ContainerInfo | None, working_volume: DockerVolume | None) -> Error:
        # SubmissionSummaryレコードを登録し、submission.progress = 'Done'にする。
        with SessionLocal() as db:
            submission_record.progress = records.SubmissionProgressStatus.DONE
            crud.update_submission_record(
                db=db,
                submission_record=submission_record
            )
        if container is not None:
            # コンテナの削除
            err = container.remove()
            if not err.silence():
                judge_logger.error(f"failed to remove container: {container._container.id}")
                return err
        
        if working_volume is not None:
            # ボリュームの削除
            err = working_volume.remove()
            if not err.silence():
                judge_logger.error(f"failed to remove volume: {working_volume.name}")
                return err

        return Error.Nothing()

    def judge(self) -> Error:
        # testcase_id(key) -> TestCaseのdict
        testcase_dict: dict[int, records.TestCases] = {}
        for testcase in self.problem_record.test_cases:
            testcase_dict[testcase.id] = testcase

        # 仮の値を設定
        self.submission_record.result = records.SubmissionSummaryStatus.AC
        self.submission_record.message = ""
        self.submission_record.detail = ""
        self.submission_record.score = 0
        self.submission_record.timeMS = 0
        self.submission_record.memoryKB = 0

        # 1. 準備
        # ボリューム作成
        working_volume, err = DockerVolume.create(client=self.client)
        if not err.silence():
            self.submission_record.result = records.SubmissionSummaryStatus.IE
            self.submission_record.message = "error when creating volume"
            self.submission_record.detail = err.message
            return self._closing_procedure(
                submission_record=self.submission_record,
                container=None,
                working_volume=None
            )
        
        # コンパイル用のコンテナを立ち上げる
        build_container_info = ContainerInfo(
            client=self.client,
            imageName="checker-lang-gcc",
            arguments=["sleep", "3600"], # 最大1時間起動
            interactive=False,
            user="root",
            groups=["root"],
            memoryLimitMB=1024,
            pidsLimit=100,
            workDir="/home/guest",
            volumeMountInfoList=[
                VolumeMountInfo(path="/home/guest", volume=working_volume, read_only=False)
            ]
        )

        # コンテナを起動する
        err = build_container_info.start()
        if not err.silence():
            self.submission_record.result = records.SubmissionSummaryStatus.IE
            self.submission_record.message = "error when starting build container"
            self.submission_record.detail = err.message
            return self._closing_procedure(
                submission_record=self.submission_record,
                container=None,
                working_volume=working_volume
            )
        
        # コンテナにジャッジリクエストでアップロードされたファイルをコピーする
        abs_upload_dir = Path(UPLOAD_DIR) / str(self.submission_record.upload_dir)
        err = build_container_info.uploadTree(srcRootInHost=abs_upload_dir, dstRootInContainer="/home/guest/", uid=int(GUEST_UID), gid=int(GUEST_GID))
        if not err.silence():
            self.submission_record.result = records.SubmissionSummaryStatus.IE
            self.submission_record.message = "error when copying files to build container"
            self.submission_record.detail = err.message
            return self._closing_procedure(
                submission_record=self.submission_record,
                container=build_container_info,
                working_volume=working_volume
            )
        
        abs_arranged_filepaths = [RESOURCE_DIR / file.path for file in self.problem_record.arranged_files]
        
        for filepath in abs_arranged_filepaths:
            err = build_container_info.uploadFile(srcInHost=filepath, dstInContainer="/home/guest/", uid=int(GUEST_UID), gid=int(GUEST_GID))
            if not err.silence():
                self.submission_record.result = records.SubmissionSummaryStatus.IE
                self.submission_record.message = "error when copying files to build container"
                self.submission_record.detail = err.message
                return self._closing_procedure(
                    submission_record=self.submission_record,
                    container=build_container_info,
                    working_volume=working_volume
                )

        judge_result_list = []

        # 2. Builtテストケース(コンパイル)を実行する
        try:
            built_task_list = [task for task in self.problem_record.test_cases if task.type == records.EvaluationType.Built]
            build_exec_result_list = self._exec_built_task(
                container=build_container_info,
                testcase_list=built_task_list,
            )
            judge_result_list += build_exec_result_list
            
            # ジャッジ結果の集約
            for exec_result in build_exec_result_list:
                self.submission_record.timeMS = max(self.submission_record.timeMS, exec_result.timeMS)
                self.submission_record.memoryKB = max(self.submission_record.memoryKB, exec_result.memoryKB)
                self.submission_record.score += testcase_dict[exec_result.testcase_id].score if exec_result.result == records.SingleJudgeStatus.AC else 0
                self.submission_record.result = max(self.submission_record.result, records.SubmissionSummaryStatus[exec_result.result.value])
            
                if exec_result.result != records.SingleJudgeStatus.AC:
                    corresponding_testcase = testcase_dict[exec_result.testcase_id]
                    self.submission_record.detail += f"{corresponding_testcase.message_on_fail}: {exec_result.result.value} (-{corresponding_testcase.score})\n"
        except Exception as e:
            # ジャッジ処理の際に、内部エラーが発生した場合
            # コンテナの削除
            error_message = f"error when executing built test cases: {e}"
            err = build_container_info.remove()
            if not err.silence():
                error_message += f"\nfailed to remove build container: {err.message}"
            # ボリュームの削除
            err = working_volume.remove()
            if not err.silence():
                error_message += f"\nfailed to remove volume: {err.message}"
            raise ValueError(error_message)
                
        # NOTE: ビルドに失敗した場合は、後続のジャッジを行わない方針であったが、
        #       ビルドに失敗した場合でもジャッジを行うようにした。
        # if self.submission_record.result != records.SubmissionSummaryStatus.AC:
        #     self.submission_record.message += "ビルドに失敗しました\n"
        #     self.submission_record.judge_results = judge_result_list
        #     return self._closing_procedure(
        #         submission_record=self.submission_record,
        #         container=build_container_info,
        #         working_volume=working_volume
        #     )
        
        # ビルドコンテナを削除
        err = build_container_info.remove()
        if not err.silence():
            judge_logger.error(f"failed to remove build container: {build_container_info._container.id}")
            return self._closing_procedure(
                submission_record=self.submission_record,
                container=None,
                working_volume=working_volume
            )
        
        # 実行用のコンテナを立ち上げる
        sandbox_container_info = ContainerInfo(
            client=self.client,
            imageName="binary-runner",
            arguments=["sleep", "3600"], # 最大1時間起動
            interactive=False,
            user="root",
            groups=["root"],
            # メモリーリミットに512MBの余裕を持たせて、watchdogがメモリーリミット超過を検知し、
            # ユーザープログラムをkillできるようにする。
            memoryLimitMB=self.problem_record.memoryMB + 512,
            pidsLimit=100,
            workDir="/home/guest",
            volumeMountInfoList=[
                VolumeMountInfo(path="/home/guest", volume=working_volume, read_only=False)
            ]
        )
        
        # コンテナを起動する
        err = sandbox_container_info.start()
        if not err.silence():
            judge_logger.error(f"failed to start sandbox container: {sandbox_container_info._container.id}")
            self.submission_record.result = records.SubmissionSummaryStatus.IE
            self.submission_record.message += "error when starting sandbox container\n"
            self.submission_record.detail += f"{err.message}\n"
            self.submission_record.judge_results = judge_result_list
            return self._closing_procedure(
                submission_record=self.submission_record,
                container=None,
                working_volume=working_volume
            )

        try:
            # Judgeテストケース(実行・チェック)を実行する
            judge_task_list = [task for task in self.problem_record.test_cases if task.type == records.EvaluationType.Judge]
            judge_exec_result_list = self._exec_judge_task(
                container=sandbox_container_info,
                testcase_list=judge_task_list
            )
            judge_result_list += judge_exec_result_list

            for exec_result in judge_exec_result_list:
                self.submission_record.timeMS = max(self.submission_record.timeMS, exec_result.timeMS)
                self.submission_record.memoryKB = max(self.submission_record.memoryKB, exec_result.memoryKB)
                self.submission_record.score += testcase_dict[exec_result.testcase_id].score if exec_result.result == records.SingleJudgeStatus.AC else 0
                self.submission_record.result = max(self.submission_record.result, records.SubmissionSummaryStatus[exec_result.result.value])
                
            if exec_result.result != records.SingleJudgeStatus.AC:
                corresponding_testcase = testcase_dict[exec_result.testcase_id]
                self.submission_record.detail += f"{corresponding_testcase.message_on_fail}: {exec_result.result.value} (-{corresponding_testcase.score})\n"
        except Exception as e:
            # ジャッジ処理の際に、内部エラーが発生した場合
            # コンテナの削除
            error_message = f"error when executing judge test cases: {e}"
            err = sandbox_container_info.remove()
            if not err.silence():
                error_message += f"\nfailed to remove sandbox container: {err.message}"
            # ボリュームの削除
            err = working_volume.remove()
            if not err.silence():
                error_message += f"\nfailed to remove volume: {err.message}"
            raise ValueError(error_message)

        self.submission_record.judge_results = judge_result_list

        # 全体の結果を登録
        return self._closing_procedure(
            submission_record=self.submission_record,
            container=sandbox_container_info,
            working_volume=working_volume
        )
