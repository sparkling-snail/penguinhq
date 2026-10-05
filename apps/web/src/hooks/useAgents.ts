"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { useGameStore } from "@/stores/gameStore";
import { DEMO_AGENTS, IS_PUBLIC_DEMO } from "@/lib/demoData";

/**
 * Fetches the agent roster over HTTP on mount, then hands off to
 * WebSocket events for anything that changes after that (see
 * useWebSocket). React Query owns the request lifecycle (loading/error/
 * refetch); the Zustand game store owns the live, mutable copy that the
 * Pixi layer and side panels read from.
 */
export function useAgents() {
  const setAgents = useGameStore((s) => s.setAgents);

  const query = useQuery({
    queryKey: ["agents"],
    queryFn: api.listAgents,
    initialData: DEMO_AGENTS,
    enabled: !IS_PUBLIC_DEMO,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (query.data) setAgents(query.data);
  }, [query.data, setAgents]);

  return query;
}
