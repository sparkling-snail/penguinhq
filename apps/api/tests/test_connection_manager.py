from app.ws.connection_manager import ConnectionManager


class FakeWebSocket:
    def __init__(self, fail: bool = False) -> None:
        self.accepted = False
        self.sent: list[dict] = []
        self.fail = fail

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, message: dict) -> None:
        if self.fail:
            raise RuntimeError("socket closed")
        self.sent.append(message)


async def test_connect_accepts_and_registers() -> None:
    manager = ConnectionManager()
    socket = FakeWebSocket()

    await manager.connect("c1", socket)  # type: ignore[arg-type]

    assert socket.accepted
    assert manager.connection_count == 1


async def test_broadcast_reaches_all_and_prunes_dead_sockets() -> None:
    manager = ConnectionManager()
    healthy, dead = FakeWebSocket(), FakeWebSocket(fail=True)
    await manager.connect("ok", healthy)  # type: ignore[arg-type]
    await manager.connect("dead", dead)  # type: ignore[arg-type]

    await manager.broadcast({"type": "ping"})

    assert healthy.sent == [{"type": "ping"}]
    assert manager.connection_count == 1


async def test_send_to_unknown_client_is_noop() -> None:
    manager = ConnectionManager()

    await manager.send_to("nobody", {"type": "ping"})

    assert manager.connection_count == 0
