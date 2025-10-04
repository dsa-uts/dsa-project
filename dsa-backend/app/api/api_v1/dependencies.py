from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from dotenv import load_dotenv
import os

load_dotenv()

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/v1/authorize/token",
    scopes={
        # Admin用
        "account": "CRUD of user account",
        # Manager用
        "view_users": "view user list",
        "batch": "batch submission & view of summary",
        # 全員
        "me": "view my information"
    }
)

SCOPES = {
    "admin": ["batch", "account", "view_users", "me"],
    "manager": ["batch", "view_users", "me"],
    "student": ["me"]
}

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES"))
REFRESH_TOKEN_EXPIRE_MINUTES = int(os.getenv("REFRESH_TOKEN_EXPIRE_HOURS")) * 60

USER_REGISTERATION_PASSWORD = os.getenv("USER_REGISTERATION_PASSWORD")
