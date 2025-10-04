import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.classes.schemas import UserRecord, Role
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.classes.models import Base
from app.api.api_v1.endpoints import authenticate_util
from app import constants
from app.crud.db.users import create_user, admin_user_exists

DATABASE_URL = f"mysql+pymysql://{constants.DATABASE_USER}:{constants.DATABASE_PASSWORD}@{constants.DATABASE_HOST}/{constants.DATABASE_NAME}"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)
logging.basicConfig(level=logging.DEBUG)


def init_db():
    db = SessionLocal()
    try:
        if admin_user_exists(db):
            db.close()
            return
        
        create_user(
            db=db,
            user = UserRecord(
                user_id=constants.ADMIN_USER_ID,
                username=constants.ADMIN_USER,
                email=constants.ADMIN_EMAIL,
                hashed_password=authenticate_util.get_password_hash(constants.ADMIN_PASSWORD),
                role=Role.admin,
                disabled=False,
                created_at=datetime.now(),
                updated_at=datetime.now(),
                active_start_date=datetime.fromisoformat(constants.ADMIN_START_DATE),
                active_end_date=datetime.fromisoformat(constants.ADMIN_END_DATE),
            )
        )
            
    except Exception as e:
        logging.error(f"Error initializing database: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    init_db()
