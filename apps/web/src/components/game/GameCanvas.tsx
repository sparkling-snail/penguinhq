"use client";

import { useEffect, useRef, useState } from "react";
import { PixiApp } from "./PixiApp";
import type { PigeonData } from "./entities/Pigeon";
import { useGameStore } from "@/stores/gameStore";
import { PigeonTooltip } from "./PigeonTooltip";

/**
 * React <-> PixiJS boundary.
 *
 * PixiApp is created exactly once per mount (StrictMode-safe via the
 * `created` ref guard — React 18 dev mode invokes effects twice) and
 * torn down on unmount. After creation, this component does NOT re-run
 * Pixi setup on every React re-render; instead it subscribes to the
 * Zustand game store and imperatively calls `pixiApp.spawnPigeon(...)`
 * when new pigeons appear, which is the correct way to bridge a
 * React-external render loop with React state.
 */
export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const pixiAppRef = useRef<PixiApp | null>(null);
  const spawnedPigeonIds = useRef<Set<string>>(new Set());
  const [hoveredPigeon, setHoveredPigeon] = useState<PigeonData | null>(null);

  const pigeonsInFlight = useGameStore((s) => s.pigeonsInFlight);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || pixiAppRef.current) return;

    const { clientWidth, clientHeight } = el;
    const pixiApp = new PixiApp(el, clientWidth, clientHeight, {
      onPigeonHover: setHoveredPigeon,
    });
    pixiAppRef.current = pixiApp;

    const handleResize = () => {
      if (!containerRef.current) return;
      pixiApp.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      pixiApp.destroy();
      pixiAppRef.current = null;
    };
  }, []);

  useEffect(() => {
    const pixiApp = pixiAppRef.current;
    if (!pixiApp) return;

    for (const pigeon of pigeonsInFlight) {
      if (spawnedPigeonIds.current.has(pigeon.id)) continue;
      spawnedPigeonIds.current.add(pigeon.id);
      pixiApp.spawnPigeon({
        taskId: pigeon.task_id,
        sourceAgentId: pigeon.source_agent_id,
        destinationAgentId: pigeon.destination_agent_id,
        priority: pigeon.priority,
        latencyMs: pigeon.latency_ms,
        retries: pigeon.retries,
        queue: pigeon.queue,
        payloadSizeBytes: pigeon.payload_size_bytes,
        status: pigeon.status,
      });
    }
  }, [pigeonsInFlight]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/40 px-2 py-1 text-xs text-slate-300">
        WASD / arrow keys to move
      </div>
      {hoveredPigeon && <PigeonTooltip data={hoveredPigeon} />}
    </div>
  );
}
