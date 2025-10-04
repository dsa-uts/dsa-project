from fastapi import APIRouter, Depends, HTTPException, Response, status, Request
from app.api.api_v1.dependencies import (
    oauth2_scheme,
    SECRET_KEY,
    ALGORITHM,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_EXPIRE_MINUTES,
    SCOPES,
)
from sqlalchemy.orm import Session
from app.classes import schemas
from app.classes import response
from app.crud.db import authorize
from app.dependencies import get_db
import jwt
from jwt.exceptions import InvalidTokenError
from pydantic import ValidationError
from typing import Annotated
from fastapi.security import OAuth2PasswordRequestForm
from datetime import timedelta, datetime, timezone
from app.api.api_v1.endpoints.authenticate_util import (
    authenticate_user,
    is_past,
    decode_token,
    get_current_time,
)

import logging

router = APIRouter()

logging.basicConfig(level=logging.DEBUG)

access_token_duration = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
refresh_token_duration = timedelta(minutes=REFRESH_TOKEN_EXPIRE_MINUTES)


"""
/api/v1/authorize/...以下のエンドポイントの定義
"""


@router.post("/token")
async def login_for_access_token(
    credentials: Response,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[Session, Depends(get_db)],
) -> response.Token:
    logging.info(f"login_for_access_token, form_data: {form_data.username}")
    user = authenticate_user(
        db=db, username=form_data.username, plain_password=form_data.password
    )
    if user is False:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect user_id or password",
        )

    login_at = get_current_time()

    # アクセストークンのペイロード
    access_token_payload = schemas.JWTTokenPayload(
        sub=user.user_id,
        login=login_at,
        expire=login_at + access_token_duration,
        scopes=form_data.scopes,
        role=user.role
    )

    # リフレッシュトークンのペイロード
    refresh_token_payload = schemas.JWTTokenPayload(
        sub=user.user_id,
        login=login_at,
        expire=login_at + refresh_token_duration,
        scopes=form_data.scopes,
        role=user.role
    )

    # リクエストされたスコープが空の場合、ユーザの権限情報をスコープとして設定する
    if len(form_data.scopes) == 0:
        form_data.scopes = (
            []
            if user.role.value not in SCOPES
            else SCOPES[user.role.value]
        )

    ############################## Vital Code ##################################
    ############################################################################
    # form_data.scopesでリクエストされているscopeが、ユーザに認められているスコープと合致しているか検証する
    # ユーザに認められているスコープ(権限情報)の取得
    permitted_scope_list = (
        []
        if user.role.value not in SCOPES
        else SCOPES[user.role.value]
    )
    # リクエストされたスコープが、そのユーザに対して全て認められているか調べる
    for requested_scope in form_data.scopes:
        if requested_scope not in permitted_scope_list:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="your requested access rights is not permitted.",
            )
    ############################################################################
    ############################################################################

    # access_token, refresh_tokenを発行する
    access_token: str = jwt.encode(
        payload=access_token_payload.model_dump(), key=SECRET_KEY, algorithm=ALGORITHM
    )
    refresh_token: str = jwt.encode(
        payload=refresh_token_payload.model_dump(), key=SECRET_KEY, algorithm=ALGORITHM
    )

    # リフレッシュトークンをクッキーにセット
    credentials.delete_cookie(key="refresh_token")
    credentials.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=False,
        samesite="Lax",
        expires=datetime.now(timezone.utc) + refresh_token_duration,
    )

    # LoginHistoryに登録
    authorize.add_login_history(
        db=db,
        login_history_record=schemas.LoginHistory(
            user_id=user.user_id,
            login_at=login_at,
            logout_at=login_at + access_token_duration,
            refresh_count=0,
        ),
    )

    return response.Token(
        access_token=access_token,
        token_type="bearer",
        login_time=login_at,
        user_id=user.user_id,
        role=user.role,
        refresh_count=0,
    )


