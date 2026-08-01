"""Job listing ingestion and dashboard data endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.domain.models.job_listing import JobListing
from app.domain.schemas.job_listing import JobListingIn, JobListingOut

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("/ingest", response_model=JobListingOut)
async def ingest_job(job: JobListingIn, db: AsyncSession = Depends(get_db_session)) -> JobListing:
    values = job.model_dump()
    now = datetime.now(timezone.utc)
    statement = insert(JobListing).values(**values, last_seen_at=now)
    statement = statement.on_conflict_do_update(
        constraint="uq_job_listing_source_id",
        set_={**values, "last_seen_at": now},
    ).returning(JobListing)
    result = await db.execute(statement)
    await db.commit()
    return result.scalar_one()


@router.get("", response_model=list[JobListingOut])
async def list_jobs(
    limit: int = 50, db: AsyncSession = Depends(get_db_session)
) -> list[JobListing]:
    bounded_limit = min(max(limit, 1), 200)
    result = await db.execute(
        select(JobListing).order_by(JobListing.last_seen_at.desc()).limit(bounded_limit)
    )
    return list(result.scalars())
