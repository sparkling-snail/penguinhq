"""Wire contracts for persistent Leetcode practice data."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class PracticeSessionCreate(BaseModel):
    title: str = Field(default="Today's practice", min_length=1, max_length=240)
    problem_statement: str | None = None
    language: str = Field(default="python", max_length=32)
    draft_code: str = ""


class PracticeSessionDraftUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    draft_code: str


class PracticeSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)

    id: str
    title: str
    problem_statement: str | None
    language: str
    status: str
    draft_code: str
    created_at: datetime
    updated_at: datetime


class PracticeAttemptCreate(BaseModel):
    source_code: str = Field(min_length=1)
    language: str = Field(default="python", max_length=32)


class PracticeAttemptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)

    id: str
    session_id: str
    source_code: str
    language: str
    created_at: datetime


class AttemptFeedbackCreate(BaseModel):
    content: str = Field(min_length=1)
    author: str = Field(default="leetcode_coach", max_length=64)


class AttemptFeedbackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)

    id: str
    attempt_id: str
    author: str
    content: str
    created_at: datetime
