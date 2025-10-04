# ref: https://medium.com/@iambkpl/setup-fastapi-and-sqlalchemy-mysql-986419dbffeb
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()
import os
DB_URL = os.getenv("DB_URL")
engine = create_engine(DB_URL,echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
