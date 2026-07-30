"""
Pydantic schemas — the API-facing contract for agents.

Keeping schemas separate from the ORM model (app/domain/models/agent.py)
is a deliberate DDD boundary: the database shape and the wire shape are
allowed to diverge, and FastAPI validates/serializes against these classes
only, never the ORM class directly.
"""

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class AgentState(str, Enum):
    IDLE = "idle"
    WALKING = "walking"
    PLANNING = "planning"
    THINKING = "thinking"
    CODING = "coding"
    RESEARCHING = "researching"
    MEETING = "meeting"
    BLOCKED = "blocked"
    WAITING = "waiting"
    SLEEPING = "sleeping"
    DEBUGGING = "debugging"
    ERROR = "error"
    # New states for the multi-agent framework
    SEARCHING = "searching"
    EVALUATING = "evaluating"
    COORDINATING = "coordinating"


RoomId = Literal[
    "engineering",
    "library",
    "research_lab",
    "cloud_operations",
    "hr",
    "cafe",
    "trading_desk",
    "launch_pad",
    "arcade",
    "mission_control",
]


class Vector2(BaseModel):
    x: float
    y: float


class AgentOut(BaseModel):
    # camelCase on the wire (avatarColor, not avatar_color) so the
    # frontend's TS types — which follow JS/TS naming conventions — line
    # up with the JSON with zero translation layer. `populate_by_name`
    # keeps snake_case construction (see `from_orm_flat` below) working
    # on the Python side.
    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)

    id: str
    name: str
    role: str
    state: AgentState
    room: str
    position: Vector2
    avatar_color: str

    @classmethod
    def from_orm_flat(cls, orm_agent) -> "AgentOut":
        """ORM stores position_x/position_y as flat columns; nest them here."""
        return cls(
            id=orm_agent.id,
            name=orm_agent.name,
            role=orm_agent.role,
            state=AgentState(orm_agent.state),
            room=orm_agent.room,
            position=Vector2(x=orm_agent.position_x, y=orm_agent.position_y),
            avatar_color=orm_agent.avatar_color,
        )
