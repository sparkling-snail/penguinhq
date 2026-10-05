from dataclasses import dataclass, field
from datetime import datetime

import pytest

from app.api.routes import hooks


@dataclass
class FakeAgent:
    id: str
    name: str
    role: str
    state: str = "idle"
    created_at: datetime = field(default_factory=datetime.now)


class FakeResult:
    def __init__(self, agents: list[FakeAgent]) -> None:
        self._agents = agents

    def scalars(self) -> "FakeResult":
        return self

    def all(self) -> list[FakeAgent]:
        return self._agents

    def scalar_one_or_none(self) -> FakeAgent | None:
        return self._agents[0] if self._agents else None


class FakeSession:
    def __init__(self, agents: list[FakeAgent]) -> None:
        self.agents = agents

    async def execute(self, statement) -> FakeResult:  # noqa: ANN001
        # The route either lists every agent or looks one up by id.
        params = statement.compile().params
        if params:
            wanted = next(iter(params.values()))
            return FakeResult([a for a in self.agents if a.id == wanted])
        return FakeResult(self.agents)


@pytest.fixture(autouse=True)
def _reset_sessions():
    hooks._session_agents.clear()
    yield
    hooks._session_agents.clear()


@pytest.mark.parametrize(
    ("event", "tool", "state"),
    [
        ("Stop", "Edit", "idle"),
        ("UserPromptSubmit", "", "planning"),
        ("PreToolUse", "Edit", "coding"),
        ("PreToolUse", "Bash", "debugging"),
        ("PreToolUse", "WebSearch", "researching"),
        ("PreToolUse", "SomeNewTool", "thinking"),
    ],
)
def test_state_for_maps_hook_events(event: str, tool: str, state: str) -> None:
    assert hooks._state_for(event, tool) == state


async def test_sessions_skip_autonomous_agents_and_round_robin() -> None:
    db = FakeSession(
        [
            FakeAgent("1", "Kip", "job_hunter"),
            FakeAgent("2", "Bluey", "builder"),
            FakeAgent("3", "Ziggy", "reviewer"),
        ]
    )

    first = await hooks._agent_for_session(db, "s1")  # type: ignore[arg-type]
    second = await hooks._agent_for_session(db, "s2")  # type: ignore[arg-type]

    assert first is not None and first.name == "Bluey"
    assert second is not None and second.name == "Ziggy"


async def test_session_keeps_its_assigned_agent() -> None:
    db = FakeSession([FakeAgent("2", "Bluey", "builder"), FakeAgent("3", "Ziggy", "reviewer")])

    first = await hooks._agent_for_session(db, "s1")  # type: ignore[arg-type]
    await hooks._agent_for_session(db, "s2")  # type: ignore[arg-type]
    again = await hooks._agent_for_session(db, "s1")  # type: ignore[arg-type]

    assert first is not None and again is not None
    assert again.id == first.id


async def test_falls_back_to_autonomous_agents_when_no_others_exist() -> None:
    db = FakeSession([FakeAgent("1", "Kip", "job_hunter")])

    agent = await hooks._agent_for_session(db, "s1")  # type: ignore[arg-type]

    assert agent is not None and agent.name == "Kip"


async def test_no_agents_returns_none() -> None:
    assert await hooks._agent_for_session(FakeSession([]), "s1") is None  # type: ignore[arg-type]
