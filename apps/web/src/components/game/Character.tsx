"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { AgentState } from "@/types/agent";

export type SpriteDirection = "front-left" | "front-right" | "rear-left" | "rear-right";

/**
 * A character's art is either:
 *  - "static": one image, flipped horizontally to face left/right (what
 *    single-pose sprites such as the sleeping penguins use).
 *  - "directional": four separate images, one per facing (what the named
 *    agent sprites use — Bluey/Kip/Luna/Ziggy each ship as
 *    `{base}-{direction}.webp`), swapped based on movement direction
 *    instead of flipped, matching Claude-Office's convention (see THIRD_PARTY_NOTICES.md).
 */
export type CharacterSprite =
  | { type: "static"; url: string }
  | {
      type: "directional";
      base: string;
      pose?: "standing" | "seated";
      /** Optional per-facing seated art; unspecified facings use the default asset. */
      seatedSpriteUrls?: Partial<Record<SpriteDirection, string>>;
      /** Avoid a one-frame incorrect facing while the game loop initializes. */
      initialDirection?: SpriteDirection;
    };

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
// The regenerated directional art sits on a square canvas but its visible
// character silhouette is slightly narrower than the original sprites. A
// small horizontal correction keeps the flock pleasantly squat in the room
// instead of making each penguin read as stretched vertically.
const DIRECTIONAL_SPRITE_WIDTH_SCALE = 1.16;
// Sitting art includes its own stool. Keep it slightly smaller than a standing
// penguin, but large enough to read as a person occupying each table chair.
const SEATED_CHARACTER_SCALE = 1.08;
// Furniture uses room-depth z-indexes below 10,000. Keep every character
// above that layer while preserving depth ordering between penguins.
const CHARACTER_Z_INDEX_BASE = 20_000;
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
  /** Override room depth after positioning (used when furniture occludes a pose). */
  setZIndex(zIndex: number): void;
  /** Idle-bob offset in px, applied every frame regardless of sprite mode. */
  setBob(offsetPx: number): void;
  /** Perspective scale, anchored to the character's feet. */
  setScale(scale: number): void;
  /** `boolean` for "static" sprites (flip left/right); `SpriteDirection`
   * for "directional" ones (swaps which of the 4 images is shown). */
  setFacing(input: boolean | SpriteDirection): void;
  setState(state: AgentState): void;
}

export interface CharacterProps {
  name: string;
  sprite: CharacterSprite;
  speech?: string;
  showStatus?: boolean;
  horizontalScale?: number;
  /** Per-sprite visual normalization for assets with different transparent padding. */
  scaleMultiplier?: number;
  activity?:
    | "coffee-grinding"
    | "coffee-pouring"
    | "coffee-sipping"
    | "planning-board"
    | "server-alert"
    | "server-diagnose"
    | "server-repair"
    | "server-reboot"
    | "server-celebrate";
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
  { name, sprite, speech, showStatus = true, horizontalScale = 1, scaleMultiplier = 1, activity },
  ref
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<AgentState>("idle");
  const bobRef = useRef(0);
  const scaleRef = useRef(1);
  const flippedRef = useRef(false);
  const lastDirectionRef = useRef<SpriteDirection>("front-left");

  const directionalUrls = useMemo(() => {
    if (sprite.type !== "directional") return null;
    const base = sprite.base;
    const poseSuffix = sprite.pose === "seated" ? "-seated" : "";
    const defaults = {
      "front-left": `/sprites/agents/${base}${poseSuffix}-front-left.${sprite.pose === "seated" ? "png" : "webp"}`,
      "front-right": `/sprites/agents/${base}${poseSuffix}-front-right.${sprite.pose === "seated" ? "png" : "webp"}`,
      "rear-left": `/sprites/agents/${base}${poseSuffix}-rear-left.${sprite.pose === "seated" ? "png" : "webp"}`,
      "rear-right": `/sprites/agents/${base}${poseSuffix}-rear-right.${sprite.pose === "seated" ? "png" : "webp"}`,
    } satisfies Record<SpriteDirection, string>;
    return sprite.pose === "seated" ? { ...defaults, ...sprite.seatedSpriteUrls } : defaults;
  }, [sprite]);

  const initialSrc =
    sprite.type === "static"
      ? sprite.url
      : (directionalUrls as Record<SpriteDirection, string>)[sprite.initialDirection ?? "front-left"];
  const poseScale =
    (sprite.type === "directional" && sprite.pose === "seated" ? SEATED_CHARACTER_SCALE : 1) *
    scaleMultiplier;

