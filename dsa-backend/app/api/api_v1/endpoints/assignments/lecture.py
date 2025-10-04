from app.crud.db import assignments
from fastapi import APIRouter, Depends, HTTPException, status, Query, Security
from app.api.api_v1.endpoints import authenticate_util
from app.classes import schemas, response
from app.dependencies import get_db
from sqlalchemy.orm import Session
from typing import Annotated
import logging
logging.basicConfig(level=logging.DEBUG)

router = APIRouter()

@router.delete("/delete")
async def delete_lecture(
    lecture_id: Annotated[int, Query(description="削除対象の授業ID")],
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[schemas.UserRecord, Security(authenticate_util.get_current_active_user, scopes=["batch"])]
) -> response.Message:
    """
    課題エントリの削除API
    """
    
    if assignments.get_lecture(db, lecture_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="指定された課題エントリが存在しません")
    
    assignments.delete_lecture(db, lecture_id)
    
    return response.Message(message="課題エントリを削除しました")
