from pydantic import BaseModel, Field, field_serializer
from datetime import datetime
from typing import List, Optional, Dict, Literal
from enum import Enum
import logging

logging.basicConfig(level=logging.DEBUG)


class SubmissionProgressStatus(Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"


# 実行結果の集約をするための、順序定義
# 各テストケースの実行結果が、["AC", "WA", "AC", "TLE"]の場合、
# 全体の結果はmaxを取って"TLE"となる。
JudgeStatusOrder: Dict[str, int] = {
    # (value) : (order)
    "AC": 0,  # Accepted
    "WA": 1,  # Wrong Answer
    "TLE": 2,  # Time Limit Exceed
    "MLE": 3,  # Memory Limit Exceed
    "RE": 4,  # Runtime Error
    "CE": 5,  # Compile Error
    "OLE": 6,  # Output Limit Exceed (8000 bytes)
    "IE": 7,  # Internal Error (e.g., docker sandbox management)
    "FN": 8,  # File Not found
}


class BaseJudgeStatusWithOrder(Enum):
    def __str__(self):
        return self.name

    def __lt__(self, other):
        if self.__class__ is other.__class__:
            return JudgeStatusOrder[self.value] < JudgeStatusOrder[other.value]
        return NotImplemented

    def __gt__(self, other):
        if self.__class__ is other.__class__:
            return JudgeStatusOrder[self.value] > JudgeStatusOrder[other.value]
        return NotImplemented

    def __le__(self, other):
        if self.__class__ is other.__class__:
            return JudgeStatusOrder[self.value] <= JudgeStatusOrder[other.value]
        return NotImplemented

    def __ge__(self, other):
        if self.__class__ is other.__class__:
            return JudgeStatusOrder[self.value] >= JudgeStatusOrder[other.value]
        return NotImplemented


class SingleJudgeStatus(BaseJudgeStatusWithOrder):
    AC = "AC"  # Accepted
    WA = "WA"  # Wrong Answer
    TLE = "TLE"  # Time Limit Exceed
    MLE = "MLE"  # Memory Limit Exceed
    RE = "RE"  # Runtime Error
    CE = "CE"  # Compile Error
    OLE = "OLE"  # Output Limit Exceed (8000 bytes)
    IE = "IE"  # Internal Error (e.g., docker sandbox management)


class SubmissionSummaryStatus(BaseJudgeStatusWithOrder):
    AC = "AC"  # Accepted
    WA = "WA"  # Wrong Answer
    TLE = "TLE"  # Time Limit Exceed
    MLE = "MLE"  # Memory Limit Exceed
    RE = "RE"  # Runtime Error
    CE = "CE"  # Compile Error
    OLE = "OLE"  # Output Limit Exceed (8000 bytes)
    IE = "IE"  # Internal Error (e.g., docker sandbox management)
    FN = "FN"  # File Not found

######################## DBからのマッピング用スキーマ ###############################

class Lecture(BaseModel):
    id: int
    title: str
    start_date: datetime
    end_date: datetime

    problems: list["Problem"] = Field(default_factory=list)

    model_config = {
        "from_attributes": True
    }

    @field_serializer("start_date")
    def serialize_start_date(self, start_date: datetime, _info):
        return start_date.isoformat()

    @field_serializer("end_date")
    def serialize_end_date(self, end_date: datetime, _info):
        return end_date.isoformat()


class Problem(BaseModel):
    lecture_id: int
    assignment_id: int
    title: str
    description_path: str
    timeMS: int
    memoryMB: int

    executables: list["Executables"] = Field(default_factory=list)
    arranged_files: list["ArrangedFiles"] = Field(default_factory=list)
    required_files: list["RequiredFiles"] = Field(default_factory=list)
    test_cases: list["TestCases"] = Field(default_factory=list)

    model_config = {
        "from_attributes": True
    }


class ProblemZipPath(BaseModel):
    id: int = Field(default=0)
    ts: datetime = Field(default=datetime(year=1998, month=6, day=6))
    lecture_id: int
    assignment_id: int
    zip_path: str

    model_config = {
        "from_attributes": True
    }


class Executables(BaseModel):
    id: int = Field(default=0)
    lecture_id: int
    assignment_id: int
    eval: bool
    name: str

    model_config = {
        "from_attributes": True
    }


class ArrangedFiles(BaseModel):
    id: int = Field(default=0)
    lecture_id: int
    assignment_id: int
    eval: bool
    path: str

    model_config = {
        "from_attributes": True
    }


class RequiredFiles(BaseModel):
    id: int = Field(default=0)
    lecture_id: int
    assignment_id: int
    name: str

    model_config = {
        "from_attributes": True
    }


class EvaluationType(Enum):
    Built = "Built"
    Judge = "Judge"


class TestCases(BaseModel):
    id: int = Field(default=0)
    lecture_id: int
    assignment_id: int
    eval: bool
    type: EvaluationType
    score: int
    title: str
    description: str | None
    message_on_fail: str | None
    command: str
    args: str | None
    stdin_path: str | None
    stdout_path: str | None
    stderr_path: str | None
    exit_code: int

    model_config = {
        "from_attributes": True
    }

    @field_serializer("type")
    def serialize_type(self, type: EvaluationType, _info):
        return type.value


class BatchSubmission(BaseModel):
    id: int = Field(default=0)
    ts: datetime = Field(default=datetime(year=1998, month=6, day=6))
    user_id: str
    lecture_id: int
    message: str | None
    complete_judge: int | None
    total_judge: int | None

    evaluation_statuses: list["EvaluationStatus"] = Field(default_factory=list)

    model_config = {
        "from_attributes": True
    }

    @field_serializer("ts")
    def serialize_ts(self, ts: datetime, _info):
        return ts.isoformat()


class StudentSubmissionStatus(Enum):
    SUBMITTED = "submitted"
    DELAY = "delay"
    NON_SUBMITTED = "non-submitted"


class EvaluationStatus(BaseModel):
    id: int = Field(default=0)
    batch_id: int
    user_id: str
    status: StudentSubmissionStatus
    result: SubmissionSummaryStatus | None = Field(default=None)
    upload_dir: str | None = Field(default=None)
    report_path: str | None = Field(default=None)
    submit_date: datetime | None = Field(default=None)

    # 該当学生の各課題の採点結果のリスト(SubmissionSummaryテーブルから取得)
    submissions: list["Submission"] = Field(default_factory=list)

    model_config = {
        "from_attributes": True
    }

    @field_serializer("status")
    def serialize_status(self, status: StudentSubmissionStatus, _info):
        return status.value

    @field_serializer("result")
    def serialize_result(self, result: SubmissionSummaryStatus, _info):
        return result.value if result is not None else None

    @field_serializer("submit_date")
    def serialize_submit_date(self, submit_date: datetime | None, _info):
        return submit_date.isoformat() if submit_date is not None else None


class Submission(BaseModel):
    id: int = Field(default=0)
    ts: datetime = Field(default=datetime(year=1998, month=6, day=6))
    evaluation_status_id: int | None = Field(default=None)
    user_id: str
    lecture_id: int
    assignment_id: int
    eval: bool
    upload_dir: str
    progress: SubmissionProgressStatus
    total_task: int = Field(default=0)
    completed_task: int = Field(default=0)
    result: SubmissionSummaryStatus | None = Field(default=None)
    message: str | None = Field(default=None)
    detail: str | None = Field(default=None)
    score: int | None = Field(default=None)
    timeMS: int | None = Field(default=None)
    memoryKB: int | None = Field(default=None)

    problem: Problem | None = Field(default=None)

    judge_results: list["JudgeResult"] = Field(default_factory=list)

    model_config = {
        # sqlalchemyのレコードデータからマッピングするための設定
        "from_attributes": True
    }

    @field_serializer("ts")
    def serialize_ts(self, ts: datetime, _info):
        return ts.isoformat()

    @field_serializer("progress")
    def serialize_progress(self, progress: SubmissionProgressStatus, _info):
        return progress.value

    @field_serializer("result")
    def serialize_result(self, result: SubmissionSummaryStatus, _info):
        return result.value if result is not None else None


class JudgeResult(BaseModel):
    id: int = Field(default=0)
    submission_id: int
    testcase_id: int
    result: SingleJudgeStatus
    command: str
    timeMS: int
    memoryKB: int
    exit_code: int
    stdout: str
    stderr: str

    testcase: TestCases | None = Field(default=None)

    model_config = {
        "from_attributes": True
    }

    @field_serializer("result")
    def serialize_result(self, result: SingleJudgeStatus, _info):
        return result.value


class LoginHistory(BaseModel):
    user_id: str
    login_at: datetime
    logout_at: datetime
    refresh_count: int

    model_config = {
        # sqlalchemyのレコードデータからマッピングするための設定
        "from_attributes": True
    }

    @field_serializer("login_at")
    def serialize_login_at(self, login_at: datetime, _info):
        return login_at.isoformat()

    @field_serializer("logout_at")
    def serialize_logout_at(self, logout_at: datetime, _info):
        return logout_at.isoformat()


class Role(Enum):
    admin = "admin"
    manager = "manager"
    student = "student"


class UserRecord(BaseModel):
    user_id: str = Field(max_length=255)
    username: str = Field(max_length=255)
    email: str = Field(max_length=255)
    hashed_password: str = Field(max_length=255)
    role: Role
    disabled: bool
    created_at: datetime
    updated_at: datetime
    active_start_date: datetime
    active_end_date: datetime

    @field_serializer("role")
    def serialize_role(self, role: Role, _info):
        return role.value

    model_config = {
        # sqlalchemyのレコードデータからマッピングするための設定
        "from_attributes": True
    }

################################################################################

class UserCreate(BaseModel):
    user_id: str
    username: str
    email: str
    plain_password: str  # 暗号化前のパスワード
    role: Role
    disabled: bool = False
    active_start_date: Optional[datetime] = None
    active_end_date: Optional[datetime] = None


class UserDelete(BaseModel):
    user_ids: List[str]


class UserUpdatePassword(BaseModel):
    user_id: str
    plain_password: str
    new_plain_password: str = Field(min_length=6, max_length=50)


# JWTトークンのペイロード({"sub": ..., "login": ...,...)})
class JWTTokenPayload(BaseModel):
    sub: str = Field(max_length=255)
    login: datetime
    expire: datetime
    scopes: list[str] = Field(default_factory=list)
    role: Role

    model_config = {
        # JWTトークンのdict型からJWTTokenPayloadへ変換するための設定
        "from_attributes": True
    }

    # dict型に変換するときに、mysqlのDATETIMEフォーマットに合わせるためのシリアライズ関数
    @field_serializer("login", "expire")
    def serialize_datetime_fields(self, dt: datetime, _info):
        return dt.strftime("%Y-%m-%d %H:%M:%S")

    @field_serializer("role")
    def serialize_role(self, role: Role, _info):
        return role.value
