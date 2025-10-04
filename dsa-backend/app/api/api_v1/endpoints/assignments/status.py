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
/api/v1/assignments/status/...以下のエンドポイントの定義
"""

def delete_temp_dir(temp_dir: tempfile.TemporaryDirectory):
    temp_dir.cleanup()

@router.get("/submissions/view", response_model=List[response.Submission])
async def read_all_submission_status_of_me(
    page: int,
    all: Annotated[bool, Query(description="全てのユーザの提出を含めるかどうか")],
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["me"]),
    ],
    user: Optional[str] = Query(default=None, description="user_idまたはusernameの部分一致検索"),
    ts_order: Literal["asc", "desc"] = Query(default="desc", description="提出のtsのソート順"),
    lecture_id: Optional[int] = Query(default=None, description="講義IDを指定して取得する"),
    assignment_id: Optional[int] = Query(default=None, description="課題IDを指定して取得する"),
    result: Optional[Literal["AC", "WA", "TLE", "MLE", "RE", "CE", "OLE", "IE", "FN", "WJ"]] = Query(default=None, description="提出結果の条件, WJは未評価の提出を表す"),
) -> List[response.Submission]:
    """
    自身に紐づいた提出の進捗状況を取得する
    """
    include_eval = False
    include_private_problem = False
    if current_user.role in [schemas.Role.admin, schemas.Role.manager]:
        include_eval = True
        include_private_problem = True
    
    if page < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ページは1以上である必要があります",
        )

    if current_user.role not in [
        schemas.Role.admin,
        schemas.Role.manager,
    ]:
        if all:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="管理者のみが全てのユーザの提出の進捗状況を取得できます",
            )

    submission_record_list = assignments.get_submission_list(
        db=db,
        limit=10,
        offset=(page - 1) * 10,
        self_user_id=None if all else current_user.user_id,
        lecture_id=lecture_id,
        assignment_id=assignment_id,
        ts_order=ts_order,
        include_eval=include_eval,
        include_private_problem=include_private_problem,
        all_users=all,
        user=user,
        result=result,
    )

    return [
        response.Submission.model_validate(
            submission_record.model_dump(
                exclude={"problem", "judge_results"}
            )
        )
        for submission_record in submission_record_list
    ]


@router.get("/submissions/id/{submission_id}", response_model=response.Submission)
async def read_submission_status(
    submission_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["me"]),
    ],
) -> response.Submission:
    """
    特定の提出の進捗状況を取得する
    """
    submission_record = assignments.get_submission(db, submission_id)
    if submission_record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="提出エントリが見つかりません",
        )

    if current_user.role not in [schemas.Role.admin, schemas.Role.manager]:
        # ユーザがAdmin, Managerでない場合は、ログインユーザの提出のみ取得できる
        if submission_record.user_id != current_user.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="ログインユーザの提出ではありません",
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

    return response.Submission.model_validate(submission_record)


@router.get("/submissions/id/{submission_id}/files/zip", response_class=FileResponse)
async def read_uploaded_file_list(
    submission_id: int,
    type: Literal["uploaded", "arranged"],
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["me"]),
    ],
) -> FileResponse:
    """
    特定の提出のファイルのアップロードされたファイルをZIPファイルとして取得する
    """
    submission_record = assignments.get_submission(db, submission_id)
    if submission_record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="提出エントリが見つかりません",
        )
    
    if current_user.role not in [schemas.Role.admin, schemas.Role.manager]:
        # ユーザがAdmin, Managerでない場合は、ログインユーザの提出のみ取得できる
        if submission_record.user_id != current_user.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="ログインユーザの提出ではありません",
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

    if type == "uploaded":
        temp_dir = tempfile.TemporaryDirectory()
        temp_dir_path = Path(temp_dir.name)
        zip_file_path = temp_dir_path / "uploaded_files.zip"
        upload_dir = Path(constant.UPLOAD_DIR) / submission_record.upload_dir
        # upload_dirの中身まるごとzipファイルにする
        with zipfile.ZipFile(zip_file_path, "w") as zipf:
            for file in upload_dir.glob("**/*"):
                if file.is_file():
                    zipf.write(file, arcname=file.relative_to(upload_dir))
        return FileResponse(zip_file_path, filename="uploaded_files.zip", media_type="application/zip", background=BackgroundTask(delete_temp_dir, temp_dir))
    elif type == "arranged":
        # arranged_filesのファイル全てをzipファイルにする
        temp_dir = tempfile.TemporaryDirectory()
        temp_dir_path = Path(temp_dir.name)
        zip_file_path = temp_dir_path / "arranged_files.zip"
        file_list = assignments.get_arranged_files(db=db, lecture_id=submission_record.lecture_id, assignment_id=submission_record.assignment_id, eval=submission_record.eval)
        with zipfile.ZipFile(zip_file_path, "w") as zipf:
            for file in file_list:
                file_path = Path(constant.RESOURCE_DIR) / file.path
                zipf.write(file_path, arcname=file_path.name)
        return FileResponse(zip_file_path, filename="arranged_files.zip", media_type="application/zip", background=BackgroundTask(delete_temp_dir, temp_dir))
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="typeは'uploaded'か'arranged'のみ指定できます",
        )

# バッチ採点に関しては、ManagerとAdminが全てのバッチ採点の進捗状況を見れるようにしている。


@router.get("/batch/all", response_model=response.BatchSubmissionItemsForListView)
async def read_all_batch_status(
    page: int,
    page_size: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["batch"]),
    ],
    lecture_title: Optional[str] = Query(default=None, description="講義名を指定して取得する"),
    user: Optional[str] = Query(default=None, description="ユーザ名またはuser_idを指定して取得する"),
    sort_by: Optional[Literal["ts", "user_id", "lecture_id"]] = Query(default="ts", description="ソートするカラムを指定する"),
    sort_order: Optional[Literal["asc", "desc"]] = Query(default="desc", description="ソート順を指定する"),
) -> response.BatchSubmissionItemsForListView:
    """
    全てのバッチ採点の進捗状況を取得する
    """
    if page < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ページは1以上である必要があります",
        )

    batch_submission_record_list, total_count = assignments.get_batch_submission_list(
        db=db, 
        limit=page_size, 
        offset=(page - 1) * page_size, 
        lecture_title=lecture_title, 
        user=user, 
        sort_by=sort_by, 
        sort_order=sort_order
    )

    # ユーザーIDとユーザー名のマッピングを作成
    user_map = {user.user_id: user.username for user in users.get_users(db=db, user_id=None, roles=[schemas.Role.manager.value, schemas.Role.admin.value])}
    
    # 講義IDと講義タイトルのマッピングを作成
    lecture_map = {lecture.id: lecture.title for lecture in assignments.get_lecture_list(db=db)}

    batch_submission_items = []
    for record in batch_submission_record_list:
        item = response.BatchSubmissionItemForListView.model_validate({
            "id": record.id,
            "ts": record.ts,
            "user_id": record.user_id,
            "username": user_map.get(record.user_id, "不明"),
            "lecture_id": record.lecture_id,
            "lecture_title": lecture_map.get(record.lecture_id, "不明"),
            "message": record.message,
            "complete_judge": record.complete_judge,
            "total_judge": record.total_judge
        })
        batch_submission_items.append(item)
    
    total_pages = (total_count + page_size - 1) // page_size

    return response.BatchSubmissionItemsForListView(
        items=batch_submission_items,
        total_items=total_count,
        current_page=page,
        total_pages=total_pages,
        page_size=page_size
    )


@router.get("/batch/id/{batch_id}", response_model=response.BatchSubmission)
async def read_batch_status(
    batch_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["batch"]),
    ],
) -> response.BatchSubmission:
    """
    バッチ採点の進捗状況を取得する
    """
    batch_submission_status = assignments.get_batch_submission_status(db, batch_id)
    if batch_submission_status is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="バッチ採点エントリが見つかりません",
        )

    return response.BatchSubmission.model_validate(batch_submission_status)
