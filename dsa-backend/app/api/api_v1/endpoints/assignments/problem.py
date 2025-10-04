from app.crud.db import assignments
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, Query, Security, File
from fastapi.responses import FileResponse
from app.api.api_v1.endpoints import authenticate_util
import logging
from app.classes import schemas, response
import jsonschema
from jsonschema import exceptions as jsonschema_exceptions
import json
from pathlib import Path
from app import constants as constant
import tempfile
from typing import Annotated, Optional, List
from app.dependencies import get_db
from sqlalchemy.orm import Session
import zipfile
import shutil
from pydantic import ValidationError, BaseModel, Field, model_validator
from datetime import datetime
logging.basicConfig(level=logging.DEBUG)


class ProblemData(BaseModel):
    sub_id: int
    title: str
    md_file: Path
    time_ms: int = Field(default=1000)
    memory_mb: int = Field(default=1024)
    test_files: List[Path] = Field(default_factory=list)
    required_files: List[Path] = Field(default_factory=list)
    build: List["TestCaseData"] = Field(default_factory=list)
    judge: List["TestCaseData"] = Field(default_factory=list)

    model_config = {
        "from_attributes": True
    }
    

class TestCaseData(BaseModel):
    eval_only: bool = Field(default=False)
    title: str
    description: str
    message_on_fail: str | None = Field(default=None)
    command: str
    stdin: Path | None = Field(default=None)
    stdout: Path | None = Field(default=None)
    stderr: Path | None = Field(default=None)
    exit: int = Field(default=0)
    
    model_config = {
        "from_attributes": True
    }
    
    @model_validator(mode="after")
    def set_message_on_fail(self):
        if self.message_on_fail is None:
            self.message_on_fail = f"failed to execute [{self.title}]"
        return self


router = APIRouter()

"""
/api/v1/assignments/problem/...以下のエンドポイントの定義
"""

