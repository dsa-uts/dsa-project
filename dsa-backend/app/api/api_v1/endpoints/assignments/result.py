from app.crud.db import assignments, users
from fastapi import APIRouter, Depends, Query, Security, HTTPException, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from app.classes import schemas, response
import logging
from typing import Annotated, List, Literal, Optional
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.api.api_v1.endpoints import authenticate_util
from pathlib import Path
from app import constants as constant
import tempfile
import zipfile


logging.basicConfig(level=logging.DEBUG)

router = APIRouter()

"""
/api/v1/assignments/result/...以下のエンドポイントの定義
"""

def delete_temp_dir(temp_dir: tempfile.TemporaryDirectory):
    temp_dir.cleanup()

@router.get("/submissions/id/{submission_id}", response_model=response.Submission)
async def read_submission_summary(
    submission_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["me"]),
    ],
) -> response.Submission:
    """
    特定の提出のジャッジ結果を取得する
    
    全体の結果だけでなく、個々のテストケースの結果も取得する。
    """
    submission_record = assignments.get_submission(db, submission_id, detail=True)
    if submission_record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="提出エントリが見つかりません",
        )
    
    if current_user.role not in [schemas.Role.admin, schemas.Role.manager]:
        # ユーザがAdmin, Managerでない場合は、ログインユーザのジャッジ結果のみ取得できる
        if submission_record.user_id != current_user.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="ログインユーザのジャッジ結果のみ取得できます",
            )
        
        # バッチ採点に紐づいた提出は取得できない
        if submission_record.evaluation_status_id is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="バッチ採点に紐づいた提出は取得できません",
            )
        
        # 評価問題の提出は取得できない
        if submission_record.eval:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="評価問題の提出は取得できません",
            )
    
    if submission_record.progress != schemas.SubmissionProgressStatus.DONE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ジャッジが完了していません",
        )
    
    res = response.Submission.model_validate(submission_record)

    return res


@router.get("/batch/id/{batch_id}", response_model=response.BatchSubmissionDetailItem)
async def read_batch_submission_summary(
    batch_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["batch"]),
    ],
) -> response.BatchSubmissionDetailItem:
    """
    特定のバッチ採点のジャッジ結果を取得する
    
    詳細は(テストケース毎にかかった時間、メモリ使用量など)取得しない、全体の結果のみ取得される
    BatchSubmission -{ EvaluationStatus -{ Submission の粒度まで取得する
    """
    batch_submission_record = assignments.get_batch_submission_status(db, batch_id)
    if batch_submission_record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="バッチ採点エントリが見つかりません",
        )

    if (batch_submission_record.complete_judge is None 
        or batch_submission_record.total_judge is None) or batch_submission_record.complete_judge != batch_submission_record.total_judge:
        # 完了していない場合は、詳細は取得できない
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="バッチ採点が完了していません",
        )
    
    batch_submission_detail = assignments.get_batch_submission_detail(db, batch_id)
    if batch_submission_detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="バッチ採点エントリが見つかりません",
        )
    
    # 完了していて、かつEvaluationStatusのresultが更新されていない場合は、更新する
    if len(batch_submission_detail.evaluation_statuses) > 0 and batch_submission_detail.evaluation_statuses[0].result is None:
        for evaluation_status in batch_submission_detail.evaluation_statuses:
            # 全Submissionのresultをaggregationする
            submission_results = [
                submission.result for submission in evaluation_status.submissions
            ]
            
            if len(submission_results) == 0:
                # 課題が未提出の場合は、"None"とする
                evaluation_status.result = None
                assignments.update_evaluation_status(db, evaluation_status)
                continue
            
            aggregation_result = schemas.SubmissionSummaryStatus.AC
            for submission_result in submission_results:
                aggregation_result = max(aggregation_result, submission_result)
            
            evaluation_status.result = aggregation_result
            
            assignments.update_evaluation_status(db, evaluation_status)
    users_map = {user.user_id: user.username for user in users.get_users(db=db, user_id=None, roles=None)}
    lecture_map = {
        lecture.id: response.Lecture.model_validate(lecture)
        for lecture in assignments.get_lecture_list(db=db)
    }
    detail_item_data = response.BatchSubmissionDetailItem(
        id=batch_submission_detail.id,
        ts=batch_submission_detail.ts,
        user_id=batch_submission_detail.user_id,
        username=users_map.get(batch_submission_detail.user_id),
        lecture_id=batch_submission_detail.lecture_id,
        lecture=lecture_map.get(batch_submission_detail.lecture_id),
        message=batch_submission_detail.message,
        complete_judge=batch_submission_detail.complete_judge,
        total_judge=batch_submission_detail.total_judge,
        evaluation_statuses=[
            response.EvaluationStatus(
                id=es.id,
                batch_id=es.batch_id,
                user_id=es.user_id,
                username=users_map.get(es.user_id),
                lecture_id=batch_submission_detail.lecture_id,
                lecture=lecture_map.get(batch_submission_detail.lecture_id),
                status=es.status,
                result=es.result,
                upload_file_exists=es.upload_dir is not None,
                report_exists=es.report_path is not None,
                submit_date=es.submit_date,
                submissions=es.submissions
            )
            for es in batch_submission_detail.evaluation_statuses
        ]
    )
    
    detail_item = response.BatchSubmissionDetailItem.model_validate(detail_item_data)

    return detail_item


