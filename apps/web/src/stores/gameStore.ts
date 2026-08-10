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

export interface AgentSpeech {
  text: string;
  expiresAt: number;
}

export type OfficeTimeMode = "auto" | "day" | "night";

interface GameState {
  agents: Record<string, Agent>;
  selectedAgentId: string | null;
  pigeonsInFlight: PigeonInFlight[];
  agentSpeech: Record<string, AgentSpeech>;
  officeModeEnabled: boolean;
  officeTimeMode: OfficeTimeMode;

  setAgents: (agents: Agent[]) => void;
  upsertAgent: (agent: Agent) => void;
  selectAgent: (id: string | null) => void;
  addPigeon: (pigeon: PigeonPayload) => void;
  removePigeon: (id: string) => void;
  setAgentSpeech: (agentId: string, text: string, durationMs?: number) => void;
  clearAgentSpeech: (agentId: string) => void;
  setOfficeModeEnabled: (enabled: boolean) => void;
  setOfficeTimeMode: (mode: OfficeTimeMode) => void;
}

export const useGameStore = create<GameState>((set) => ({
  agents: {},
  selectedAgentId: null,
  pigeonsInFlight: [],
  agentSpeech: {},
  officeModeEnabled: true,
  officeTimeMode: "auto",

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

  setAgentSpeech: (agentId, text, durationMs = 12_000) =>
    set((state) => ({
      agentSpeech: {
        ...state.agentSpeech,
        [agentId]: { text, expiresAt: Date.now() + durationMs },
      },
    })),

  clearAgentSpeech: (agentId) =>
    set((state) => {
      const { [agentId]: _removed, ...agentSpeech } = state.agentSpeech;
      return { agentSpeech };
    }),

  setOfficeModeEnabled: (officeModeEnabled) => set({ officeModeEnabled }),
  setOfficeTimeMode: (officeTimeMode) => set({ officeTimeMode }),
}));