@router.post("/add", response_model=response.Message)
async def add_problem(
    lecture_id: Annotated[int, Query(description="編集対象の課題データの講義ID")],
    lecture_title: Annotated[str, Query(description="編集対象の課題データの講義タイトル")],
    lecture_start_date: Annotated[datetime, Query(description="編集対象の課題データの公開開始日時")],
    lecture_end_date: Annotated[datetime, Query(description="編集対象の課題データの公開終了日時")],
    upload_file: Annotated[UploadFile, File(description="課題データのソースコード、テストケース、設定JSONファイルを含むzipファイル。is_updateがfalseの場合は見られないので、空のファイルを指定すること")],
    is_update: Annotated[bool, Query(description="trueの場合は、upload_fileの内容を元にProblemテーブルに小課題データを登録する")],
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[schemas.UserRecord, Security(authenticate_util.get_current_active_user, scopes=["batch"])]
) -> response.Message:
    """
    課題データの追加API
    
    is_updateがtrueの場合は、upload_fileの内容を元にProblemテーブルに小課題データを登録する。
    小課題データを登録したくない場合は、is_updateをfalseにし、upload_fileには空のファイルを指定する。。
    すでに小課題が存在する場合は、例外を返す。
    """
    
    lecture = schemas.Lecture(
        id=lecture_id,
        title=lecture_title,
        start_date=lecture_start_date,
        end_date=lecture_end_date
    )

    # lectureの内容を更新する
    try:
        assignments.add_or_update_lecture(db, lecture)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    
    if is_update is False:
        return response.Message(message="lectureの内容のみ更新されました")
    
    # zipファイルを{RESOURCE_DIR}/temp/に配置する
    temporary_zip_path = Path(constant.RESOURCE_DIR) / "temp" / (upload_file.filename if upload_file.filename is not None else f"problem_data_{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.zip")
    temporary_zip_path.parent.mkdir(parents=True, exist_ok=True)
    # zipファイルをtemporary_zip_pathに配置する
    with open(temporary_zip_path, "wb") as f:
        shutil.copyfileobj(upload_file.file, f)
    
    # zipファイルをtemporaryディレクトリに展開する
    with tempfile.TemporaryDirectory() as temp_dir:
        with zipfile.ZipFile(temporary_zip_path, "r") as zip_ref:
            zip_ref.extractall(temp_dir)
        
        current_dir = Path(temp_dir)
        
        if len(list(current_dir.iterdir())) == 1 and list(current_dir.iterdir())[0].is_dir():
            # トップにフォルダ一つのみなら、そのフォルダ以下をカレントディレクトリとする
            current_dir = list(current_dir.iterdir())[0]
        elif len(list(current_dir.iterdir())) > 1 and (current_dir / Path(upload_file.filename).stem).exists():
            # トップにフォルダ一つのみでなく、かつ、ファイル名がフォルダ名と一致するファイルが存在する場合、そのファイルをカレントディレクトリとする
            # 例: __MACOSXなどのメタ情報フォルダが含まれるケース
            current_dir = current_dir / Path(upload_file.filename).stem
        
        json_files = [f for f in current_dir.iterdir() if f.is_file() and f.suffix == ".json"]
        if len(json_files) == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="JSONファイルがありません")
        
        init_json_path = current_dir / "init.json"
        if not init_json_path.exists():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="init.jsonがありません")
        
        # ファイルの内容を読み込む
        with open(init_json_path, "r") as f:
            problem_data = json.load(f)
        
        # 設定JSONファイルのスキーマファイルを読み込む
        with open(Path(constant.RESOURCE_DIR) / "schema.json", "r") as f:
            schema = json.load(f)
        
        # schema validationを行う
        try:
            jsonschema.validate(problem_data, schema)
        except jsonschema_exceptions.ValidationError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
        
        # データをProblemDataに変換する
        try:
            problem_data = ProblemData.model_validate(problem_data)
        except ValidationError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

        # sub_idが既に存在するか調べる
        if assignments.get_problem(db, lecture.id, problem_data.sub_id) is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="小課題IDが既に存在します")
        
        error_message = ""
        # problem_data.md_fileのパスにファイルがあるか確かめる
        if not (current_dir / problem_data.md_file).exists():
            error_message += f"md_fileのパス({problem_data.md_file})にファイルがありません\n"
            
        # problem_data.test_filesのパスにファイルがあるか確かめる
        for test_file in problem_data.test_files:
            if not (current_dir / test_file).exists():
                error_message += f"test_fileのパス({test_file})にファイルがありません\n"
            # ファイルの拡張子が".sh"の場合、パーミッションに"x"をつける
            elif test_file.suffix == ".sh":
                (current_dir / test_file).chmod(0o755)
        
        # problem_data.buildとproblem_data.judgeのstdin, stdout, stderrのパスにファイルがあるか確かめる
        for test_case in problem_data.build + problem_data.judge:
            if test_case.stdin is not None and not (current_dir / test_case.stdin).exists():
                error_message += f"testcase_[{test_case.title}]のstdinのパス({test_case.stdin})にファイルがありません\n"
            if test_case.stdout is not None and not (current_dir / test_case.stdout).exists():
                error_message += f"testcase_[{test_case.title}]のstdoutのパス({test_case.stdout})にファイルがありません\n"
            if test_case.stderr is not None and not (current_dir / test_case.stderr).exists():
                error_message += f"testcase_[{test_case.title}]のstderrのパス({test_case.stderr})にファイルがありません\n"
        
        if error_message != "":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_message)
        
        archive_dir = Path(constant.RESOURCE_DIR) / f"lec-{lecture.id}" / f"problem-{problem_data.sub_id}" / f"{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}"
        # current_dirの中身のファイル全てを、RESOURCE_DIR/lec-{lecture_id}/problem-{problem_data.sub_id}/{YYYY-MM-DD_HH-MM-SS}/extracted/にコピーする
        target_dir = archive_dir / "extracted"
        shutil.copytree(current_dir, target_dir)
        
        # 小課題データを登録する
        problem_record = schemas.Problem(
            lecture_id=lecture.id,
            assignment_id=problem_data.sub_id,
            title=problem_data.title,
            description_path=str((target_dir / problem_data.md_file).relative_to(constant.RESOURCE_DIR)),
            timeMS=problem_data.time_ms,
            memoryMB=problem_data.memory_mb,
            executables=[],
            arranged_files=[
                schemas.ArrangedFiles(
                    lecture_id=lecture.id,
                    assignment_id=problem_data.sub_id,
                    eval=False,
                    path=str((target_dir / test_file).relative_to(constant.RESOURCE_DIR))
                )
                for test_file in problem_data.test_files
            ],
            required_files=[
                schemas.RequiredFiles(
                    lecture_id=lecture.id,
                    assignment_id=problem_data.sub_id,
                    name=str(required_file)
                )
                for required_file in problem_data.required_files
            ],
            test_cases=
                [
                    schemas.TestCases(
                        lecture_id=lecture.id,
                        assignment_id=problem_data.sub_id,
                        eval=test_case.eval_only,
                        type=schemas.EvaluationType.Built,
                        score=0,
                        title=test_case.title,
                        description=test_case.description,
                        message_on_fail=test_case.message_on_fail,
                        command=test_case.command,
                        args=None,
                        stdin_path=str((target_dir / test_case.stdin).relative_to(constant.RESOURCE_DIR)) if test_case.stdin is not None else None,
                        stdout_path=str((target_dir / test_case.stdout).relative_to(constant.RESOURCE_DIR)) if test_case.stdout is not None else None,
                        stderr_path=str((target_dir / test_case.stderr).relative_to(constant.RESOURCE_DIR)) if test_case.stderr is not None else None,
                        exit_code=test_case.exit
                    )
                    for test_case in problem_data.build
                ] + [
                    schemas.TestCases(
                        lecture_id=lecture.id,
                        assignment_id=problem_data.sub_id,
                        eval=test_case.eval_only,
                        type=schemas.EvaluationType.Judge,
                        score=0,
                        title=test_case.title,
                        description=test_case.description,
                        message_on_fail=test_case.message_on_fail,
                        command=test_case.command,
                        args=None,
                        stdin_path=str((target_dir / test_case.stdin).relative_to(constant.RESOURCE_DIR)) if test_case.stdin is not None else None,
                        stdout_path=str((target_dir / test_case.stdout).relative_to(constant.RESOURCE_DIR)) if test_case.stdout is not None else None,
                        stderr_path=str((target_dir / test_case.stderr).relative_to(constant.RESOURCE_DIR)) if test_case.stderr is not None else None,
                        exit_code=test_case.exit
                    )
                    for test_case in problem_data.judge
                ]
        )
        
        assignments.register_problem(db, problem_record)
        
        # ZIPファイルをarchive_dirにコピーする
        shutil.copyfile(temporary_zip_path, archive_dir / temporary_zip_path.name)
        
        # 登録情報をProblemZipPathに登録する
        assignments.register_problem_zip_path(db, schemas.ProblemZipPath(
            lecture_id=lecture.id,
            assignment_id=problem_data.sub_id,
            zip_path=str((archive_dir / temporary_zip_path.name).relative_to(constant.RESOURCE_DIR))
        ))
        
        # 一時ファイルを削除する
        temporary_zip_path.unlink()

        return response.Message(message="課題データを登録しました")


