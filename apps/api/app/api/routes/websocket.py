"""
The single WebSocket endpoint the frontend connects to.

Protocol for Milestone 1:
  1. Client connects to /ws/{client_id}
  2. Server accepts, registers the connection, sends a `connection.ack`
  3. Server broadcasts `pigeon.dispatched` events on a timer (see
     app/ws/pigeon_simulator.py) so there's real traffic to animate
  4. Server echoes back any `chat.message` the client sends, broadcast to
     all connections — this is the seam the real chat persistence
     (Milestone: Slack-like communication center) plugs into

`client_id` is caller-supplied (the frontend generates a UUID once per
browser tab and reuses it across reconnects).
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.domain.schemas.events import ConnectionAckPayload, WSEventType, make_event
from app.ws.connection_manager import connection_manager

logger = logging.getLogger("penguinhq.ws.route")

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str) -> None:
    await connection_manager.connect(client_id, websocket)
    await connection_manager.send_to(
        client_id,
        make_event(WSEventType.CONNECTION_ACK, ConnectionAckPayload(client_id=client_id).model_dump()),
    )

    try:
        while True:
            data = await websocket.receive_json()
            event_type = data.get("type")

            if event_type == "chat.message":
                # Milestone 1: pure fan-out, no persistence yet.
                await connection_manager.broadcast(
                    make_event(WSEventType.CHAT_MESSAGE, data.get("payload", {}))
                )
            else:
                logger.debug("unhandled inbound event type: %s", event_type)
    except WebSocketDisconnect:
        connection_manager.disconnect(client_id)
