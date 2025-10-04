from fastapi import APIRouter
from . import info
from . import judge
from . import batch
from . import status
from . import result
from . import problem
from . import lecture

############## /api/v1/assignments/...以下のエンドポイントの定義 ####################
router = APIRouter()
router.include_router(info.router, prefix="/info", tags=["info"])
router.include_router(judge.router, prefix="/judge", tags=["judge"])
router.include_router(batch.router, prefix="/batch", tags=["batch"])
router.include_router(status.router, prefix="/status", tags=["status"])
router.include_router(result.router, prefix="/result", tags=["result"])
router.include_router(problem.router, prefix="/problem", tags=["problem"])
router.include_router(lecture.router, prefix="/lecture", tags=["lecture"])
################################################################################
