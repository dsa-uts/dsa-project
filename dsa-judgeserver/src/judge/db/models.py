from sqlalchemy import (
    Integer,
    String,
    Boolean,
    DateTime,
    Enum,
    text,
    ForeignKey,
)
from sqlalchemy.orm import (
    relationship, Mapped, DeclarativeBase, mapped_column
)
from typing import List
from datetime import datetime

class Base(DeclarativeBase):
    pass

class Lecture(Base):
    __tablename__ = "Lecture"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    start_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    
    # Lectureレコードと1-N関係にあるProblemレコードへの参照
    problems: Mapped[List["Problem"]] = relationship(back_populates="lecture")


class Problem(Base):
    __tablename__ = "Problem"
    lecture_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("Lecture.id"), primary_key=True, nullable=False
    )
    assignment_id: Mapped[int] = mapped_column(Integer, primary_key=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description_path: Mapped[str] = mapped_column(String(255), nullable=False)
    timeMS: Mapped[int] = mapped_column(Integer, nullable=False)
    memoryMB: Mapped[int] = mapped_column(Integer, nullable=False)
    
    # Problemレコードと1-NまたはN-1関係にあるレコードへの参照
    lecture: Mapped["Lecture"] = relationship(back_populates="problems")
    # 複合Primaryキーや複合Foreignキーを使用している場合、primaryjoinを指定しないと
    # relationshipが機能しないため、primaryjoinを指定する
    executables: Mapped[List["Executables"]] = relationship(back_populates="problem", 
                                                            primaryjoin=(
                                                                "and_(Problem.lecture_id == Executables.lecture_id, "
                                                                "Problem.assignment_id == Executables.assignment_id)"
                                                            ))
    arranged_files: Mapped[List["ArrangedFiles"]] = relationship(back_populates="problem", 
                                                                primaryjoin=(
                                                                    "and_(Problem.lecture_id == ArrangedFiles.lecture_id, "
                                                                    "Problem.assignment_id == ArrangedFiles.assignment_id)"
                                                                ))
    required_files: Mapped[List["RequiredFiles"]] = relationship(back_populates="problem", 
                                                                primaryjoin=(
                                                                    "and_(Problem.lecture_id == RequiredFiles.lecture_id, "
                                                                    "Problem.assignment_id == RequiredFiles.assignment_id)"
                                                                ))
    test_cases: Mapped[List["TestCases"]] = relationship(back_populates="problem", 
                                                        primaryjoin=(
                                                            "and_(Problem.lecture_id == TestCases.lecture_id, "
                                                            "Problem.assignment_id == TestCases.assignment_id)"
                                                        ))


class Executables(Base):
    __tablename__ = "Executables"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lecture_id: Mapped[int] = mapped_column(Integer, ForeignKey("Problem.lecture_id"))
    assignment_id: Mapped[int] = mapped_column(Integer, ForeignKey("Problem.assignment_id"))
    eval: Mapped[bool] = mapped_column(Boolean, default=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    problem: Mapped["Problem"] = relationship(back_populates="executables", 
                                                primaryjoin=(
                                                    "and_(Problem.lecture_id == Executables.lecture_id, "
                                                    "Problem.assignment_id == Executables.assignment_id)"
                                                ),
                                                foreign_keys=[lecture_id, assignment_id]
                                                )


class ArrangedFiles(Base):
    __tablename__ = "ArrangedFiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lecture_id: Mapped[int] = mapped_column(Integer, ForeignKey("Problem.lecture_id"))
    assignment_id: Mapped[int] = mapped_column(Integer, ForeignKey("Problem.assignment_id"))
    eval: Mapped[bool] = mapped_column(Boolean, default=False)
    path: Mapped[str] = mapped_column(String(255), nullable=False)
    problem: Mapped["Problem"] = relationship(back_populates="arranged_files", 
                                                primaryjoin=(
                                                    "and_(Problem.lecture_id == ArrangedFiles.lecture_id, "
                                                    "Problem.assignment_id == ArrangedFiles.assignment_id)"
                                                ),
                                                foreign_keys=[lecture_id, assignment_id]
                                                )


class RequiredFiles(Base):
    __tablename__ = "RequiredFiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lecture_id: Mapped[int] = mapped_column(Integer, ForeignKey("Problem.lecture_id"))
    assignment_id: Mapped[int] = mapped_column(Integer, ForeignKey("Problem.assignment_id"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    problem: Mapped["Problem"] = relationship(back_populates="required_files", 
                                                primaryjoin=(
                                                    "and_(Problem.lecture_id == RequiredFiles.lecture_id, "
                                                    "Problem.assignment_id == RequiredFiles.assignment_id)"
                                                ),
                                                foreign_keys=[lecture_id, assignment_id]
                                                )


class TestCases(Base):
    __tablename__ = "TestCases"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lecture_id: Mapped[int] = mapped_column(Integer, ForeignKey("Problem.lecture_id"))
    assignment_id: Mapped[int] = mapped_column(Integer, ForeignKey("Problem.assignment_id"))
    eval: Mapped[bool] = mapped_column(Boolean, default=False)
    type: Mapped[str] = mapped_column(Enum("Built", "Judge"), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String)
    message_on_fail: Mapped[str] = mapped_column(String(255))
    command: Mapped[str] = mapped_column(String(255), nullable=False)
    args: Mapped[str] = mapped_column(String(255))
    stdin_path: Mapped[str] = mapped_column(String(255))
    stdout_path: Mapped[str] = mapped_column(String(255))
    stderr_path: Mapped[str] = mapped_column(String(255))
    exit_code: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    problem: Mapped["Problem"] = relationship(back_populates="test_cases", 
                                                primaryjoin=(
                                                    "and_(Problem.lecture_id == TestCases.lecture_id, "
                                                    "Problem.assignment_id == TestCases.assignment_id)"
                                                ),
                                                foreign_keys=[lecture_id, assignment_id]
                                                )


class Users(Base):
    __tablename__ = "Users"
    user_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    username: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(Enum("admin", "manager", "student"), nullable=False)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=text("CURRENT_TIMESTAMP"),
    )
    active_start_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    active_end_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class LoginHistory(Base):
    __tablename__ = "LoginHistory"
    user_id: Mapped[str] = mapped_column(
        String(255), ForeignKey("Users.user_id"), primary_key=True, nullable=False
    )
    login_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, primary_key=True)
    logout_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    refresh_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class BatchSubmission(Base):
    __tablename__ = "BatchSubmission"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))
    user_id: Mapped[str] = mapped_column(String(255), ForeignKey("Users.user_id"))
    lecture_id: Mapped[int] = mapped_column(Integer, ForeignKey("Lecture.id"), nullable=False)
    message: Mapped[str] = mapped_column(String(255), nullable=True)
    complete_judge: Mapped[int] = mapped_column(Integer, nullable=True)
    total_judge: Mapped[int] = mapped_column(Integer, nullable=True)
    
    # BatchSubmissionレコードと1-N関係にあるEvaluationStatusレコードへの参照
    evaluation_statuses: Mapped[List["EvaluationStatus"]] = relationship(back_populates="batch_submission")


