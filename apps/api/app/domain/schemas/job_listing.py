"""API schemas for collected job listings."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class JobListingIn(BaseModel):
    source: str = "linkedin"
    source_job_id: str = Field(min_length=1, max_length=128)
    url: str
    title: str
    company: str | None = None
    location: str | None = None
    salary: str | None = None
    description: str | None = None
    skills: list[str] = Field(default_factory=list)
    posted_date: str | None = None


class JobListingOut(JobListingIn):
    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)

    id: str
    first_seen_at: datetime
    last_seen_at: datetime