@router.get("/batch/id/{batch_id}/user/{user_id}", response_model=response.EvaluationStatus)
async def read_evaluation_status_for_batch_user(
    batch_id: int,
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["batch"]),
    ],
) -> response.EvaluationStatus:
    """
    特定のバッチ採点の特定のユーザの採点結果を取得する
    
    EvaluationStatus -{ Submission -{ JudgeResultの粒度まで取得する
    """
    evaluation_status = assignments.get_evaluation_status(db, batch_id, user_id)
    if evaluation_status is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="バッチ採点エントリが見つかりません",
        )
    
    evaluation_status_detail = assignments.get_evaluation_status_detail(db, batch_id, user_id)
    
    # ユーザー名を取得
    user = users.get_user(db, user_id)
    username = user.username if user else "不明"
    
    # バッチ提出から講義情報を取得
    batch_submission = assignments.get_batch_submission_status(db, batch_id)
    lecture_id = batch_submission.lecture_id if batch_submission else None
    lecture = assignments.get_lecture(db, lecture_id) if lecture_id else None
    
    # dictとして必要な情報を追加
    evaluation_status_dict = {
        **evaluation_status_detail.dict(),
        "username": username,
        "lecture_id": lecture_id,
        "lecture": lecture
    }
    
    ret = response.EvaluationStatus.model_validate(evaluation_status_dict)
    ret.upload_file_exists = evaluation_status_detail.upload_dir is not None
    ret.report_exists = evaluation_status_detail.report_path is not None

    return ret


@router.get("/batch/{batch_id}/files/uploaded/{user_id}", response_class=FileResponse)
async def fetch_uploaded_files_of_evaluation_status(
    batch_id: int,
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["batch"]),
    ],
) -> FileResponse:
    """
    特定のバッチ採点のアップロードされたファイルを取得する
    """
    if current_user.role not in [schemas.Role.admin, schemas.Role.manager]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="バッチ採点のアップロードされたファイルは取得できません",
        )
    
    # BatchSubmissionSummaryのupload_dirを取得する
    batch_submission_summary = assignments.get_evaluation_status(db, batch_id, user_id)
    if batch_submission_summary is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="バッチ採点エントリのアップロードされたファイルが見つかりません",
        )
    
    upload_dir = batch_submission_summary.upload_dir
    
    if upload_dir is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="バッチ採点エントリのアップロードされたファイルが見つかりません",
        )
        
    upload_dir_path = Path(constant.UPLOAD_DIR) / upload_dir
    
    temp_dir = tempfile.TemporaryDirectory()
    temp_dir_path = Path(temp_dir.name)
    
    # upload_dirのファイルの内容をtemp_dirに置いたZIPファイルに書き込む
    zip_file_path = temp_dir_path / f"uploaded_files.zip"
    with zipfile.ZipFile(zip_file_path, "w") as zipf:
        for file_path in upload_dir_path.rglob("*"):
            if file_path.is_file():
                arcname = file_path.relative_to(upload_dir_path)
                zipf.write(file_path, arcname=arcname)
    
    return FileResponse(zip_file_path, filename="uploaded_files.zip", media_type="application/zip", background=BackgroundTask(delete_temp_dir, temp_dir))


@router.get("/batch/{batch_id}/files/report/{user_id}", response_class=FileResponse)
async def fetch_report_of_evaluation_status(
    batch_id: int,
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["batch"]),
    ],
) -> FileResponse:
    """
    特定のバッチ採点のレポートを取得する
    """
    if current_user.role not in [schemas.Role.admin, schemas.Role.manager]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="バッチ採点のレポートは取得できません",
        )
    
    batch_submission_summary = assignments.get_evaluation_status(db, batch_id, user_id)
    if batch_submission_summary is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="バッチ採点エントリのレポートが見つかりません",
        )
    
    report_path = batch_submission_summary.report_path
    
    if report_path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="バッチ採点エントリのレポートが見つかりません",
        )
    
    report_path = Path(constant.UPLOAD_DIR) / report_path
    
    if not report_path.exists() or not report_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="バッチ採点エントリのレポートが見つかりません",
        )

    return FileResponse(report_path, filename=report_path.name, media_type="application/pdf")
