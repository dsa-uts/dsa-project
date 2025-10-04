from fastapi import (
    UploadFile,
    APIRouter,
    Depends,
    HTTPException,
    Security,
    status,
)
from typing import Annotated
from sqlalchemy.orm import Session
from ....crud.db import users
from ....dependencies import get_db
from ....classes.schemas import UserCreate, UserDelete, UserUpdatePassword
from typing import List
import logging
from pydantic import ValidationError
import pandas as pd
from app.api.api_v1.endpoints import authenticate_util
from app.classes import schemas, response
from datetime import timedelta
from app.crud.db import users as crud_users
from fastapi.responses import FileResponse
from datetime import datetime
from app import constants as constant
from pathlib import Path
from typing import Optional
import pytz
logging.basicConfig(level=logging.DEBUG)

router = APIRouter()


@router.post("/register")
async def create_user(
    user: UserCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_user, scopes=["account"]),
    ],
) -> response.Message:
    if db is None or current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized"
        )

    # パスワードのハッシュ化
    hashed_password = authenticate_util.get_password_hash(user.plain_password)

    ########################### Vital ######################################
    # 現状は、role: adminのユーザをAPI経由で作成することはできないようにする。
    if user.role == schemas.Role.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden to create admin user.",
        )
    #######################################################################

    current_time = authenticate_util.get_current_time()

    user_record = schemas.UserRecord(
        user_id=user.user_id,
        username=user.username,
        email=user.email,
        hashed_password=hashed_password,
        role=user.role,
        disabled=user.disabled,
        created_at=current_time,
        updated_at=current_time,
        active_start_date=(
            current_time if user.active_start_date is None else user.active_start_date
        ),
        active_end_date=(
            current_time + timedelta(days=365)
            if user.active_end_date is None
            else user.active_end_date
        ),
    )

    try:
        crud_users.create_user(db, user_record)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    return response.Message(message="ユーザーが正常に作成されました。")


@router.post("/register/multiple")
async def register_multiple_users(
    upload_file: UploadFile,
    db: Annotated[Session, Depends(get_db)],
    # current_userが使われることはないが、sccountというスコープを持つユーザー(admin)のみがこのAPIを利用できるようにするために必要
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_user, scopes=["account"]),
    ],
) -> FileResponse:
    if upload_file.filename.endswith(".csv"):
        df = pd.read_csv(upload_file.file)
    elif upload_file.filename.endswith(".xlsx"):
        df = pd.read_excel(upload_file.file)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file format. Please upload a .csv or .xlsx file.",
        )

    required_columns = [
        "user_id",
        "username",
        "email",
        "password",
        "role",
        "active_start_date",
        "active_end_date",
    ]
    missing_columns = [col for col in required_columns if col not in df.columns]
    if missing_columns:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required columns in the file: {', '.join(missing_columns)}",
        )

    error_messages = []
    current_time = authenticate_util.get_current_time()
    for index, row in df.iterrows():
        if pd.isna(row["password"]) or row["password"] == "":
            generated_password = authenticate_util.generate_password()
            df.at[index, "password"] = generated_password
        else:
            generated_password = row["password"]

        try:
            user_data = schemas.UserRecord(
                user_id=str(row["user_id"]),
                username=row["username"],
                email=row["email"],
                hashed_password=authenticate_util.get_password_hash(generated_password),
                role=schemas.Role(row["role"]),
                disabled=False,
                created_at=current_time,
                updated_at=current_time,
                active_start_date=(
                    pd.to_datetime(row["active_start_date"]).tz_localize("Asia/Tokyo")
                    if pd.notna(row["active_start_date"])
                    else current_time
                ),
                active_end_date=(
                    pd.to_datetime(row["active_end_date"]).tz_localize("Asia/Tokyo")
                    if pd.notna(row["active_end_date"])
                    else current_time + timedelta(days=365)
                ),
            )

            crud_users.create_user(db, user_data)
        except Exception as e:
            error_messages.append(f"Error creating user {row['user_id']}: {str(e)}")

    # updateしたdfをcsvに出力、{RESOURCE_DIR}/users/{YYYY-MM-DD-HH-MM-SS}.csv
    # ファイル名は、現在時刻をフォーマットしたものとする
    user_file_dir = Path(constant.UPLOAD_DIR) / "users"
    user_file_dir.mkdir(parents=True, exist_ok=True)
    file_path = user_file_dir / f"{datetime.now(tz=pytz.timezone('Asia/Tokyo')).strftime('%Y-%m-%d-%H-%M-%S')}.xlsx"
    df.to_excel(file_path, index=False)

    # Return the updated file to the client
    return FileResponse(file_path, filename=file_path.name)

