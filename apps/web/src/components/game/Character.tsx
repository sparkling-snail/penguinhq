"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { AgentState } from "@/types/agent";

export type SpriteDirection = "front-left" | "front-right" | "rear-left" | "rear-right";

/**
 * A character's art is either:
 *  - "static": one image, flipped horizontally to face left/right (what
 *    the player uses — there's only one penguin-blue.webp).
 *  - "directional": four separate images, one per facing (what the named
 *    agent sprites use — Bluey/Kip/Luna/Ziggy each ship as
 *    `{base}-{direction}.webp`), swapped based on movement direction
 *    instead of flipped, matching Claude-Office's actual convention.
 */
export type CharacterSprite = { type: "static"; url: string } | { type: "directional"; base: string };

const STATE_RING_COLOR: Record<AgentState, string> = {
  idle: "#64748b",
  walking: "#38bdf8",
  planning: "#a78bfa",
  thinking: "#a78bfa",
  coding: "#22c55e",
  researching: "#eab308",
  meeting: "#f472b6",
  blocked: "#ef4444",
  waiting: "#f59e0b",
  sleeping: "#475569",
  debugging: "#f97316",
  error: "#dc2626",
  // New states for the multi-agent framework
  searching: "#3b82f6",
  evaluating: "#f59e0b",
  coordinating: "#ec4899",
};

const SPRITE_HEIGHT = 74;
// A real, non-zero reference width for the percentage-based centering
// below (comfortably wider than any sprite's rendered width at
// SPRITE_HEIGHT tall) — a `width: 0` containing block technically still
// resolves `left: 50%` to a real point, but some browsers collapse an
// absolutely-positioned descendant's own shrink-to-fit width to zero
// inside a zero-width ancestor, hiding the sprite entirely.
const CHARACTER_BOX_WIDTH = 96;

export interface CharacterHandle {
  /** x/y as percentages (0-100) of the room container. */
  setPosition(xPct: number, yPct: number): void;
  /** Idle-bob offset in px, applied every frame regardless of sprite mode. */
  setBob(offsetPx: number): void;
  /** `boolean` for "static" sprites (flip left/right); `SpriteDirection`
   * for "directional" ones (swaps which of the 4 images is shown). */
  setFacing(input: boolean | SpriteDirection): void;
  setState(state: AgentState): void;
}

export interface CharacterProps {
  name: string;
  sprite: CharacterSprite;
}

/**
 * DOM/CSS equivalent of the old Pixi `Penguin` class — a sprite image
 * plus a state ring, shadow, and name label, all positioned with plain
 * CSS. Position and per-frame pose updates go through the imperative
 * handle (direct style mutation from the game loop in GameCanvas) rather
 * than React state, so 60fps movement doesn't force a React re-render
 * every frame — only `state` (which changes rarely, e.g. idle -> walking,
 * or a backend agent-state change) is React state.
 */
export const Character = forwardRef<CharacterHandle, CharacterProps>(function Character(
  { name, sprite },
  ref
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<AgentState>("idle");
  const bobRef = useRef(0);
  const flippedRef = useRef(false);
  const lastDirectionRef = useRef<SpriteDirection>("front-left");

  const directionalUrls = useMemo(() => {
    if (sprite.type !== "directional") return null;
    const base = sprite.base;
    return {
      "front-left": `/sprites/agents/${base}-front-left.webp`,
      "front-right": `/sprites/agents/${base}-front-right.webp`,
      "rear-left": `/sprites/agents/${base}-rear-left.webp`,
      "rear-right": `/sprites/agents/${base}-rear-right.webp`,
    } satisfies Record<SpriteDirection, string>;
  }, [sprite]);

  const initialSrc = sprite.type === "static" ? sprite.url : (directionalUrls as Record<SpriteDirection, string>)["front-left"];

  useImperativeHandle(ref, () => ({
    setPosition(xPct, yPct) {
      const el = wrapperRef.current;
      if (!el) return;
      el.style.left = `${xPct}%`;
      el.style.top = `${yPct}%`;
      el.style.zIndex = String(Math.round(yPct * 100));
    },
    setBob(offsetPx) {
      bobRef.current = offsetPx;
      applyTransform();
    },
    setFacing(input) {
      if (sprite.type === "static") {
        flippedRef.current = input as boolean;
        applyTransform();
        return;
      }
      const direction = input as SpriteDirection;
      if (direction === lastDirectionRef.current) return;
      lastDirectionRef.current = direction;
      const img = spriteRef.current;
      if (img && directionalUrls) img.src = directionalUrls[direction];
    },
    setState(next) {
      setState(next);
    },
  }));

  function applyTransform() {
    const img = spriteRef.current;
    if (!img) return;
    img.style.transform = `translateY(${bobRef.current}px) scaleX(${flippedRef.current ? -1 : 1})`;
  }

  return (
    <div
      ref={wrapperRef}
      className="absolute"
      style={{ width: CHARACTER_BOX_WIDTH, height: SPRITE_HEIGHT, transform: "translate(-50%, -100%)" }}
    >
      <div className="relative" style={{ width: CHARACTER_BOX_WIDTH, height: SPRITE_HEIGHT }}>
        <span
          className="absolute left-1/2 whitespace-nowrap text-[11px] text-slate-200"
          style={{
            bottom: SPRITE_HEIGHT + 10,
            transform: "translateX(-50%)",
            textShadow: "0 0 3px #0b1120, 0 0 3px #0b1120, 0 0 3px #0b1120",
          }}
        >
          {name}
        </span>

        <div
          className="absolute left-1/2 rounded-full"
          style={{
            bottom: 2,
            width: SPRITE_HEIGHT + 4,
            height: SPRITE_HEIGHT + 4,
            transform: "translateX(-50%)",
            border: `2px solid ${STATE_RING_COLOR[state]}`,
            opacity: 0.9,
          }}
        />

        <div className="absolute bottom-0 left-1/2" style={{ height: SPRITE_HEIGHT, transform: "translateX(-50%)" }}>
          <img
            ref={spriteRef}
            src={initialSrc}
            alt={name}
            draggable={false}
            className="h-full w-auto select-none"
          />
        </div>

        <div
          className="absolute left-1/2 rounded-full bg-black/35"
          style={{ bottom: -3, width: 32, height: 9, transform: "translateX(-50%)", filter: "blur(1px)" }}
        />
      </div>
    </div>
  );
});
