"""
REST API for inter-agent tasks (pigeons).

POST /tasks — create a task (triggers pigeon.dispatched broadcast)
GET  /tasks — list tasks with filters
PATCH /tasks/{id} — update task status (triggers pigeon.delivered on completion)

This replaces the pigeon_simulator.py — pigeons are now real dispatch events
flowing between agents through the DB and WebSocket.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.domain.models.agent import Agent
from app.domain.models.task import Task
from app.domain.schemas.events import PigeonPayload, WSEventType, make_event
from app.domain.schemas.task import TaskCreateRequest, TaskUpdateRequest
from app.ws.connection_manager import connection_manager

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.post("")
async def create_task(
    body: TaskCreateRequest,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Create a new inter-agent task.

    This is called by BaseAgent.dispatch_task() when one agent wants to
    send work to another. It:
      1. Resolves destination_role to a destination_agent_id
      2. Creates a DB row for the task
      3. Broadcasts pigeon.dispatched over WebSocket (pigeon flies!)
    """
    # Resolve destination_role to an agent ID
    destination_agent_id: str | None = None
    result = await db.execute(
        select(Agent).where(Agent.role == body.destination_role)
    )
    dest_agent = result.scalar_one_or_none()
    if dest_agent:
        destination_agent_id = dest_agent.id

    task = Task(
        source_agent_id=body.source_agent_id,
        destination_agent_id=destination_agent_id,
        destination_role=body.destination_role,
        task_type=body.task_type,
        priority=body.priority,
        status="pending",
        payload=body.payload,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    # Broadcast pigeon.dispatched over WebSocket — this makes the pigeon fly!
    pigeon_payload = PigeonPayload(
        task_id=task.id[:8],
        source_agent_id=body.source_agent_id,
        destination_agent_id=destination_agent_id or body.destination_role,
        priority=body.priority,
        latency_ms=0,
        retries=0,
        queue=f"tasks.{body.task_type}",
        payload_size_bytes=len(str(body.payload or {}).encode()),
        status="ai_collab",
    )
    await connection_manager.broadcast(
        make_event(WSEventType.PIGEON_DISPATCHED, pigeon_payload.model_dump())
    )

    return {"ok": True, "task_id": task.id}


@router.get("")
async def list_tasks(
    source_agent_id: str | None = Query(None),
    destination_role: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    """List tasks with optional filters."""
    query = select(Task).order_by(Task.created_at.desc()).limit(limit)

    if source_agent_id:
        query = query.where(Task.source_agent_id == source_agent_id)
    if destination_role:
        query = query.where(Task.destination_role == destination_role)
    if status:
        query = query.where(Task.status == status)

    result = await db.execute(query)
    tasks = result.scalars().all()

    return [
        {
            "id": t.id,
            "source_agent_id": t.source_agent_id,
            "destination_agent_id": t.destination_agent_id,
            "destination_role": t.destination_role,
            "task_type": t.task_type,
            "priority": t.priority,
            "status": t.status,
            "payload": t.payload,
            "result": t.result,
            "createdAt": t.created_at.isoformat() if t.created_at else None,
            "completedAt": t.completed_at.isoformat() if t.completed_at else None,
        }
        for t in tasks
    ]


@router.patch("/{task_id}")
async def update_task(
    task_id: str,
    body: TaskUpdateRequest,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Update a task's status.

    When status is set to "completed", broadcasts pigeon.delivered
    over WebSocket (pigeon arrives at destination!).
    """
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if task is None:
        return {"ok": False, "reason": "task not found"}

    old_status = task.status
    task.status = body.status
    task.result = body.result

    if body.status == "completed":
        task.completed_at = datetime.now(timezone.utc)

    await db.commit()

    # Broadcast pigeon.delivered when a task completes
    if body.status == "completed" and old_status != "completed":
        pigeon_payload = PigeonPayload(
            task_id=task.id[:8],
            source_agent_id=task.source_agent_id,
            destination_agent_id=task.destination_agent_id or task.destination_role,
            priority=task.priority,
            latency_ms=int(
                (task.completed_at - task.created_at).total_seconds() * 1000
            ) if task.completed_at and task.created_at else 0,
            retries=0,
            queue=f"tasks.{task.task_type}",
            payload_size_bytes=len(str(task.result or {}).encode()),
            status="success",
        )
        await connection_manager.broadcast(
            make_event(WSEventType.PIGEON_DELIVERED, pigeon_payload.model_dump())
        )

    return {"ok": True, "task_id": task.id, "status": task.status}
