"""
Centralized application settings.

All configuration flows through this single `Settings` object, loaded once
from environment variables (see `.env.example`). Nothing else in the
codebase should call `os.environ` directly — that keeps every config value
discoverable in one place and testable via `Settings(**overrides)`.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"

    # Postgres
    database_url: str = "postgresql+asyncpg://penguin:penguin@localhost:5432/penguinhq"

    # Redis (pub/sub + Celery broker in a later milestone)
    redis_url: str = "redis://localhost:6379/0"

    # CORS — comma-separated origins allowed to call the API / open a WS
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Settings are immutable per-process; cache avoids re-parsing env vars."""
    return Settings()
