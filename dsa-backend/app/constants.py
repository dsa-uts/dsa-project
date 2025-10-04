import os
from dotenv import load_dotenv

load_dotenv()

# --- データベース関連 ---
DATABASE_USER = os.getenv("DATABASE_USER")
DATABASE_PASSWORD = os.getenv("DATABASE_PASSWORD")
DATABASE_HOST = os.getenv("DATABASE_HOST")
DATABASE_NAME = os.getenv("DATABASE_NAME")

ADMIN_USER_ID = os.getenv("INIT_ADMIN_USER_ID")
ADMIN_USER = os.getenv("INIT_ADMIN_USER")
ADMIN_EMAIL = os.getenv("INIT_ADMIN_EMAIL")
ADMIN_PASSWORD = os.getenv("INIT_ADMIN_PASSWORD")
ADMIN_START_DATE = os.getenv("INIT_ADMIN_START_DATE")
ADMIN_END_DATE = os.getenv("INIT_ADMIN_END_DATE")

ENV = os.getenv("ENV")

# --- パス関連 ---
UPLOAD_DIR = os.getenv("UPLOAD_DIR_PATH", "/upload")

RESOURCE_DIR = os.getenv("RESOURCE_DIR_PATH", "/resource")