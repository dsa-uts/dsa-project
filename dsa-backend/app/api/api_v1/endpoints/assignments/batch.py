from app.crud.db import assignments, users
from .util import lecture_is_public, access_sanitize
from fastapi import APIRouter, Depends, Query, Security, HTTPException, status, UploadFile, File
from app.classes import schemas, response
import logging
from typing import Annotated, List
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.api.api_v1.endpoints import authenticate_util
from pathlib import Path
from app import constants as constant
import shutil
import tempfile
from datetime import datetime
from .util import unfold_zip
import zipfile
import pandas as pd
import io

logging.basicConfig(level=logging.DEBUG)

router = APIRouter()

"""
/api/v1/assignments/batch/...以下のエンドポイントの定義
"""

def get_report_list(report_list_path: Path) -> pd.DataFrame | None:
    '''
    reportlist.xlsx(またはreportlist.xls)を読み込み、
    "# 学籍番号", "# ロール", "# 提出", "# 提出日時"の4列のみを取得する
    '''
    
    if not report_list_path.exists():
        return None
    
    # エクセルファイルを読み込む
    df = pd.read_excel(report_list_path, header=None)
    
    # CSVに変換
    csv_str = df.to_csv(index=False)
    data_io = io.StringIO(csv_str)
    
    # 最初から、"# 内部コースID"で始まる箇所まで削除(pandasではなく、csvを直接操作する)
    data_io.seek(0)
    lines = data_io.readlines()
    lines = [line.strip() for line in lines]
    for i, line in enumerate(lines):
        if line.startswith("# 内部コースID"):
            break
    lines = lines[i:]
    
    # "#end"で始まる行を見つけて、それ以降の行を削除
    end_row = 0
    for i, line in enumerate(lines):
        if line.startswith("#end"):
            end_row = i
            break
    lines = lines[:end_row]
    
    # print("first transform")
    # for line in lines:
    #     print(line)
    
    csv_str = "\n".join(lines)
    data_io = io.StringIO(csv_str)
    
    df = pd.read_csv(data_io)
    
    columes_to_keep = ["# 学籍番号", "# ロール", "# 提出", "# 提出日時"]
    df = df[columes_to_keep]
    
    return df

