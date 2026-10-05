"""Small, dependency-free service authentication helpers."""

import secrets

from app.core.config import get_settings


def is_valid_token(candidate: str | None) -> bool:
    """Return True when the supplied token matches the configured secret."""
    expected = get_settings().api_token
    if not expected:
        return False
    return bool(candidate) and secrets.compare_digest(candidate, expected)


def is_valid_bearer(authorization: str | None) -> bool:
    if not authorization:
        return False
    scheme, separator, token = authorization.partition(" ")
    return bool(separator) and scheme.lower() == "bearer" and is_valid_token(token.strip())
