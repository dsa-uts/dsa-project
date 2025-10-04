from ...api.api_v1.dependencies import (
    pwd_context,
    SECRET_KEY,
    ALGORITHM,
)
from typing import Union, Optional, Tuple
from datetime import datetime, timedelta
import jwt
from jwt.exceptions import InvalidTokenError
from sqlalchemy.orm import Session
from app.classes import models, schemas
from pydantic import ValidationError
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
import pytz
from fastapi import HTTPException, status
import logging

logging.basicConfig(level=logging.DEBUG)

tokyo_tz = pytz.timezone("Asia/Tokyo")

def get_login_history(db: Session, user_id: str, login_at: datetime) -> schemas.LoginHistory | None:
    raw_login_history = db.query(models.LoginHistory).filter(
        models.LoginHistory.user_id == user_id,
        models.LoginHistory.login_at == login_at
    ).first()
    if raw_login_history is not None:
        return schemas.LoginHistory.model_validate(raw_login_history)
    return None


def add_login_history(db: Session, login_history_record: schemas.LoginHistory) -> None:
    db.add(models.LoginHistory(**login_history_record.model_dump()))
    db.commit()


def update_login_history(db: Session, login_history_record: schemas.LoginHistory) -> None:
    raw_login_history = db.query(models.LoginHistory).filter(
        models.LoginHistory.user_id == login_history_record.user_id,
        models.LoginHistory.login_at == login_history_record.login_at
    ).first()
    if raw_login_history is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ログイン履歴の取得に失敗しました"
        )
    
    raw_login_history.logout_at = login_history_record.logout_at
    raw_login_history.refresh_count = login_history_record.refresh_count
    db.commit()


def remove_login_history(db: Session, user_id: str, login_at: datetime) -> None:
    try:
        db.query(models.LoginHistory).filter(
            models.LoginHistory.user_id == user_id,
            models.LoginHistory.login_at == login_at
        ).delete()
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ログイン履歴の削除中にエラーが発生しました"
        )
