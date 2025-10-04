from .crud.db.__init__ import SessionLocal
import tempfile
from pathlib import Path
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
