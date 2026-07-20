/**
 * WebSocket event envelope — mirrors app/domain/schemas/events.py.
 * See the note in types/agent.ts about why this is a hand-kept mirror
 * rather than a workspace import.
 */

export type WSEventType =
  | "connection.ack"
  | "agent.state_changed"
  | "agent.moved"
  | "pigeon.dispatched"
  | "pigeon.delivered"
  | "chat.message";

export interface WSEvent<TPayload = unknown> {
  type: WSEventType;
  payload: TPayload;
  timestamp: string;
}

export type PigeonStatus = "success" | "retry" | "dead_letter" | "high_priority" | "ai_collab";

export interface PigeonPayload {
  task_id: string;
  source_agent_id: string;
  destination_agent_id: string;
  priority: "low" | "normal" | "high";
  latency_ms: number;
  retries: number;
  queue: string;
  payload_size_bytes: number;
  status: PigeonStatus;
}

export interface ConnectionAckPayload {
  message: string;
  client_id: string;
}
