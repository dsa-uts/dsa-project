from app.api.api_v1.dependencies import (
    pwd_context,
    oauth2_scheme,
    SECRET_KEY,
    ALGORITHM,
    SCOPES,
)
from app.classes import schemas
import pytz
from datetime import datetime
from sqlalchemy.orm import Session
import jwt
from jwt.exceptions import InvalidTokenError
from pydantic import ValidationError
from fastapi import HTTPException, status
import app.crud.db.users as crud_users
import app.crud.db.authorize as crud_authorize
from fastapi import Depends, Security
from fastapi.security import SecurityScopes
from typing import Annotated
from app.dependencies import get_db
import string
import secrets

TOKYO_TZ = pytz.timezone("Asia/Tokyo")

def generate_password():
    """
    ランダムなパスワードを生成する
    r"[a-zA-Z0-9]{6}-[a-zA-Z0-9]{6}-[a-zA-Z0-9]{6}"のフォーマットになる。
    """
    characters = string.ascii_letters + string.digits
    parts = []
    for _ in range(3):
        part = "".join(secrets.choice(characters) for _ in range(6))
        parts.append(part)
    return "-".join(parts)


def get_current_time() -> datetime:
    """
    現在の時刻を取得する
    
    さらに、秒単位に丸める
    """
    return datetime.now(TOKYO_TZ).replace(microsecond=0)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    平文パスワードをハッシュ化し、DBに格納されているハッシュ化されたパスワードと一致するかを確認する
    """
    return pwd_context.verify(plain_password, hashed_password)


def is_past(ts: datetime) -> bool:
    """
    指定された日時が過去かどうかを確認する
    """
    return TOKYO_TZ.localize(ts) <= datetime.now(TOKYO_TZ)


def is_future(ts: datetime) -> bool:
    """
    指定された日時が未来かどうかを確認する
    """
    return TOKYO_TZ.localize(ts) >= datetime.now(TOKYO_TZ)


def authenticate_user(
    db: Session, username: str, plain_password: str
) -> schemas.UserRecord | bool:
    """
    user_idをキーにしてユーザーを取得し、パスワードが一致するかを確認する。

    ユーザが存在し、パスワードが一致する場合はユーザレコードを返す。
    ユーザーが存在しない場合はFalseを返す
    """
    user: schemas.UserRecord | None = crud_users.get_user(db=db, user_id=username)
    if user is None:
        return False
    if not verify_password(
        plain_password=plain_password, hashed_password=user.hashed_password
    ):
        return False
    return user


def get_password_hash(plain_password: str) -> str:
    """
    パスワードをハッシュ化する
    """
    return pwd_context.hash(plain_password)


def is_token_expired(payload: schemas.JWTTokenPayload) -> bool:
    """
    トークンが有効期限を過ぎているかを確認する
    """
    if TOKYO_TZ.localize(payload.expire) <= datetime.now(TOKYO_TZ):
        return True
    return False


def decode_token(token: str) -> schemas.JWTTokenPayload:
    """
    JWTトークンをデコードし、ペイロードを返す
    """
    scope_str = ""
    try:
        # tokenのデコード
        raw_token_payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        token_payload = schemas.JWTTokenPayload.model_validate(raw_token_payload)
        scope_str = " ".join(token_payload.scopes)
    except (InvalidTokenError, ValidationError):
        # トークンのフォーマットが無効、または各フィールドのValidationに失敗した場合
        # NOTE: authenticate_valueの設定については、ここまで厳密にやらなくても問題ない
        if scope_str == "":
            authenticate_value = "Bearer"
        else:
            authenticate_value = f'Bearer scope="{scope_str}"'
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": authenticate_value},
        )

    return token_payload


async def get_current_user(
    security_scopes: SecurityScopes,
    db: Annotated[Session, Depends(get_db)],
    token: Annotated[str, Depends(oauth2_scheme)],
) -> schemas.UserRecord:
    '''
    アクセストークンからユーザを取得する。
    トークンが有効期限を過ぎている場合は、401エラーを返す。
    要求されたスコープがユーザーのスコープに含まれていない場合は、403エラーを返す。
    
    この関数は、認証&認可が必要なAPIのエンドポイントにInjectionされることを
    想定している。
    '''
    
    # アクセストークンのデコードをする
    token_payload = decode_token(token)
    
    # トークンの有効期限が過ぎている場合は、401エラーを返す
    if is_past(token_payload.expire):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    
    # ユーザを取得する
    user = crud_users.get_user(db=db, user_id=token_payload.sub)
    
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
        
    # ユーザに許可されたスコープを取得する
    allowed_scopes = SCOPES[user.role.value]
    
    # 要求されたスコープがユーザーのスコープに含まれていない場合は、403エラーを返す
    for requested_scope in security_scopes.scopes:
        if requested_scope not in allowed_scopes:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not enough permissions",
            )
    
    # ログイン履歴に存在しないなら、401エラーを返す
    login_history = crud_authorize.get_login_history(db=db, user_id=user.user_id, login_at=token_payload.login)
    if login_history is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User is not logged in",
        )
    
    return user


async def get_current_active_user(
    current_user: Annotated[schemas.UserRecord, Security(get_current_user, scopes=["me"])],
    db: Annotated[Session, Depends(get_db)]
) -> schemas.UserRecord:
    '''
    ユーザが有効かどうかを確認する
    
    ユーザが無効な場合は、400エラーを返す
    
    この関数は、認証&認可が必要かつユーザが有効かどうかを確認するAPIのエンドポイントにInjectionされることを
    想定している。
    '''
    if is_past(current_user.active_end_date):
        crud_users.update_disabled_status(db=db, user_id=current_user.user_id, disabled=True)

    if current_user.disabled:        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User is disabled"
        )

    return current_user