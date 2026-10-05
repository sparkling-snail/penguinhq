import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@/types/agent";
import type { PigeonPayload } from "@/types/events";
import { useGameStore } from "./gameStore";

const pigeon: PigeonPayload = {
  task_id: "t1",
  source_agent_id: "a1",
  destination_agent_id: "a2",
  priority: "normal",
  latency_ms: 10,
  retries: 0,
  queue: "default",
  payload_size_bytes: 42,
  status: "success",
};

describe("gameStore", () => {
  beforeEach(() => {
    useGameStore.setState({ agents: {}, pigeonsInFlight: [], agentSpeech: {} });
  });

  it("indexes agents by id and upserts updates", () => {
    const agent = { id: "a1", name: "Kip", state: "idle" } as Agent;
    useGameStore.getState().setAgents([agent]);
    useGameStore.getState().upsertAgent({ ...agent, state: "coding" } as Agent);

    expect(useGameStore.getState().agents).toEqual({ a1: { ...agent, state: "coding" } });
  });

  it("tracks pigeons in flight by task id", () => {
    useGameStore.getState().addPigeon(pigeon);
    expect(useGameStore.getState().pigeonsInFlight.map((p) => p.id)).toEqual(["t1"]);

    useGameStore.getState().removePigeon("t1");
    expect(useGameStore.getState().pigeonsInFlight).toEqual([]);
  });

  it("sets speech with an expiry and clears it", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    useGameStore.getState().setAgentSpeech("a1", "Hello!", 500);

    expect(useGameStore.getState().agentSpeech.a1).toEqual({ text: "Hello!", expiresAt: 1_500 });

    useGameStore.getState().clearAgentSpeech("a1");
    expect(useGameStore.getState().agentSpeech).toEqual({});
    vi.restoreAllMocks();
  });
});