@router.post("/update", response_model=response.Message)
async def update_problem(
    lecture_id: Annotated[int, Query(description="編集対象の小課題のlecture_id")],
    upload_file: Annotated[UploadFile, File(description="課題データのソースコード、テストケース、設定JSONファイルを含むzipファイル")],
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[schemas.UserRecord, Security(authenticate_util.get_current_active_user, scopes=["batch"])]
) -> response.Message:
    """
    課題データの更新API
    """
    
    lecture = assignments.get_lecture(db, lecture_id)
    if lecture is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="指定されたlecture_idの課題エントリが存在しません")
    
    # zipファイルを{RESOURCE_DIR}/temp/に配置する
    temporary_zip_path = Path(constant.RESOURCE_DIR) / "temp" / (upload_file.filename if upload_file.filename is not None else f"problem_data_{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.zip")
    temporary_zip_path.parent.mkdir(parents=True, exist_ok=True)
    # zipファイルをtemporary_zip_pathに配置する
    with open(temporary_zip_path, "wb") as f:
        shutil.copyfileobj(upload_file.file, f)

    # zipファイルをtemporaryディレクトリに展開する
    with tempfile.TemporaryDirectory() as temp_dir:
        with zipfile.ZipFile(temporary_zip_path, "r") as zip_ref:
            zip_ref.extractall(temp_dir)
        
        current_dir = Path(temp_dir)
        
        if len(list(current_dir.iterdir())) == 1 and list(current_dir.iterdir())[0].is_dir():
            # トップにフォルダ一つのみなら、そのフォルダ以下をカレントディレクトリとする
            current_dir = list(current_dir.iterdir())[0]
        elif len(list(current_dir.iterdir())) > 1 and (current_dir / Path(upload_file.filename).stem).exists():
            # トップにフォルダ一つのみでなく、かつ、ファイル名がフォルダ名と一致するファイルが存在する場合、そのファイルをカレントディレクトリとする
            # 例: __MACOSXなどのメタ情報フォルダが含まれるケース
            current_dir = current_dir / Path(upload_file.filename).stem
        
        json_files = [f for f in current_dir.iterdir() if f.is_file() and f.suffix == ".json"]
        if len(json_files) == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="JSONファイルがありません")
        
        init_json_path = current_dir / "init.json"
        if not init_json_path.exists():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="init.jsonがありません")
        
        # ファイルの内容を読み込む
        with open(init_json_path, "r") as f:
            problem_data = json.load(f)
        
        # 設定JSONファイルのスキーマファイルを読み込む
        with open(Path(constant.RESOURCE_DIR) / "schema.json", "r") as f:
            schema = json.load(f)
        
        # schema validationを行う
        try:
            jsonschema.validate(problem_data, schema)
        except jsonschema_exceptions.ValidationError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
        
        # データをProblemDataに変換する
        try:
            problem_data = ProblemData.model_validate(problem_data)
        except ValidationError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
        
        
        error_message = ""
        # problem_data.md_fileのパスにファイルがあるか確かめる
        if not (current_dir / problem_data.md_file).exists():
            error_message += f"md_fileのパス({problem_data.md_file})にファイルがありません\n"
        
        # problem_data.test_filesのパスにファイルがあるか確かめる
        for test_file in problem_data.test_files:
            if not (current_dir / test_file).exists():
                error_message += f"test_fileのパス({test_file})にファイルがありません\n"
            # ファイルの拡張子が".sh"の場合、パーミッションに"x"をつける
            elif test_file.suffix == ".sh":
                (current_dir / test_file).chmod(0o755)
        
        # Problemテーブルに該当する小課題があるなら、それを削除する
        if assignments.get_problem(db, lecture_id, problem_data.sub_id) is not None:
            assignments.delete_problem(db, lecture_id, problem_data.sub_id)

        # problem_data.buildとproblem_data.judgeのstdin, stdout, stderrのパスにファイルがあるか確かめる
        for test_case in problem_data.build + problem_data.judge:
            if test_case.stdin is not None and not (current_dir / test_case.stdin).exists():
                error_message += f"testcase_[{test_case.title}]のstdinのパス({test_case.stdin})にファイルがありません\n"
            if test_case.stdout is not None and not (current_dir / test_case.stdout).exists():
                error_message += f"testcase_[{test_case.title}]のstdoutのパス({test_case.stdout})にファイルがありません\n"
            if test_case.stderr is not None and not (current_dir / test_case.stderr).exists():
                error_message += f"testcase_[{test_case.title}]のstderrのパス({test_case.stderr})にファイルがありません\n"
        
        if error_message != "":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_message)
        
        archive_dir = Path(constant.RESOURCE_DIR) / f"lec-{lecture.id}" / f"problem-{problem_data.sub_id}" / f"{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}"
        # current_dirの中身のファイル全てを、RESOURCE_DIR/lec-{lecture_id}/problem-{problem_data.sub_id}/{YYYY-MM-DD_HH-MM-SS}/extracted/にコピーする
        target_dir = archive_dir / "extracted"
        shutil.copytree(current_dir, target_dir)
        
        # 小課題データを登録する
        problem_record = schemas.Problem(
            lecture_id=lecture.id,
            assignment_id=problem_data.sub_id,
            title=problem_data.title,
            description_path=str((target_dir / problem_data.md_file).relative_to(constant.RESOURCE_DIR)),
            timeMS=problem_data.time_ms,
            memoryMB=problem_data.memory_mb,
            executables=[],
            arranged_files=[
                schemas.ArrangedFiles(
                    lecture_id=lecture.id,
                    assignment_id=problem_data.sub_id,
                    eval=False,
                    path=str((target_dir / test_file).relative_to(constant.RESOURCE_DIR))
                )
                for test_file in problem_data.test_files
            ],
            required_files=[
                schemas.RequiredFiles(
                    lecture_id=lecture.id,
                    assignment_id=problem_data.sub_id,
                    name=str(required_file)
                )
                for required_file in problem_data.required_files
            ],
            test_cases=
                [
                    schemas.TestCases(
                        lecture_id=lecture.id,
                        assignment_id=problem_data.sub_id,
                        eval=test_case.eval_only,
                        type=schemas.EvaluationType.Built,
                        score=0,
                        title=test_case.title,
                        description=test_case.description,
                        message_on_fail=test_case.message_on_fail,
                        command=test_case.command,
                        args=None,
                        stdin_path=str((target_dir / test_case.stdin).relative_to(constant.RESOURCE_DIR)) if test_case.stdin is not None else None,
                        stdout_path=str((target_dir / test_case.stdout).relative_to(constant.RESOURCE_DIR)) if test_case.stdout is not None else None,
                        stderr_path=str((target_dir / test_case.stderr).relative_to(constant.RESOURCE_DIR)) if test_case.stderr is not None else None,
                        exit_code=test_case.exit
                    )
                    for test_case in problem_data.build
                ] + [
                    schemas.TestCases(
                        lecture_id=lecture.id,
                        assignment_id=problem_data.sub_id,
                        eval=test_case.eval_only,
                        type=schemas.EvaluationType.Judge,
                        score=0,
                        title=test_case.title,
                        description=test_case.description,
                        message_on_fail=test_case.message_on_fail,
                        command=test_case.command,
                        args=None,
                        stdin_path=str((target_dir / test_case.stdin).relative_to(constant.RESOURCE_DIR)) if test_case.stdin is not None else None,
                        stdout_path=str((target_dir / test_case.stdout).relative_to(constant.RESOURCE_DIR)) if test_case.stdout is not None else None,
                        stderr_path=str((target_dir / test_case.stderr).relative_to(constant.RESOURCE_DIR)) if test_case.stderr is not None else None,
                        exit_code=test_case.exit
                    )
                    for test_case in problem_data.judge
                ]
        )
        
        assignments.register_problem(db, problem_record)
        
        # ZIPファイルをarchive_dirにコピーする
        shutil.copyfile(temporary_zip_path, archive_dir / temporary_zip_path.name)
        
        # 登録情報をProblemZipPathに登録する
        assignments.register_problem_zip_path(db, schemas.ProblemZipPath(
            lecture_id=lecture.id,
            assignment_id=problem_data.sub_id,
            zip_path=str((archive_dir / temporary_zip_path.name).relative_to(constant.RESOURCE_DIR))
        ))
        
        # 一時ファイルを削除する
        temporary_zip_path.unlink()

        return response.Message(message="課題データを更新しました")


