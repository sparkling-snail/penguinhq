"""
Pydantic schemas for the tasks API.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TaskCreateRequest(BaseModel):
    """Request body for creating a new task (dispatching a pigeon)."""
    source_agent_id: str
    destination_role: str
    task_type: str
    priority: str = "normal"
    payload: dict[str, Any] | None = None


class TaskUpdateRequest(BaseModel):
    """Request body for updating a task's status."""
    status: str  # "in_progress", "completed", "failed"
    result: dict[str, Any] | None = None


class TaskOut(BaseModel):
    """Task response with camelCase aliases for the frontend."""
    id: str
    source_agent_id: str
    destination_agent_id: str | None
    destination_role: str
    task_type: str
    priority: str
    status: str
    payload: dict[str, Any] | None
    result: dict[str, Any] | None
    created_at: datetime
    completed_at: datetime | None

    class Config:
        from_attributes = True
