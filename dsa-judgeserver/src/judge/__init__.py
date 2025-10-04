from fastapi import FastAPI
from contextlib import asynccontextmanager
import datetime
from concurrent.futures import ThreadPoolExecutor, Future
import asyncio
from .db.crud import *
from .db.models import *
from .db import records
from .db.database import SessionLocal
from .sandbox.my_error import Error
from .judge import JudgeInfo

from .log.config import judge_logger
from .sandbox.execute import define_sandbox_logger
from queue import Queue
from threading import Lock, Thread
import time
import traceback

class JobManager:
    def __init__(self, max_workers=5, queue_size=40):
        self.worker_pool = WorkerPool(max_workers=max_workers)
        self.job_queue = Queue(maxsize=queue_size)
        self._running = True
        
        # Job Queue補充用スレッド
        self.queue_filler_thread = Thread(target=self._fill_job_queue)
        self.queue_filler_thread.daemon = True
        self.queue_filler_thread.start()
        
        # Worker Pool管理用スレッド
        self.worker_manager_thread = Thread(target=self._manage_workers)
        self.worker_manager_thread.daemon = True
        self.worker_manager_thread.start()
    
    def _fill_job_queue(self):
        """
        5秒おきにDBからジョブを取得してキューに追加
        """
        while self._running:
            try:
                # キューの空き容量
                space_available = self.job_queue.maxsize - self.job_queue.qsize()
                if space_available > 0:
                    # DBから見実行のジョブを取得
                    with SessionLocal() as db:
                        submission_list = fetch_queued_judge_and_change_status_to_running(db, space_available)
                    for submission in submission_list:
                        self.job_queue.put(submission)
            except Exception as e:
                judge_logger.error(f"Error filling job queue: {e}")
                judge_logger.error(f"スタックトレース:\n{traceback.format_exc()}")

            time.sleep(5)
    
    def _manage_workers(self):
        """
        完了したジョブの処理と新しいジョブの割り当て
        """
        while self._running:
            try:
                # 完了したジョブの処理
                completed_jobs = self.worker_pool.collect_completed_jobs()
                for job in completed_jobs:
                    judge_logger.info(f"job: \"{job[0]}\", date: {job[1]}, result: {job[2]}")
                
                # 利用可能なワーカーにジョブを割り当て
                while not self.job_queue.empty() and self.worker_pool.available_workers() > 0:
                    submission = self.job_queue.get()
                    self.worker_pool.submit_job(f"submission-{submission.id}", process_one_judge_request, submission)
            except Exception as e:
                judge_logger.error(f"Error managing workers: {e}")
                judge_logger.error(f"スタックトレース:\n{traceback.format_exc()}")

            # 0.1秒待機
            time.sleep(0.1)
    
    def stop(self):
        self._running = False
        self.queue_filler_thread.join()
        self.worker_manager_thread.join()


class WorkerPool:
    max_workers: int
    executor: ThreadPoolExecutor
    active_jobs: dict

    def __init__(self, max_workers: int):
        self.max_workers = max_workers
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.active_jobs = {}

    def available_workers(self) -> int:
        return self.max_workers - len(self.active_jobs)

    def collect_completed_jobs(self) -> list:
        now_completed = [job for job, future in self.active_jobs.items() if future.done()]
        completed_jobrecord = [(job[0], job[1], future.result()) for job, future in self.active_jobs.items() if future.done()]
        for job in now_completed:
            self.active_jobs.pop(job)
        return completed_jobrecord

    def submit_job(self, job: str, func, *args, **kwargs):
        if self.available_workers() > 0:
            future = self.executor.submit(func, *args, **kwargs)
            self.active_jobs[(job, datetime.now())] = future
            return True
        return False

def process_one_judge_request(submission: records.Submission) -> Error:
    judge_logger.debug(f"JudgeInfo(submission_id={submission.id}, lecture_id={submission.lecture_id}, assignment_id={submission.assignment_id}, eval={submission.eval}) will be created...")
    judge_info = JudgeInfo(submission)
    judge_logger.debug("START JUDGE...")
    err = Error.Nothing()
    try:
        err = judge_info.judge()
    except Exception as e:
        judge_logger.error(f"Error judging submission: {e}")
        judge_logger.error(f"スタックトレース:\n{traceback.format_exc()}")
        err.message += str(e)
    judge_logger.debug("END JUDGE")
    
    return err


@asynccontextmanager
async def lifespan(app: FastAPI):
    # sandboxのデバッグ文(どのDockerコマンドを実行しました、etc)を出力するロガーの設定
    define_sandbox_logger(logger=judge_logger)
    define_crud_logger(logger=judge_logger)
    judge_logger.info("LIFESPAN LOGIC INITIALIZED...")
    job_manager = JobManager(max_workers=6, queue_size=20)
    yield
    job_manager.stop()
    judge_logger.info("LIFESPAN LOGIC DEACTIVATED...")
    # 現在実行しているジャッジリクエストを最後まで実行し、保留状態のものは破棄する
    job_manager.worker_pool.executor.shutdown(wait=True, cancel_futures=True)
    completed_jobrecord_list = job_manager.worker_pool.collect_completed_jobs()
    for completed_jobrecord in completed_jobrecord_list:
        judge_logger.info(f"job: \"{completed_jobrecord[0]}\", date: {completed_jobrecord[1]}, result: {completed_jobrecord[2]}")
    # statusをrunningにしてしまっているタスクをqueuedに戻す
    # そして途中結果を削除する
    with SessionLocal() as db:
        undo_running_submissions(db)

app = FastAPI(
    title="DSA Judge Server",
    description="このサーバーはバックグラウンドでジャッジリクエストを処理します。エンドポイントは公開していません。",
    version="0.1.0",
    lifespan=lifespan)
