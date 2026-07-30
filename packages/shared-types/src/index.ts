/**
 * Shared contract between the FastAPI backend and the Next.js frontend.
 *
 * This package holds ONLY types, never runtime logic. The backend's
 * Pydantic schemas (apps/api/app/domain/schemas) are the source of truth —
 * these TS types are hand-mirrored to match them. In a later milestone we
 * generate this file automatically from the OpenAPI/AsyncAPI spec so the
 * two can never drift.
 */

export type AgentState =
  | "idle"
  | "walking"
  | "planning"
  | "thinking"
  | "coding"
  | "researching"
  | "meeting"
  | "blocked"
  | "waiting"
  | "sleeping"
  | "debugging"
  | "error"
  | "searching"
  | "evaluating"
  | "coordinating";

export type RoomId =
  | "engineering"
  | "library"
  | "research_lab"
  | "cloud_operations"
  | "hr"
  | "cafe"
  | "trading_desk"
  | "launch_pad"
  | "arcade"
  | "mission_control";

export interface Vector2 {
  x: number;
  y: number;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  state: AgentState;
  room: RoomId;
  position: Vector2;
  avatarColor: string;
}

/** Base envelope for every message sent over the WebSocket connection. */
export interface WSEvent<TPayload = unknown> {
  type: string;
  payload: TPayload;
  timestamp: string;
}

export type WSEventType =
  | "agent.state_changed"
  | "agent.moved"
  | "pigeon.dispatched"
  | "pigeon.delivered"
  | "chat.message"
  | "connection.ack";

export interface PigeonEnvelopeColor {
  status: "success" | "retry" | "dead_letter" | "high_priority" | "ai_collab";
}

export interface PigeonPayload {
  taskId: string;
  sourceAgentId: string;
  destinationAgentId: string;
  priority: "low" | "normal" | "high";
  latencyMs: number;
  retries: number;
  queue: string;
  payloadSizeBytes: number;
  status: PigeonEnvelopeColor["status"];
}

export interface ChatMessage {
  id: string;
  channel: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}
