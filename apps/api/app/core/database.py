"""
Async SQLAlchemy engine + session factory.

We use SQLAlchemy 2.0's async ORM with asyncpg as the driver. FastAPI
endpoints depend on `get_db_session` to receive a scoped session per
request, which is the standard "unit of work per request" pattern.

Migrations: for Milestone 1 we call `Base.metadata.create_all` on startup
so the schema exists for local dev. A real migration history (Alembic)
lands in the persistence-hardening milestone — hand-editing tables in prod
is not something we ever want to reach for.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

settings = get_settings()

engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Shared declarative base for every ORM model in the domain layer."""


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency — yields a session and guarantees it is closed."""
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    """Create tables that don't exist yet. Dev-only convenience — see docstring above."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
