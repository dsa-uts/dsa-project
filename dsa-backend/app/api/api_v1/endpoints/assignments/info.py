from app.crud.db import assignments
from .util import lecture_is_public, access_sanitize
from fastapi import APIRouter, Depends, Query, Security, HTTPException, status
from app.classes import schemas, response
import logging
from typing import Annotated, List
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.api.api_v1.endpoints import authenticate_util
from pathlib import Path
from app import constants as constant


logging.basicConfig(level=logging.DEBUG)

router = APIRouter()

"""
/api/v1/assignments/info/...以下のエンドポイントの定義
"""

@router.get("", response_model=List[response.Lecture])
async def read_lectures(
    all: Annotated[bool, Query(description="公開期間外含めた全ての授業エントリを取得する場合はTrue、そうでない場合はFalse")],  # 全ての授業エントリを取得するかどうか
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["me"]),
    ],
) -> List[response.Lecture]:
    """
    授業エントリを取得する
    授業(課題1, 課題2, ...)と、それぞれの授業に対応する課題リスト(課題1-1, 課題1-2, ...)も
    合わせて取得する
    """
    ############################### Vital #####################################
    access_sanitize(all=all, role=current_user.role)
    ############################### Vital #####################################

    lecture_list = assignments.get_lecture_list(db)
    if all is True:
        return lecture_list
    else:
        return [response.Lecture.model_validate(lecture) for lecture in lecture_list if lecture_is_public(lecture)]


@router.get("/{lecture_id}", response_model=response.Lecture)
async def read_lecture_entry(
    lecture_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["me"]),
    ],
) -> response.Lecture:
    """
    授業エントリを取得する
    (課題1, 課題2, ...)
    """
    lecture_entry = assignments.get_lecture(db, lecture_id)
    if lecture_entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="授業エントリが見つかりません",
        )
    return response.Lecture.model_validate(lecture_entry)


@router.get("/{lecture_id}/{assignment_id}/entry", response_model=response.Problem)
async def read_assignment_entry(
    lecture_id: int,
    assignment_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["me"]),
    ],
) -> response.Problem:
    """
    授業エントリに紐づく練習問題のエントリの詳細(評価項目、テストケース)を取得する
    """
    lecture_entry = assignments.get_lecture(db, lecture_id)
    
    if lecture_entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="授業エントリが見つかりません",
        )
        
    if current_user.role not in [schemas.Role.admin, schemas.Role.manager]:
        if not lecture_is_public(lecture_entry):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="授業エントリが公開期間内ではありません",
            )
    
    problem_entry = assignments.get_problem(
        db=db,
        lecture_id=lecture_id,
        assignment_id=assignment_id,
        eval=eval,
        detail=False,
    )
    
    if problem_entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="課題エントリが見つかりません",
        )
    
    return response.Problem.model_validate(problem_entry)


@router.get("/{lecture_id}/{assignment_id}/detail", response_model=response.Problem)
async def read_assignment_detail(
    lecture_id: int,
    assignment_id: int,
    eval: Annotated[bool, Query(description="採点リソースにアクセスするかどうか")],
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["me"]),
    ],
) -> response.Problem:
    """
    授業エントリに紐づく練習問題のエントリの詳細(評価項目、テストケース)を取得する
    """
    ############################### Vital #####################################
    access_sanitize(eval=eval, role=current_user.role)
    ############################### Vital #####################################
    lecture_entry = assignments.get_lecture(db, lecture_id)
    if lecture_entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="授業エントリが見つかりません",
        )

    if current_user.role not in [schemas.Role.admin, schemas.Role.manager]:
        if not lecture_is_public(lecture_entry=lecture_entry):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="授業エントリが公開期間内ではありません",
            )

    problem_detail = assignments.get_problem(
        db=db,
        lecture_id=lecture_id,
        assignment_id=assignment_id,
        eval=eval,
        detail=True,
    )
    
    if problem_detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="課題エントリが見つかりません",
        )
    
    res = response.Problem.model_validate(problem_detail)
    
    res.detail = response.ProblemDetail()
    
    # description_pathのファイルの内容を読み込む
    description_path = Path(constant.RESOURCE_DIR) / problem_detail.description_path
    if description_path.exists():
        with open(description_path, "r") as f:
            res.detail.description = f.read()
    
    # RequiredFilesを読み込む
    for required_file in problem_detail.required_files:
        res.detail.required_files.append(
            response.RequiredFiles(
                name=required_file.name
            )
        )
    
    # Executablesを読み込む
    for executable in problem_detail.executables:
        res.detail.executables.append(
            response.Executables(
                eval=executable.eval,
                name=executable.name
            )
        )
    
    # 各TestCasesのstdin, stdout, stderrを読み込む
    for test_case in problem_detail.test_cases:
        test_case_record = response.TestCases(
            id=test_case.id,
            eval=test_case.eval,
            type=test_case.type,
            score=test_case.score,
            title=test_case.title,
            description=test_case.description,
            command=test_case.command,
            args=test_case.args,
            # stdin, stdout, stderrは後でファイルから読み込む
            exit_code=test_case.exit_code,
        )
        
        # stdin, stdout, stderrを読み込む
        if test_case.stdin_path is not None:
            with open(Path(constant.RESOURCE_DIR) / test_case.stdin_path, "r") as f:
                test_case_record.stdin = f.read()
        if test_case.stdout_path is not None:
            with open(Path(constant.RESOURCE_DIR) / test_case.stdout_path, "r") as f:
                test_case_record.stdout = f.read()
        if test_case.stderr_path is not None:
            with open(Path(constant.RESOURCE_DIR) / test_case.stderr_path, "r") as f:
                test_case_record.stderr = f.read()
        res.detail.test_cases.append(test_case_record)

    return res

