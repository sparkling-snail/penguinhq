"""
Server-originated chat messages.

The websocket route (app/api/routes/websocket.py) already fans out
`chat.message` events sent *by* a connected browser client. This endpoint
is the other direction: a backend process with no WebSocket connection of
its own (the autonomous Leetcode Coach loop, or any future real agent
runtime) posts a message here over plain HTTP, and it's broadcast the
same way.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from app.domain.schemas.events import WSEventType, make_event
from app.ws.connection_manager import connection_manager

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatSendRequest(BaseModel):
    channel: str
    author_id: str
    author_name: str
    author_color: str
    content: str


@router.post("/send")
async def send_chat_message(body: ChatSendRequest) -> dict:
    message = {
        "id": str(uuid.uuid4()),
        "channel": body.channel,
        "authorId": body.author_id,
        "authorName": body.author_name,
        "authorColor": body.author_color,
        "content": body.content,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    await connection_manager.broadcast(make_event(WSEventType.CHAT_MESSAGE, message))
    return {"ok": True}
