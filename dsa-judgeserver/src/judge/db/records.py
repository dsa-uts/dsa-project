from pydantic import BaseModel, Field, field_serializer
from datetime import datetime
from enum import Enum


class SubmissionProgressStatus(Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"


# 実行結果の集約をするための、順序定義
# 各テストケースの実行結果が、["AC", "WA", "AC", "TLE"]の場合、
# 全体の結果はmaxを取って"TLE"となる。
JudgeStatusOrder: dict[str, int] = {
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
    
    executables: list["Executables"]
    arranged_files: list["ArrangedFiles"]
    required_files: list["RequiredFiles"]
    test_cases: list["TestCases"]
    
    model_config = {
        "from_attributes": True
    }


class Executables(BaseModel):
    id: int
    lecture_id: int
    assignment_id: int
    eval: bool
    name: str
    
    model_config = {
        "from_attributes": True
    }


class ArrangedFiles(BaseModel):
    id: int
    lecture_id: int
    assignment_id: int
    eval: bool
    path: str
    
    model_config = {
        "from_attributes": True
    }


class RequiredFiles(BaseModel):
    id: int
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
    id: int
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


class Submission(BaseModel):
    id: int
    ts: datetime
    evaluation_status_id: int | None
    user_id: str
    lecture_id: int
    assignment_id: int
    eval: bool
    upload_dir: str
    progress: SubmissionProgressStatus
    total_task: int = Field(default=0)
    completed_task: int = Field(default=0)
    result: SubmissionSummaryStatus | None
    message: str | None
    detail: str | None
    score: int | None
    timeMS: int | None
    memoryKB: int | None
    
    problem: Problem
    
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
    
    model_config = {
        "from_attributes": True
    }
    
    @field_serializer("result")
    def serialize_result(self, result: SingleJudgeStatus, _info):
        return result.value

