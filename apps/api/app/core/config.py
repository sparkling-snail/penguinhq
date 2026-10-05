"""
Centralized application settings.

All configuration flows through this single `Settings` object, loaded once
from environment variables (see `.env.example`). Nothing else in the
codebase should call `os.environ` directly — that keeps every config value
discoverable in one place and testable via `Settings(**overrides)`.
"""

from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"

    # A single service token protects the API and inbound WebSocket messages.
    # Local development stays frictionless when it is empty; production refuses
    # to start without it. Public portfolio deployments expose the static demo
    # frontend, not this token or the private API.
    api_access_token: SecretStr = SecretStr("")
    allowed_hosts: str = "localhost,127.0.0.1,testserver"
    auto_create_schema: bool = True

    # Postgres
    database_url: str = "postgresql+asyncpg://penguin:penguin@localhost:5432/penguinhq"

    # Redis (pub/sub + Celery broker in a later milestone)
    redis_url: str = "redis://localhost:6379/0"

    # CORS — comma-separated origins allowed to call the API / open a WS
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def allowed_host_list(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]

    @property
    def api_token(self) -> str:
        return self.api_access_token.get_secret_value()

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    """Settings are immutable per-process; cache avoids re-parsing env vars."""
    return Settings()