  useImperativeHandle(ref, () => ({
    setPosition(xPct, yPct) {
      const el = wrapperRef.current;
      if (!el) return;
      el.style.left = `${xPct}%`;
      el.style.top = `${yPct}%`;
      el.style.zIndex = String(CHARACTER_Z_INDEX_BASE + Math.round(yPct * 100));
    },
    setZIndex(zIndex) {
      const el = wrapperRef.current;
      if (el) el.style.zIndex = String(zIndex);
    },
    setBob(offsetPx) {
      bobRef.current = offsetPx;
      applyTransform();
    },
    setScale(scale) {
      scaleRef.current = scale;
      const el = wrapperRef.current;
      if (el) el.style.transform = `translate(-50%, -100%) scale(${scaleRef.current * poseScale})`;
    },
    setFacing(input) {
      if (sprite.type === "static") {
        flippedRef.current = input as boolean;
        applyTransform();
        return;
      }

      // A pose change is committed by React just after the game loop detects
      // it. During that single transition frame, the previous directional
      // handle can receive the static sprite's boolean facing value. Ignore
      // it rather than indexing the direction map with `false` and assigning
      // the browser a literal `undefined` image URL.
      if (typeof input !== "string") return;
      const direction = input as SpriteDirection;
      if (direction === lastDirectionRef.current) return;
      lastDirectionRef.current = direction;
      const img = spriteRef.current;
      const nextSrc = directionalUrls?.[direction];
      if (img && nextSrc) img.src = nextSrc;
    },
    setState(next) {
      setState(next);
    },
  }));

  function applyTransform() {
    const img = spriteRef.current;
    if (!img) return;
    const directionScale = sprite.type === "directional" ? DIRECTIONAL_SPRITE_WIDTH_SCALE : 1;
    img.style.transform = `translateY(${bobRef.current}px) scaleX(${(flippedRef.current ? -1 : 1) * directionScale * horizontalScale})`;
  }

  return (
    <div
      ref={wrapperRef}
      className="absolute"
      style={{
        width: CHARACTER_BOX_WIDTH,
        height: SPRITE_HEIGHT,
        transform: "translate(-50%, -100%) scale(1)",
        transformOrigin: "bottom center",
      }}
    >
      <div className="relative" style={{ width: CHARACTER_BOX_WIDTH, height: SPRITE_HEIGHT }}>
        {speech && (
          <div
            className="office-speech-bubble absolute left-1/2 w-36 rounded-lg border border-sky-200/30 bg-slate-950/90 px-2 py-1 text-center text-[10px] leading-tight text-slate-100 shadow-lg"
            style={{ bottom: SPRITE_HEIGHT + 29, transform: "translateX(-50%)" }}
          >
            {speech}
          </div>
        )}

        {showStatus && (
          <>
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
          </>
        )}

        <div className="absolute bottom-0 left-1/2" style={{ height: SPRITE_HEIGHT, transform: "translateX(-50%)" }}>
          {/* Keep locomotion on a wrapper: the image's inline transform is
              updated at 60fps for facing/bobbing, so animating the image
              itself would make those transforms fight each other. */}
          <div
            className={`h-full ${
              state === "walking"
                ? "penguin-walk-cycle"
                : activity
                  ? `penguin-${activity}`
                  : ""
            }`}
          >
            {/* Character sprites change source imperatively as the game loop
                changes direction and pose. A native image is intentional here:
                Next/Image owns the rendered src and can overwrite those live
                updates, leaving state-transition sprites (such as sleeping
                Portfolio Penguin) broken. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={initialSrc}
              ref={spriteRef}
              src={initialSrc}
              alt={name}
              draggable={false}
              className="h-full w-auto select-none"
              style={{
                transformOrigin: "bottom center",
                // Global responsive-image styles cap wide static poses to
                // this narrow anchor wrapper. Sleeping sprites need their
                // natural aspect ratio so they lie across the pod mattress.
                maxWidth: sprite.type === "static" ? "none" : "100%",
                // The initial render has no movement tick yet, so apply the
                // directional width correction here as well.
                transform: `scaleX(${(sprite.type === "directional" ? DIRECTIONAL_SPRITE_WIDTH_SCALE : 1) * horizontalScale})`,
              }}
            />
          </div>
        </div>

        {showStatus && (
          <div
            className={`absolute left-1/2 rounded-full bg-black/35 ${state === "walking" ? "penguin-walk-shadow" : ""}`}
            style={{
              bottom: -3,
              width: 32,
              height: 9,
              transform: "translateX(-50%)",
              filter: "blur(1px)",
            }}
          />
        )}
      </div>
    </div>
  );
});
