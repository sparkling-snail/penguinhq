"""
Async SQLAlchemy engine + session factory.

We use SQLAlchemy 2.0's async ORM with asyncpg as the driver. FastAPI
endpoints depend on `get_db_session` to receive a scoped session per
request, which is the standard "unit of work per request" pattern.

Local development can still call `Base.metadata.create_all` on startup for
convenience. Production disables that path and runs Alembic migrations from
the container entrypoint instead.
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
    """Create missing tables only when the explicit dev convenience is enabled."""
    if not settings.auto_create_schema:
        return
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