@router.get("/token/update")
async def update_token(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    token: Annotated[str, Depends(oauth2_scheme)],
) -> response.Token:
    logging.info(f"update_token, token: {token}")
    '''
    リフレッシュ方針
    
    1. リフレッシュトークンは、再認証しない限り新しく発行はされない。その代わり有効期限は長め
    2. リフレッシュトークンの有効期間内に、アクセストークンのみ再発行できる。
    '''

    # アクセストークンのデコード
    access_token_payload = decode_token(token=token)

    # リフレッシュトークンを取得
    old_refresh_token = request.cookies.get("refresh_token")

    if old_refresh_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )

    # リフレッシュトークンのデコード
    refresh_token_payload = decode_token(token=old_refresh_token)

    # リフレッシュトークンの有効期限が切れている場合、何も返さない
    if is_past(refresh_token_payload.expire):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        )

    # アクセストークンとリフレッシュトークンが正しいペアかどうか検証する
    if (
        access_token_payload.sub != refresh_token_payload.sub
        or access_token_payload.login != refresh_token_payload.login
        or set(access_token_payload.scopes) != set(refresh_token_payload.scopes)
        or access_token_payload.role != refresh_token_payload.role
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token and refresh token pair",
        )

    user_id = access_token_payload.sub
    login_at = access_token_payload.login

    # ログイン履歴を取得する
    login_history = authorize.get_login_history(
        db=db, user_id=user_id, login_at=login_at
    )

    if login_history is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="login history not found"
        )
        
    # アクセストークンの有効期限が切れていない場合、元のアクセストークンを返す
    if not is_past(access_token_payload.expire):
        return response.Token(
            access_token=token,
            token_type="bearer",
            login_time=access_token_payload.login,
            user_id=access_token_payload.sub,
            role=access_token_payload.role,
            refresh_count=login_history.refresh_count,
        )

    # アクセストークンが無効でリフレッシュトークンが有効のとき、
    # 新しいアクセストークンとリフレッシュトークンを発行する
    new_access_token_payload = schemas.JWTTokenPayload(
        sub=access_token_payload.sub,
        login=access_token_payload.login,
        ################## Vital ###############################################
        # 現在時刻からアクセストークンの有効期間の分だけ伸ばす
        expire=get_current_time() + access_token_duration,
        ########################################################################
        scopes=access_token_payload.scopes,
        role=access_token_payload.role
    )
    new_access_token: str = jwt.encode(
        payload=new_access_token_payload.model_dump(), key=SECRET_KEY, algorithm=ALGORITHM
    )

    # 新しいトークンペアをLoginHistoryに登録 + refresh_countを1加算
    login_history.logout_at = new_access_token_payload.expire
    login_history.refresh_count += 1
    authorize.update_login_history(db=db, login_history_record=login_history)

    return response.Token(
        access_token=new_access_token,
        token_type="bearer",
        login_time=login_at,
        user_id=user_id,
        role=access_token_payload.role,
        refresh_count=login_history.refresh_count,
    )


@router.post("/token/validate", response_model=response.TokenValidateResponse)
async def validate_token(
    db: Annotated[Session, Depends(get_db)],
    token: str = Depends(oauth2_scheme),
) -> response.TokenValidateResponse:
    # アクセストークンをデコードする
    token_payload = decode_token(token=token)

    # 有効期限が過ぎているのなら、False, 過ぎていないならTrue
    if is_past(token_payload.expire):
        return response.TokenValidateResponse(is_valid=False)
    
    # ログイン履歴を取得する
    login_history = authorize.get_login_history(
        db=db, user_id=token_payload.sub, login_at=token_payload.login
    )

    # ログイン履歴が存在しない場合、False
    if login_history is None:
        return response.TokenValidateResponse(is_valid=False)
    
    # ログイン履歴が存在する場合、True
    return response.TokenValidateResponse(is_valid=True)


@router.post("/logout")
async def logout(
    response: Response,
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme),
):
    # アクセストークンをデコードする
    access_token_payload = decode_token(token=token)

    # 該当するLoginHistoryを削除
    authorize.remove_login_history(
        db=db, user_id=access_token_payload.sub, login_at=access_token_payload.login
    )

    # クッキーからrefresh_tokenを削除
    response.delete_cookie(key="refresh_token")
    return {"msg": "ログアウトしました。"}
