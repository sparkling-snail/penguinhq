from app.autonomous.bus import AgentBus, AgentMessage


def _message(source: str = "a1") -> AgentMessage:
    return AgentMessage(
        source_agent_id=source,
        source_role="job_hunter",
        task_type="job_lead",
        payload={"title": "SRE"},
    )


def test_send_delivers_to_target_inbox() -> None:
    bus = AgentBus()
    inbox = bus.register("a2", "portfolio")

    bus.send("a2", _message())

    assert inbox.qsize() == 1
    assert inbox.get_nowait().payload == {"title": "SRE"}


def test_send_by_role_resolves_agent_id() -> None:
    bus = AgentBus()
    inbox = bus.register("a2", "portfolio")

    bus.send_by_role("portfolio", _message())

    assert inbox.qsize() == 1


def test_unknown_target_is_dropped_without_error() -> None:
    bus = AgentBus()
    inbox = bus.register("a2", "portfolio")

    bus.send("missing", _message())
    bus.send_by_role("missing_role", _message())

    assert inbox.empty()


def test_broadcast_skips_sender() -> None:
    bus = AgentBus()
    sender = bus.register("a1", "job_hunter")
    other = bus.register("a2", "portfolio")
    third = bus.register("a3", "tech_scout")

    bus.broadcast(_message(source="a1"))

    assert sender.empty()
    assert other.qsize() == 1
    assert third.qsize() == 1
    assert bus.registered_agents == ["a1", "a2", "a3"]
