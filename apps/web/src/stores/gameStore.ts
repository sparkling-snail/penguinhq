import { create } from "zustand";
import type { Agent } from "@/types/agent";
import type { PigeonPayload } from "@/types/events";

/**
 * Single source of truth for "what's happening in the world" — read by
 * React (HUD, agent inspector panel) and written to by the WebSocket
 * layer (agent state, pigeons).
 *
 * The game loop in GameCanvas does NOT read player/NPC position from this
 * store on every frame — that would force a React state update every
 * animation frame. Position lives in refs local to GameCanvas and is
 * pushed straight to the DOM via CharacterHandle; this store only carries
 * things React actually needs to re-render for (pigeons in flight, the
 * agent roster for the side panel).
 */

export interface PigeonInFlight extends PigeonPayload {
  id: string;
  dispatchedAt: number;
}

interface GameState {
  agents: Record<string, Agent>;
  selectedAgentId: string | null;
  pigeonsInFlight: PigeonInFlight[];

  setAgents: (agents: Agent[]) => void;
  upsertAgent: (agent: Agent) => void;
  selectAgent: (id: string | null) => void;
  addPigeon: (pigeon: PigeonPayload) => void;
  removePigeon: (id: string) => void;
}

export const useGameStore = create<GameState>((set) => ({
  agents: {},
  selectedAgentId: null,
  pigeonsInFlight: [],

  setAgents: (agents) =>
    set(() => ({
      agents: Object.fromEntries(agents.map((agent) => [agent.id, agent])),
    })),

  upsertAgent: (agent) =>
    set((state) => ({
      agents: { ...state.agents, [agent.id]: agent },
    })),

  selectAgent: (id) => set({ selectedAgentId: id }),

  addPigeon: (pigeon) =>
    set((state) => ({
      pigeonsInFlight: [
        ...state.pigeonsInFlight,
        { ...pigeon, id: pigeon.task_id, dispatchedAt: Date.now() },
      ],
    })),

  removePigeon: (id) =>
    set((state) => ({
      pigeonsInFlight: state.pigeonsInFlight.filter((p) => p.id !== id),
    })),
}));
