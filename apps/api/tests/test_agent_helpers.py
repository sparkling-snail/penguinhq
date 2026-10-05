import json

from app.autonomous.agents.tech_scout import TechScoutAgent
from app.autonomous.base import BaseAgent, _strip_code_fence


class ApiError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


def test_strip_code_fence() -> None:
    assert _strip_code_fence("```python\nprint(1)\n```") == "print(1)"
    assert _strip_code_fence("print(1)") == "print(1)"


def test_public_llm_error_never_echoes_raw_message() -> None:
    secret = "invalid x-api-key sk-ant-secret"
    message = BaseAgent._public_llm_error(ApiError(401, secret))

    assert "ANTHROPIC_401" in message
    assert "sk-ant" not in message


def test_public_llm_error_handles_rate_limits_and_unknown_errors() -> None:
    assert "rate limit" in BaseAgent._public_llm_error(ApiError(429, "slow down"))
    assert "ANTHROPIC_UNAVAILABLE" in BaseAgent._public_llm_error(RuntimeError("boom"))


def test_tech_scout_quota_only_counts_today() -> None:
    today = "2026-10-05"
    assert TechScoutAgent._quota_used(json.dumps({"date": today, "used": 2}), today) == 2
    assert TechScoutAgent._quota_used(json.dumps({"date": "2026-01-01", "used": 2}), today) == 0
    assert TechScoutAgent._quota_used(None, today) == 0
