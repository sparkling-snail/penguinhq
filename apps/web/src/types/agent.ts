/**
 * Local mirror of packages/shared-types Agent contract.
 *
 * Why not import the workspace package directly? Each Docker build
 * context is scoped to its own app folder (./apps/web, ./apps/api) so
 * containers build fast and independently — that isolation means the web
 * container can't see ../../packages at build time. `packages/shared-types`
 * remains the documented source of truth for the wire contract; this file
 * is a hand-kept mirror. When we move to a Turborepo-driven build (a
 * later milestone) the build context becomes the repo root and this file
 * is replaced with a real workspace import.
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
  // New states for the multi-agent framework
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
  room: RoomId | string;
  position: Vector2;
  avatarColor: string;
}
