"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Character, type CharacterHandle, type SpriteDirection } from "./Character";
import { PigeonSprite } from "./PigeonSprite";
import { PigeonTooltip } from "./PigeonTooltip";
import { useGameStore, type PigeonInFlight } from "@/stores/gameStore";
import type { Agent } from "@/types/agent";

// Room art is a fixed 1469x1071 screenshot (club_penguin_office.png) —
// everything below is a percentage of that box, the same coordinate
// system Claude-Office uses for its office room, so nothing needs
// recomputing on resize.
const ROOM_ASPECT_RATIO = "1469 / 1071";

// The back wall (windows/door/water cooler) occupies roughly the top 44%
// of the room art; the open floor below that is where penguins can walk.
const WALKABLE_MIN_Y = 44;
const WALKABLE_MAX_Y = 96;
const MARGIN_X = 4;

const PLAYER_SPEED = 0.32; // % of room width per frame at delta=1 (60fps)
const NPC_SPEED = 0.11;
const NPC_IDLE_MIN_MS = 1500;
const NPC_IDLE_MAX_MS = 4000;

// The 4 named penguin sprites we have art for. Agents beyond the 4th
// cycle back through this list rather than needing a 1:1 asset per agent.
const AGENT_SPRITE_BASES = ["bluey", "kip", "luna", "ziggy"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Ported from Claude-Office's Character.tsx — same slightly-quirky
// isometric 4-way mapping, kept identical since our sprite sheet uses
// their exact direction-naming convention (front-left/front-right/
// rear-left/rear-right).
function getDirectionFromDelta(dx: number, dy: number): SpriteDirection {
  if (dy < 0 && dx >= 0) return "front-left";
  if (dy < 0 && dx < 0) return "front-right";
  if (dy >= 0 && dx >= 0) return "rear-left";
  return "front-left";
}

interface NpcRuntime {
  pos: { x: number; y: number };
  target: { x: number; y: number };
  idleUntil: number;
  bobPhase: number;
  direction: SpriteDirection;
}

function randomWalkable(): { x: number; y: number } {
  return {
    x: MARGIN_X + Math.random() * (100 - MARGIN_X * 2),
    y: WALKABLE_MIN_Y + Math.random() * (WALKABLE_MAX_Y - WALKABLE_MIN_Y),
  };
}

/**
 * React <-> game-loop boundary — the DOM/CSS equivalent of what
 * PixiApp.ts used to do. There's no canvas here at all: the room is a
 * background-image div and every character is an <img>-based Character
 * component positioned with plain `left`/`top` percentages.
 *
 * Position updates happen every animation frame, but go straight through
 * the imperative CharacterHandle refs rather than React state — the same
 * reason Claude-Office keeps its per-frame sway/movement out of React
 * state, just done here with rAF instead of CSS transitions, since WASD
 * needs continuously-updated positions rather than "glide to a waypoint".
 */
export function GameCanvas() {
  const playerRef = useRef<CharacterHandle>(null);
  const pressedRef = useRef<Set<string>>(new Set());

  const playerPos = useRef({ x: 50, y: 80 });
  const playerFlipped = useRef(false);
  const playerBobPhase = useRef(Math.random() * Math.PI * 2);

  // One wander-AI runtime + DOM handle per agent, keyed by agent id.
  const npcRuntimeRef = useRef<Map<string, NpcRuntime>>(new Map());
  const npcHandlesRef = useRef<Map<string, CharacterHandle | null>>(new Map());

  const [hoveredPigeon, setHoveredPigeon] = useState<PigeonInFlight | null>(null);

  const agents = useGameStore((s) => s.agents);
  const pigeonsInFlight = useGameStore((s) => s.pigeonsInFlight);
  const removePigeon = useGameStore((s) => s.removePigeon);

  // Stable ordering so the same agent always gets the same sprite/index
  // across re-renders (the store keeps agents in a Record, whose
  // iteration order isn't something to rely on).
  const agentList = useMemo(
    () => Object.values(agents).sort((a, b) => a.id.localeCompare(b.id)),
    [agents]
  );

  // Keyboard input — tracked in a ref (not state) since it's read every
  // frame by the game loop below, not something React needs to react to.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => pressedRef.current.add(e.key.toLowerCase());
    const onKeyUp = (e: KeyboardEvent) => pressedRef.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    let rafId = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const delta = Math.min((now - last) / (1000 / 60), 4);
      last = now;

      // --- Player: WASD/arrow keys ---
      const pressed = pressedRef.current;
      let dx = 0;
      let dy = 0;
      if (pressed.has("w") || pressed.has("arrowup")) dy -= 1;
      if (pressed.has("s") || pressed.has("arrowdown")) dy += 1;
      if (pressed.has("a") || pressed.has("arrowleft")) dx -= 1;
      if (pressed.has("d") || pressed.has("arrowright")) dx += 1;

      const playerMoving = dx !== 0 || dy !== 0;
      playerRef.current?.setState(playerMoving ? "walking" : "idle");

      if (playerMoving) {
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        playerPos.current.x = clamp(
          playerPos.current.x + (dx / len) * PLAYER_SPEED * delta,
          MARGIN_X,
          100 - MARGIN_X
        );
        playerPos.current.y = clamp(
          playerPos.current.y + (dy / len) * PLAYER_SPEED * delta,
          WALKABLE_MIN_Y,
          WALKABLE_MAX_Y
        );
        if (dx !== 0) playerFlipped.current = dx < 0;
      }

      playerBobPhase.current += delta * 0.08;
      playerRef.current?.setPosition(playerPos.current.x, playerPos.current.y);
      playerRef.current?.setBob(Math.sin(playerBobPhase.current) * 1.5);
      playerRef.current?.setFacing(playerFlipped.current);

      // --- Agents: wander AI (pick a point, walk to it, idle, repeat) ---
      const npcNow = performance.now();
      const liveIds = new Set(agentList.map((a) => a.id));
      for (const id of npcRuntimeRef.current.keys()) {
        if (!liveIds.has(id)) npcRuntimeRef.current.delete(id);
      }

      for (const agent of agentList) {
        let runtime = npcRuntimeRef.current.get(agent.id);
        if (!runtime) {
          const start = randomWalkable();
          runtime = {
            pos: start,
            target: start,
            idleUntil: npcNow + Math.random() * NPC_IDLE_MAX_MS,
            bobPhase: Math.random() * Math.PI * 2,
            direction: "front-left",
          };
          npcRuntimeRef.current.set(agent.id, runtime);
        }

        if (npcNow >= runtime.idleUntil) {
          const tdx = runtime.target.x - runtime.pos.x;
          const tdy = runtime.target.y - runtime.pos.y;
          const distance = Math.sqrt(tdx * tdx + tdy * tdy);

          if (distance < 1) {
            runtime.idleUntil =
              npcNow + NPC_IDLE_MIN_MS + Math.random() * (NPC_IDLE_MAX_MS - NPC_IDLE_MIN_MS);
            runtime.target = randomWalkable();
          } else {
            runtime.pos.x += (tdx / distance) * NPC_SPEED * delta;
            runtime.pos.y += (tdy / distance) * NPC_SPEED * delta;
            runtime.direction = getDirectionFromDelta(tdx, tdy);
          }
        }

        runtime.bobPhase += delta * 0.08;

        const handle = npcHandlesRef.current.get(agent.id);
        handle?.setPosition(runtime.pos.x, runtime.pos.y);
        handle?.setBob(Math.sin(runtime.bobPhase) * 1.5);
        handle?.setFacing(runtime.direction);
        // Ring color reflects the agent's real backend state (idle,
        // coding, blocked, ...) rather than the cosmetic wander AI above.
        handle?.setState(agent.state);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [agentList]);

  return (
    <div
      className="relative mx-auto h-auto w-full overflow-hidden rounded-xl bg-cover bg-center"
      style={{
        aspectRatio: ROOM_ASPECT_RATIO,
        maxHeight: "100%",
        backgroundImage: "url(/sprites/club-penguin-office.webp)",
      }}
    >
      <Character ref={playerRef} name="You" sprite={{ type: "static", url: "/sprites/penguin-blue.webp" }} />

      {agentList.map((agent, i) => (
        <AgentCharacter
          key={agent.id}
          agent={agent}
          spriteBase={AGENT_SPRITE_BASES[i % AGENT_SPRITE_BASES.length]!}
          onHandle={(h) => npcHandlesRef.current.set(agent.id, h)}
        />
      ))}

      {pigeonsInFlight.map((pigeon) => (
        <PigeonSprite
          key={pigeon.id}
          pigeon={pigeon}
          onArrive={() => removePigeon(pigeon.id)}
          onHoverChange={(hovering) => setHoveredPigeon(hovering ? pigeon : null)}
        />
      ))}

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/40 px-2 py-1 text-xs text-slate-300">
        WASD / arrow keys to move
      </div>
      {hoveredPigeon && <PigeonTooltip data={hoveredPigeon} />}
    </div>
  );
}

/** Thin wrapper so each agent's imperative handle can be registered into
 * the parent's Map via a plain callback, without needing forwardRef
 * gymnastics at the call site above. */
function AgentCharacter({
  agent,
  spriteBase,
  onHandle,
}: {
  agent: Agent;
  spriteBase: string;
  onHandle: (handle: CharacterHandle | null) => void;
}) {
  return (
    <Character
      ref={onHandle}
      name={agent.name}
      sprite={{ type: "directional", base: spriteBase }}
    />
  );
}
