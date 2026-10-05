from types import SimpleNamespace

from app.core import security


def configure_token(monkeypatch, token: str) -> None:
    monkeypatch.setattr(security, "get_settings", lambda: SimpleNamespace(api_token=token))


def test_valid_bearer_accepts_exact_configured_token(monkeypatch) -> None:
    configure_token(monkeypatch, "a-long-private-service-token")

    assert security.is_valid_bearer("Bearer a-long-private-service-token") is True


def test_valid_bearer_rejects_wrong_scheme_or_value(monkeypatch) -> None:
    configure_token(monkeypatch, "expected")

    assert security.is_valid_bearer("Basic expected") is False
    assert security.is_valid_bearer("Bearer different") is False
    assert security.is_valid_bearer(None) is False


def test_empty_configuration_never_authenticates(monkeypatch) -> None:
    configure_token(monkeypatch, "")

    assert security.is_valid_token("") is False
    assert security.is_valid_token("anything") is False