@router.post("/update/user")
async def update_user(
    user: UserCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_user, scopes=["view_users"]),
    ],
) -> response.Message:
    if db is None or current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized"
        )

    # plain_passwordが空でない場合はハッシュ化したパスワードを取得
    if user.plain_password:
        hashed_password = authenticate_util.get_password_hash(user.plain_password)
    else:
        hashed_password = ""

    ########################### Vital ######################################
    # 現状は、role: adminのユーザをAPI経由で作成することはできないようにする。
    if user.role == schemas.Role.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden to update admin user.",
        )
    # role: managerは自分自身とstudentのユーザーを更新可能
    if current_user.role == schemas.Role.manager:
        if user.role != schemas.Role.student and user.user_id != current_user.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden to update user.",
            )
    #######################################################################

    # UserRecordオブジェクトを作成
    user_data = schemas.UserRecord(
        user_id=user.user_id,
        username=user.username,
        email=user.email,
        hashed_password=hashed_password,
        role=user.role,
        disabled=user.disabled,
        created_at=authenticate_util.get_current_time(), # Noneが使えないので，便宜的に書いているがcrud_users.update_userで除外される．
        updated_at=authenticate_util.get_current_time(),
        active_start_date=user.active_start_date or authenticate_util.get_current_time(),
        active_end_date=user.active_end_date or (authenticate_util.get_current_time() + timedelta(days=365))
    )

    try:
        # ユーザー情報を更新
        updated_user = crud_users.update_user(db, user_data)
        return response.Message(message=f"ユーザー {updated_user.user_id} の情報が正常に更新されました。")
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"ユーザー更新中にエラーが発生しました: {str(e)}")
    pass


@router.get("/all", response_model=List[response.User])
async def get_users_list(
    db: Annotated[Session, Depends(get_db)],
    # current_userが使われることはないが、view_usersというスコープを持つユーザー(admin, manager)のみがこのAPIを利用できるようにするために必要
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_user, scopes=["view_users"]),
    ],
    user_id: Optional[str] = None,
    role: Optional[str] = None
) -> List[response.User]:
    '''
    role: 検索対象のユーザのroleをカンマ区切りで指定する。以降、rolesとする。
    
    以下のクエリを実行して、ユーザーを取得する。
    SELECT * FROM Users WHERE user_id = user_id OR role IN roles
    '''
    # パスワードを除外して返す
    roles = [r.strip() for r in role.split(',')] if role else None
    return [
        response.User.model_validate(user.model_dump(exclude={"hashed_password"}))
        for user in crud_users.get_users(db=db, user_id=user_id, roles=roles)
    ]


@router.post("/delete")
async def delete_users(
    user_ids: UserDelete,
    db: Annotated[Session, Depends(get_db)],
    # current_userが使われることはないが、accountというスコープを持つユーザー(admin)のみがこのAPIを利用できるようにするために必要
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_user, scopes=["account"]),
    ],
):
    try:
        # adminのユーザは削除できないようにする
        for user_id in user_ids.user_ids:
            # ユーザレコード取得
            user_record = crud_users.get_user(db=db, user_id=user_id)

            if user_record is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"user_id: {user_id} のユーザーが見つかりません",
                )

            if user_record.role is schemas.Role.admin:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="adminユーザは削除できません",
                )
        crud_users.delete_users(db=db, user_ids=user_ids.user_ids)
        return {"msg": "ユーザーが正常に削除されました。"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/me")
async def get_my_user_info(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_user, scopes=["me"]),
    ],
) -> response.User:
    return response.User.model_validate(current_user)


@router.get("/info/{user_id}")
async def get_user_info(
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_user, scopes=["me"]),
    ],
) -> response.User:
    if current_user.role not in [schemas.Role.admin, schemas.Role.manager]:
        if current_user.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden to access other user's information")
    user_record = crud_users.get_user(db=db, user_id=user_id)
    if user_record is None:
        raise HTTPException(status_code=404, detail="User not found")
    return response.User.model_validate(user_record)


@router.post("/update/password")
async def update_password(
    user: UserUpdatePassword,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        schemas.UserRecord,
        Security(authenticate_util.get_current_user, scopes=["me"]),
    ],
) -> response.Message:
    user_role = current_user.role
    new_hashed_password = authenticate_util.get_password_hash(user.new_plain_password)
    current_time = authenticate_util.get_current_time()
    # 自分のパスワードの更新は全員が可能．
    if current_user.user_id == user.user_id:
        # 現在のパスワードを検証
        if not authenticate_util.verify_password(
            user.plain_password, current_user.hashed_password
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="現在のパスワードが正しくありません",
            )

        # パスワードを更新
        crud_users.update_password(db, user.user_id, new_hashed_password, current_time)
        return response.Message(message="パスワードが正常に更新されました")

    # managerは自分のパスワードと学生のパスワードを更新可能．
    if user_role is schemas.Role.manager:
        # user.user_idのユーザー情報を取得
        target_user = crud_users.get_user(db=db, user_id=user.user_id)
        if target_user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="指定されたユーザーが見つかりません",
            )

        # 対象ユーザーのロールを取得
        target_user_role = target_user.role

        # managerは学生のパスワードのみ更新可能
        if target_user_role != schemas.Role.student:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="管理者は学生のパスワードのみ更新可能です",
            )

        # パスワードを更新
        crud_users.update_password(db, user.user_id, new_hashed_password, current_time)
        return response.Message(message="パスワードが正常に更新されました")

    # adminは全てのパスワードを更新可能
    if user_role is schemas.Role.admin:
        target_user = crud_users.get_user(db=db, user_id=user.user_id)
        if target_user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="指定されたユーザーが見つかりません",
            )
        crud_users.update_password(db, user.user_id, new_hashed_password, current_time)
        return response.Message(message="パスワードが正常に更新されました")

    # その他のユーザーはパスワードの更新はできない
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail="パスワードの更新はできません"
    )