class EvaluationStatus(Base):
    __tablename__ = "EvaluationStatus"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(Integer, ForeignKey("BatchSubmission.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(255), ForeignKey("Users.user_id"), nullable=False) # 採点対象の学生のID
    status: Mapped[str] = mapped_column(Enum("submitted", "delay", "non-submitted"), nullable=False)
    result: Mapped[str] = mapped_column(Enum("AC", "WA", "TLE", "MLE", "RE", "CE", "OLE", "IE", "FN"), nullable=True, default=None)
    upload_dir: Mapped[str] = mapped_column(String(255), nullable=True, default=None)
    report_path: Mapped[str] = mapped_column(String(255), nullable=True, default=None)
    submit_date: Mapped[datetime] = mapped_column(DateTime, nullable=True, default=None)
    
    batch_submission: Mapped["BatchSubmission"] = relationship(back_populates="evaluation_statuses")
    
    # EvaluationStatusレコードと1-N関係にあるSubmissionレコードへの参照
    submissions: Mapped[List["Submission"]] = relationship()


class Submission(Base):
    __tablename__ = "Submission"
    id: Mapped[int] = mapped_column(Integer,primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))
    evaluation_status_id: Mapped[int] = mapped_column(Integer, ForeignKey("EvaluationStatus.id"), default=None)
    user_id: Mapped[str] = mapped_column(String(255), ForeignKey("Users.user_id"), nullable=False)
    lecture_id: Mapped[int] = mapped_column(Integer, ForeignKey("Problem.lecture_id"), nullable=False)
    assignment_id: Mapped[int] = mapped_column(Integer, ForeignKey("Problem.assignment_id"), nullable=False)
    eval: Mapped[bool] = mapped_column(Boolean, nullable=False)
    upload_dir: Mapped[str] = mapped_column(String(255), nullable=False)
    progress: Mapped[str] = mapped_column(Enum("pending", "queued", "running", "done"), default="pending")
    total_task: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_task: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    result: Mapped[str] = mapped_column(Enum("AC", "WA", "TLE", "MLE", "RE", "CE", "OLE", "IE", "FN"), nullable=True, default=None)
    message: Mapped[str] = mapped_column(String(255), nullable=True, default=None)
    detail: Mapped[str] = mapped_column(String(255), nullable=True, default=None)
    score: Mapped[int] = mapped_column(Integer, nullable=True, default=None)
    timeMS: Mapped[int] = mapped_column(Integer, nullable=True, default=None)
    memoryKB: Mapped[int] = mapped_column(Integer, nullable=True, default=None)
    
    # Submissionレコードと1-1関係(他方から見たら1-N関係)にあるProblemレコードへの参照
    problem: Mapped["Problem"] = relationship(
        primaryjoin="and_(Submission.lecture_id == Problem.lecture_id, Submission.assignment_id == Problem.assignment_id)"
    )

    # Submissionレコードと1-N関係にあるJudgeResultレコードへの参照
    judge_results: Mapped[List["JudgeResult"]] = relationship()


class JudgeResult(Base):
    __tablename__ = "JudgeResult"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(Integer, ForeignKey("Submission.id"), nullable=False)
    testcase_id: Mapped[int] = mapped_column(Integer, ForeignKey("TestCases.id"), nullable=False)
    result: Mapped[str] = mapped_column(
        Enum("AC", "WA", "TLE", "MLE", "RE", "CE", "OLE", "IE"), nullable=False
    )
    command: Mapped[str] = mapped_column(String(255), nullable=False)
    timeMS: Mapped[int] = mapped_column(Integer, nullable=False)
    memoryKB: Mapped[int] = mapped_column(Integer, nullable=False)
    exit_code: Mapped[int] = mapped_column(Integer, nullable=False)
    stdout: Mapped[str] = mapped_column(String, nullable=False)
    stderr: Mapped[str] = mapped_column(String, nullable=False)
    
    testcase: Mapped["TestCases"] = relationship()