@router.get("/download", response_class=FileResponse)
async def download_problem(
    lecture_id: Annotated[int, Query(description="ダウンロード対象の小課題のlecture_id")],
    problem_id: Annotated[int, Query(description="ダウンロード対象の小課題のproblem_id")],
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[schemas.UserRecord, Security(authenticate_util.get_current_active_user, scopes=["batch"])]
) -> FileResponse:
    """
    課題データのダウンロードAPI
    """
    
    problem_zip_paths = assignments.get_problem_zip_paths(db, lecture_id, problem_id)
    if len(problem_zip_paths) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="指定された小課題に紐づくZIPファイルが存在しません")
    
    # 最もts(timestamp)が最新のZIPファイルのパスを取得する
    latest_problem_zip_path = sorted(problem_zip_paths, key=lambda x: x.ts, reverse=True)[0]
    
    return FileResponse(Path(constant.RESOURCE_DIR) / latest_problem_zip_path.zip_path, filename=Path(latest_problem_zip_path.zip_path).name, media_type="application/zip")


@router.get("/template", response_class=FileResponse)
async def download_template(
    current_user: Annotated[schemas.UserRecord, Security(authenticate_util.get_current_active_user, scopes=["batch"])]
) -> FileResponse:
    """
    課題データのテンプレートダウンロードAPI
    """
    template_path = Path(constant.RESOURCE_DIR) / "template.zip"
    return FileResponse(template_path, filename=template_path.name, media_type="application/zip")


@router.delete("/delete", response_model=response.Message)
async def delete_problem(
    lecture_id: Annotated[int, Query(description="削除対象の小課題のlecture_id")],
    problem_id: Annotated[int, Query(description="削除対象の小課題のproblem_id")],
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[schemas.UserRecord, Security(authenticate_util.get_current_active_user, scopes=["batch"])]
) -> response.Message:
    """
    課題データの削除API
    """
    
    if assignments.get_problem(db, lecture_id, problem_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="指定された小課題が存在しません")
    
    assignments.delete_problem(db, lecture_id, problem_id)
    
    return response.Message(message="課題データを削除しました")
