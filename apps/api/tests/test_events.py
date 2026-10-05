from app.core.config import Settings
from app.domain.schemas.events import WSEventType, make_event


def test_make_event_produces_json_ready_envelope() -> None:
    event = make_event(WSEventType.CHAT_MESSAGE, {"text": "hi"})

    assert event["type"] == "chat.message"
    assert event["payload"] == {"text": "hi"}
    assert isinstance(event["timestamp"], str)


def test_cors_origins_are_split_and_trimmed() -> None:
    settings = Settings(cors_origins=" http://localhost:3000 , https://example.com ,")

    assert settings.cors_origin_list == ["http://localhost:3000", "https://example.com"]
