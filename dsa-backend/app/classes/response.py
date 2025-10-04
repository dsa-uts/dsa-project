from pydantic import BaseModel, Field, field_serializer, field_validator, ValidationInfo, model_validator
from datetime import datetime
from typing import List, Optional, Dict, Literal
from enum import Enum
import logging
from app.classes.schemas import EvaluationType, StudentSubmissionStatus, SubmissionSummaryStatus, SubmissionProgressStatus, SingleJudgeStatus, Role

logging.basicConfig(level=logging.DEBUG)


class Message(BaseModel):
    message: str

    model_config = {"extra": "allow"}


class Lecture(BaseModel):
    id: int
    title: str
    start_date: datetime
    end_date: datetime
    
    problems: list["Problem"] = Field(default_factory=list)
    
    model_config = {"from_attributes": True}
    
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
    # description_pathはレスポンスには含めない。
    timeMS: int
    memoryMB: int
    
    detail: Optional["ProblemDetail"] = Field(default=None)

    model_config = {"from_attributes": True}


class ProblemDetail(BaseModel):
    description: str | None = Field(default=None) # description_pathをファイルから読み込んだ文字列
    
    executables: list["Executables"] = Field(default_factory=list)
    # arranged_filesは読み込まない、別途ZIPファイルで返す
    required_files: list["RequiredFiles"] = Field(default_factory=list)
    test_cases: list["TestCases"] = Field(default_factory=list)
    
    model_config = {"from_attributes": True}
    
    @field_validator("description")
    def get_description_from_context(cls, value: str | None, info: ValidationInfo) -> str:
        if info.context is not None and "description" in info.context:
            return info.context["description"]
        else:
            raise ValueError("description is not set")


class Executables(BaseModel):
    eval: bool
    name: str

    model_config = {"from_attributes": True}


class RequiredFiles(BaseModel):
    name: str

    model_config = {"from_attributes": True}


class TestCases(BaseModel):
    id: int
    eval: bool
    type: EvaluationType
    score: int
    title: str
    description: str | None
    command: str
    args: str | None
    stdin: str | None = Field(default=None) # response時にファイルから読み込む
    stdout: str | None = Field(default=None) # response時にファイルから読み込む
    stderr: str | None = Field(default=None) # response時にファイルから読み込む
    exit_code: int
    
    model_config = {"from_attributes": True}

    @field_serializer("type")
    def serialize_type(self, type: EvaluationType, _info):
        return type.value


class BatchSubmission(BaseModel):
    id: int
    ts: datetime
    user_id: str
    lecture_id: int
    message: str | None
    status: Literal["queued", "running", "done"] = Field(default="queued")
    complete_judge: int | None
    total_judge: int | None
    
    evaluation_statuses: list["EvaluationStatus"] = Field(default_factory=list)
    
    model_config = {"from_attributes": True}
    
    @field_serializer("ts")
    def serialize_ts(self, ts: datetime, _info):
        return ts.isoformat()
    
    @model_validator(mode='after')
    def set_status(self):
        if self.complete_judge is None or self.total_judge is None:
            self.status = "queued"
        elif self.complete_judge == self.total_judge:
            self.status = "done"
        else:
            self.status = "running"
        return self

class BatchSubmissionItemForListView(BaseModel):
    id: int
    ts: datetime
    user_id: str
    username: str
    lecture_id: int
    lecture_title: str
    message: str | None
    status: Literal["queued", "running", "done"] = Field(default="queued")
    complete_judge: int | None
    total_judge: int | None
    
    evaluation_statuses: list["EvaluationStatus"] = Field(default_factory=list)
    
    model_config = {"from_attributes": True}
    
    @field_serializer("ts")
    def serialize_ts(self, ts: datetime, _info):
        return ts.isoformat()
    
    @model_validator(mode='after')
    def set_status(self):
        if self.complete_judge is None or self.total_judge is None:
            self.status = "queued"
        elif self.complete_judge == self.total_judge:
            self.status = "done"
        else:
            self.status = "running"
        return self

class BatchSubmissionItemsForListView(BaseModel):
    items: list[BatchSubmissionItemForListView] = Field(default_factory=list)
    total_items: int
    current_page: int
    total_pages: int
    page_size: int

    model_config = {"from_attributes": True}