@router.post("/{lecture_id}", response_model=response.BatchSubmission)
async def batch_judge(
    uploaded_zip_file: Annotated[UploadFile, File(description="採点者がmanabaから取得するzipファイル")],
    lecture_id: int,
    eval: Annotated[bool, Query(description="採点リソースにアクセスするかどうか")],
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_active_user, scopes=["batch"]),
    ],
) -> response.BatchSubmission:
    """
    バッチ採点リクエストを受け付ける

    注) 採点用のエンドポイントで、学生が使うことを想定していない。
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
        if not lecture_is_public(lecture_entry):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="授業エントリが公開期間内ではありません",
            )
    
    problem_list = [problem for problem in lecture_entry.problems]

    # バッチ採点のリクエストをBatchSubmissionテーブルに登録する
    batch_submission_record = assignments.register_batch_submission(
        db=db,
        user_id=current_user.user_id,
        lecture_id=lecture_id
    )

    batch_id = batch_submission_record.id
    total_judge = 0 # 採点対象のジャッジリクエストの数
    
    error_message = ""
    
    batch_dir = Path(constant.UPLOAD_DIR) / "batch" / f"{batch_submission_record.ts.strftime('%Y-%m-%d-%H-%M-%S')}-{batch_submission_record.id}"
    batch_dir.mkdir(parents=True, exist_ok=True)
    
    with tempfile.TemporaryDirectory() as workspace_dir:
        workspace_dir_path = Path(workspace_dir)

        # アップロードされたzipファイルをworkspace_dirに展開する
        try:
            with zipfile.ZipFile(uploaded_zip_file.file, "r") as zip_ref:
                zip_ref.extractall(workspace_dir_path)
        except Exception as e:
            shutil.rmtree(batch_dir)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"zipファイルの展開に失敗しました: {e}",
            )

        current_dir = workspace_dir_path
        if (
            len(list(current_dir.iterdir())) == 1
            and list(current_dir.iterdir())[0].is_dir()
        ):
            # 展開先のディレクトリで、フォルダが一個しかない場合
            current_dir = list(current_dir.iterdir())[0]
        elif (
            len(list(current_dir.iterdir())) > 1
            and (current_dir / Path(uploaded_zip_file.filename).stem).exists()
            and (current_dir / Path(uploaded_zip_file.filename).stem).is_dir()
        ):
            # 展開後に、__MACOSXなどのメタフォルダとZIPファイル名のフォルダができている場合
            # ZIPファイル名のフォルダをcurrent_dirとする
            current_dir = current_dir / Path(uploaded_zip_file.filename).stem

        '''
        この時点でのcurrent_dirの構成
        .
        ├── 202211479@001202214795
        │   └── class{lecture_id}.zip 
        ├── 202211479@001202214795
        │   └── class{lecture_id}.zip 
        ├── 202211479@001202214795
        │   └── class{lecture_id}.zip 
        ├── 202211479@001202214795
        │   └── class{lecture_id}.zip
        ...
        └── reportlist.xlsx
        ''' 
    
        '''
        current_dirにあるフォルダを読み込み、
        {UPLOAD_DIR}/batch/{batch_submission_record.ts}-{batch_submission_record.id}/
        に以下のような構成で配置する
        .
        ├── 202211479
        │   ├── report1.pdf
        |   ├── Makefile
        |   ├── main.c
        |   └── func.c
        ├── 202211479
        │   ├── report1.pdf
        |   ├── Makefile
        |   ├── main.c
        |   └── func.c
        ├── 202211479
        │   ├── report1.pdf
        |   ├── Makefile
        |   ├── main.c
        |   └── func.c
        ...
        └── reportlist.xlsx
        '''
        
        # reportlist.xlsxもしくはreportlist.xlsをbatch_dirにコピーする
        reportlist_file_on_workspace = current_dir / "reportlist.xlsx"
        if not reportlist_file_on_workspace.exists():
            reportlist_file_on_workspace = current_dir / "reportlist.xls"
            if not reportlist_file_on_workspace.exists():
                # batch_dirを削除して、エラーメッセージを返す
                shutil.rmtree(batch_dir)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="reportlist.xlsxまたはreportlist.xlsが存在しません",
                )
        
        # reportlist.xlsxもしくはreportlist.xlsをbatch_dirにコピーする
        reportlist_file_on_batch = batch_dir / reportlist_file_on_workspace.name
        reportlist_file_on_batch.write_bytes(reportlist_file_on_workspace.read_bytes())
    
        # 各ユーザのフォルダをbatch_dirにコピーする
        for user_dir in current_dir.iterdir():
            if not user_dir.is_dir() or '@' not in user_dir.name:
                continue
            
            # {9桁の学籍番号}@{13桁のID}の{9桁の学籍番号}の部分を取得する
            user_id = user_dir.name.split('@')[0]
                
            # ユーザがDBに登録されているかチェックする
            if users.get_user(db, user_id) is None:
                error_message += f"{user_id}はユーザDBに登録されていません\n"
                continue
            
            # 展開先のディレクトリを作成する
            user_zip_file_extract_dest = batch_dir / user_id
            user_zip_file_extract_dest.mkdir(parents=True, exist_ok=True)
            
            # ユーザのclass{lecture_id}.zipの内容を展開し、
            # {batch_dir}/{user_id}/に配置する
            user_zip_file_on_workspace = user_dir / f"class{lecture_id}.zip"
            if not user_zip_file_on_workspace.exists():
                error_message += f"{user_id}は提出済みであるにも関わらず、class{lecture_id}.zipを提出していません\n"
                ################## important ##################
                # もし、class{lecture_id}.zipが存在しない場合は、他のファイルをなるべく展開先のディレクトリにコピーする
                for file in user_dir.iterdir():
                    # もしzipファイルなら、展開する
                    if file.is_file() and file.name.endswith(".zip"):
                        message = unfold_zip(file, user_zip_file_extract_dest)
                        if message is not None:
                            error_message += f"{user_id}のZipファイルの解凍中にエラーが発生しました: {message}\n"
                            continue
                    else:
                        shutil.copy(file, user_zip_file_extract_dest)
            else:
                ################## important ##################
                # class{lecture_id}.zipが存在する場合は、それを展開する
                message = unfold_zip(user_zip_file_on_workspace, user_zip_file_extract_dest)
                if message is not None:
                    error_message += f"{user_id}のZipファイルの解凍中にエラーが発生しました: {message}\n"
                    continue
            
            """
            NOTE: .oファイルがあると、コンパイルエラーになり、本来はコンパイルできるはずのコードが
            ジャッジされないことがあるため、.oファイルを削除しておく
            例: 
            main_binarytree.o: file not recognized: file format not recognized
            collect2: error: ld returned 1 exit status
            make: *** [<builtin>: binarytree] Error 1
            """
            for file in user_zip_file_extract_dest.glob("*.o"):
                file.unlink()

    # reportlist.xlsxを読み込み、未提出も含めて、採点対象の学生のリストを取得する
    # 取得する情報、学籍番号、提出状況(提出済/受付終了後提出/未提出)、提出日時(None | datetime)
    report_list_df = get_report_list(batch_dir / "reportlist.xlsx")

    if report_list_df is None:
        # reportlist.xlsxが存在しない場合は、reportlist.xlsを試す
        report_list_df = get_report_list(batch_dir / "reportlist.xls")

    if report_list_df is None:
        # reportlist.xlsxもreportlist.xlsも存在しない場合は、エラーを返す
        shutil.rmtree(batch_dir)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="reportlist.xlsxまたはreportlist.xlsが存在しません",
        )
        
    # "# ロール"の値が"履修生"である行のみ残す
    report_list_df = report_list_df[report_list_df["# ロール"] == "履修生"]

    # ユーザの学籍番号をキーとして、そのユーザの提出状況を格納する
    # 未提出のユーザはNoneとする。
    evaluation_status_list: list[schemas.EvaluationStatus] = []

    # report_list_dfの"# 学籍番号"の値(9桁の学籍番号)と"# 提出"の値(提出済/受付終了後提出/未提出)を参照し、
    # "未提出"でないなら、{9桁の学籍番号}@{13桁のID}のフォルダを探す。
    # そのフォルダが存在するなら、user_id_to_batch_submission_summaryにそのユーザの提出状況を格納する。
    # そのフォルダが存在しないなら、error_messageにエラーメッセージを追加する。
    for index, row in report_list_df.iterrows():
        user_id = str(row["# 学籍番号"]) if not pd.isna(row["# 学籍番号"]) else None
        submission_status = str(row["# 提出"]) if not pd.isna(row["# 提出"]) else None
        submit_date = datetime.strptime(str(row["# 提出日時"]), "%Y-%m-%d %H:%M:%S") if not pd.isna(row["# 提出日時"]) else None
        # logging.info(f"user_id: {user_id}, submission_status: {submission_status}, submit_date: {submit_date}")

        if user_id is None:
            error_message += f"{index}行目の学籍番号が空です\n"
            continue
        
        if users.get_user(db, user_id) is None:
            error_message += f"{index}行目のユーザがDBに登録されていません: {user_id}\n"
            continue

        if (submission_status == "提出済" or submission_status == "受付終了後提出") and submit_date is None:
            error_message += f"{index}行目の提出日時が提出済みであるにも関わらず空です。遅延判定ができません\n"
            continue

        evaluation_status_record = schemas.EvaluationStatus(
            batch_id=batch_id,
            user_id=user_id,
            status=(
                schemas.StudentSubmissionStatus.SUBMITTED
                if submission_status == "提出済"
                else (
                    schemas.StudentSubmissionStatus.DELAY
                    if submission_status == "受付終了後提出"
                    else schemas.StudentSubmissionStatus.NON_SUBMITTED
                )
            ),
        )
        
        if evaluation_status_record.status == schemas.StudentSubmissionStatus.NON_SUBMITTED:
            evaluation_status_list.append(evaluation_status_record)
            continue
        
        user_upload_dir = batch_dir / user_id
        
        if not user_upload_dir.exists():
            error_message += f"{user_id}は提出済みであるにも関わらず、フォルダが存在しません\n"
            continue
        
        # アップロード先ディレクトリを設定する
        evaluation_status_record.upload_dir = str(user_upload_dir.relative_to(Path(constant.UPLOAD_DIR)))
        
        # レポートのパス
        # アップロード先にreport{lecture_id}.pdfがあるはず
        report_path = user_upload_dir / f"report{lecture_id}.pdf"
        if report_path.exists():
            evaluation_status_record.report_path = str(report_path.relative_to(Path(constant.UPLOAD_DIR)))
        else:
            # pdfファイルが一つだけある場合
            report_path_list = list(user_upload_dir.glob("*.pdf"))
            if len(report_path_list) == 1:
                evaluation_status_record.report_path = str(report_path_list[0].relative_to(Path(constant.UPLOAD_DIR)))
            else:
                # pdfファイルが複数ある場合、もしくは一つもない場合は、Noneとする
                evaluation_status_record.report_path = None
        
        # 提出日時を設定する
        evaluation_status_record.submit_date = submit_date
        
        evaluation_status_list.append(evaluation_status_record)
        
    for evaluation_status_record in evaluation_status_list:
        evaluation_status_record = assignments.register_evaluation_status(db=db, evaluation_status_record=evaluation_status_record)
        
        # 未提出の場合は、ジャッジを行わない
        if evaluation_status_record.status == schemas.StudentSubmissionStatus.NON_SUBMITTED:
            # batch_submission_summary_record.result = None
            continue
        
        if evaluation_status_record.upload_dir is None:
            error_message += f"{evaluation_status_record.user_id}の提出フォルダが存在しません\n"
            # 提出フォルダが存在しない場合は、非提出とする
            evaluation_status_record.status = schemas.StudentSubmissionStatus.NON_SUBMITTED
            assignments.update_evaluation_status(db=db, evaluation_status_record=evaluation_status_record)
            continue
        
        # 提出済みの場合は、ジャッジを行う
        
        # 各課題ごとにジャッジリクエストを発行する
        for problem_entry in problem_list:
            # ジャッジリクエストをSubmissionテーブルに登録する
            submission_record = assignments.register_submission(
                db=db,
                evaluation_status_id=evaluation_status_record.id,
                user_id=evaluation_status_record.user_id,
                lecture_id=problem_entry.lecture_id,
                assignment_id=problem_entry.assignment_id,
                eval=eval,
                upload_dir=evaluation_status_record.upload_dir,
            )
            
            total_judge += 1
    
    # エラーメッセージを設定する
    batch_submission_record.message = error_message
    # total_judgeの値を更新する
    batch_submission_record.complete_judge = 0
    batch_submission_record.total_judge = total_judge

    assignments.modify_batch_submission(db=db, batch_submission_record=batch_submission_record)
    
    # 全てのSubmissionの進捗状況をqueuedに更新する
    assignments.modify_all_submission_statuses_of_batch_submission(db=db, batch_id=batch_id, status=schemas.SubmissionProgressStatus.QUEUED)

    return response.BatchSubmission.model_validate(batch_submission_record)

