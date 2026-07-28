"use client";

import { useEffect, useRef } from "react";
import type { PigeonInFlight } from "@/stores/gameStore";

const STATUS_COLOR: Record<PigeonInFlight["status"], string> = {
  success: "#22c55e",
  retry: "#eab308",
  dead_letter: "#ef4444",
  high_priority: "#38bdf8",
  ai_collab: "#a855f7",
};

const FLIGHT_DURATION_MS = 4000;
const FLUTTER_STEPS = 12;

export interface PigeonSpriteProps {
  pigeon: PigeonInFlight;
  onArrive: () => void;
  onHoverChange: (hovering: boolean) => void;
}

/**
 * A messenger pigeon flying across the room. Unlike the player/NPC (which
 * move continuously in response to input and need a per-frame game loop),
 * a pigeon's flight is a single fire-and-forget path from one edge to the
 * other — a perfect fit for the Web Animations API instead of hand-rolled
 * per-frame position updates. `animation.onfinish` replaces the old
 * "still flying?" boolean the Pixi ticker used to poll.
 */
export function PigeonSprite({ pigeon, onArrive, onHoverChange }: PigeonSpriteProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const flightY = 8 + Math.random() * 40; // stays in the sky/rooftop band, above the walkable ground
    const startX = -8;
    const endX = 108;
    const keyframes: Keyframe[] = [];
    for (let i = 0; i <= FLUTTER_STEPS; i++) {
      const t = i / FLUTTER_STEPS;
      keyframes.push({
        left: `${startX + (endX - startX) * t}%`,
        top: `${flightY + Math.sin(t * Math.PI * 6) * 2.5}%`,
      });
    }

    const animation = el.animate(keyframes, {
      duration: FLIGHT_DURATION_MS,
      easing: "linear",
      fill: "forwards",
    });
    animation.onfinish = onArrive;
    return () => animation.cancel();
    // A pigeon's flight path is fixed at spawn time (like the old Pixi
    // version picking `flightY` once in its constructor) — deliberately
    // runs only once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const color = STATUS_COLOR[pigeon.status];

  return (
    <div
      ref={ref}
      className="absolute cursor-pointer"
      style={{ left: "-8%", top: "20%", zIndex: 500 }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div className="relative h-6 w-9 animate-[pigeon-flap_0.35s_ease-in-out_infinite]">
        <div className="absolute left-0 top-1 h-1.5 w-4 rounded-full bg-slate-400" />
        <div className="absolute right-0 top-1 h-1.5 w-4 rounded-full bg-slate-400" />
        <div className="absolute left-1/2 top-1/2 h-3 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-200" />
        <div className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-slate-200" />
        <div
          className="absolute h-0 w-0"
          style={{
            right: -3,
            top: 5,
            borderTop: "2px solid transparent",
            borderBottom: "2px solid transparent",
            borderLeft: "4px solid #f97316",
          }}
        />
      </div>
      <div
        className="absolute left-1/2 top-full -translate-x-1/2 rounded-sm border border-slate-900/60"
        style={{ width: 14, height: 10, backgroundColor: color, marginTop: 2 }}
      />
    </div>
  );
}