# detailのページのサマリー的なもの．
class BatchSubmissionDetailItem(BaseModel):
    id: int
    ts: datetime
    user_id: str
    username: str
    lecture_id: int
    lecture: Lecture
    message: str | None
    status: Literal["queued", "running", "done"] = Field(default="queued")
    complete_judge: int | None
    total_judge: int | None
    
    evaluation_statuses: list["EvaluationStatus"] = Field(default_factory=list)
    
    model_config = {"from_attributes": True}
    
    @field_serializer("ts")
    def serialize_ts(self, ts: datetime, _info):
        return ts.isoformat()
    
    @model_validator(mode='after')
    def set_status(self):
        if self.complete_judge is None or self.total_judge is None:
            self.status = "queued"
        elif self.complete_judge == self.total_judge:
            self.status = "done"
        else:
            self.status = "running"
        return self

# バッチ採点の各ユーザの採点結果
class EvaluationStatus(BaseModel):
    id: int = Field(default=0)
    batch_id: int
    user_id: str
    username: str
    lecture_id: int
    lecture: Lecture
    status: StudentSubmissionStatus
    result: SubmissionSummaryStatus | None = Field(default=None)
    # BatchSubmissionSummaryテーブルのupload_dirがNULLじゃない場合はTrue
    upload_file_exists: bool = Field(default=False)
    # BatchSubmissionSummaryテーブルのreport_pathがNULLじゃない場合はTrue
    report_exists: bool = Field(default=False)
    submit_date: datetime | None
    
    # batch_submission: BatchSubmission | None = Field(default=None)
    
    # 該当学生の各課題の採点結果のリスト(SubmissionSummaryテーブルから取得してcontextで渡される)
    submissions: list["Submission"] = Field(default_factory=list)
    
    model_config = {"from_attributes": True}
    
    @field_serializer("status")
    def serialize_status(self, status: StudentSubmissionStatus, _info):
        return status.value
    
    @field_serializer("result")
    def serialize_result(self, result: SubmissionSummaryStatus | None, _info):
        return result.value if result is not None else None
    
    @field_serializer("submit_date")
    def serialize_submit_date(self, submit_date: datetime | None, _info):
        return submit_date.isoformat() if submit_date is not None else None

# 各学生の各小課題の結果
class Submission(BaseModel):
    id: int = Field(default=0)
    ts: datetime = Field(default=datetime(year=1998, month=6, day=6))
    evaluation_status_id: int | None = Field(default=None)
    user_id: str
    lecture_id: int
    assignment_id: int
    eval: bool
    progress: SubmissionProgressStatus
    total_task: int
    completed_task: int
    result: SubmissionSummaryStatus | None = Field(default=None)
    message: str | None = Field(default=None)
    detail: str | None = Field(default=None)
    score: int | None = Field(default=None)
    timeMS: int | None = Field(default=None)
    memoryKB: int | None = Field(default=None)

    # uploaded_filesはResponseでは返さない。別のFileResponse(ZIP)で内容ごと返す
    
    judge_results: list["JudgeResult"] = Field(default_factory=list)
    
    model_config = {"from_attributes": True}
    
    @field_serializer("result")
    def serialize_result(self, result: SubmissionSummaryStatus | None, _info):
        return result.value if result is not None else None
    
    @field_serializer("ts")
    def serialize_ts(self, ts: datetime, _info):
        return ts.isoformat()
    
    @field_serializer("progress")
    def serialize_progress(self, progress: SubmissionProgressStatus, _info):
        return progress.value


class JudgeResult(BaseModel):
    id: int = Field(default=0)
    submission_id: int
    testcase_id: int
    result: SingleJudgeStatus
    command: str
    timeMS: int
    memoryKB: int
    exit_code: int
    stdout: str # DBに生のデータが入っているので、ファイルからは読み込まない
    stderr: str # DBに生のデータが入っているので、ファイルからは読み込まない
    
    model_config = {"from_attributes": True}
    
    @field_serializer("result")
    def serialize_result(self, result: SingleJudgeStatus, _info):
        return result.value


class User(BaseModel):
    user_id: str
    username: str
    email: str
    role: Role
    disabled: bool
    created_at: datetime
    updated_at: datetime
    active_start_date: datetime | None
    active_end_date: datetime | None

    model_config = {"from_attributes": True}
    
    @field_serializer("role")
    def serialize_role(self, role: Role, _info):
        return role.value

    @field_serializer("active_start_date", "active_end_date")
    def serialize_datetime(self, dt: datetime | None, _info):
        return dt.isoformat() if dt is not None else None


class TokenValidateResponse(BaseModel):
    is_valid: bool


class Token(BaseModel):
    access_token: str
    token_type: str
    login_time: datetime
    user_id: str
    role: Role
    refresh_count: int = Field(default=0)

    @field_serializer("role")
    def serialize_role(self, role: Role, _info):
        return role.value

    @field_serializer("login_time")
    def serialize_login_time(self, login_time: datetime, _info):
        return login_time.isoformat()
