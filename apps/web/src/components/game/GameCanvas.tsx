"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Character, type CharacterHandle, type SpriteDirection } from "./Character";
import { PigeonSprite } from "./PigeonSprite";
import { PigeonTooltip } from "./PigeonTooltip";
import { useGameStore, type PigeonInFlight } from "@/stores/gameStore";
import type { Agent, AgentState } from "@/types/agent";

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

interface OfficeStation {
  x: number;
  y: number;
}

// These anchors correspond to places in the room art. Agent state remains
// the source of truth; this is only the visual routine chosen for that state.
const OFFICE_STATIONS: Record<string, OfficeStation> = {
  library: { x: 17, y: 61 },
  desk: { x: 53, y: 69 },
  collaboration: { x: 47, y: 80 },
  cafe: { x: 74, y: 64 },
  support: { x: 84, y: 79 },
  entrance: { x: 10, y: 91 },
};

const STATE_STATION: Record<AgentState, keyof typeof OFFICE_STATIONS> = {
  idle: "cafe",
  walking: "entrance",
  planning: "collaboration",
  thinking: "desk",
  coding: "desk",
  researching: "library",
  meeting: "collaboration",
  blocked: "support",
  waiting: "cafe",
  sleeping: "cafe",
  debugging: "desk",
  error: "support",
  searching: "library",
  evaluating: "desk",
  coordinating: "collaboration",
};

const STATE_SPEECH: Partial<Record<AgentState, string>> = {
  planning: "Planning the next move…",
  thinking: "Thinking it through…",
  coding: "Typing away…",
  researching: "Reading the latest notes…",
  meeting: "In a penguin huddle…",
  blocked: "I need a hand here.",
  waiting: "Taking a coffee break…",
  sleeping: "Recharging for tomorrow…",
  debugging: "Chasing a tricky bug…",
  error: "Something needs attention.",
  searching: "Searching for fresh leads…",
  evaluating: "Comparing the options…",
  coordinating: "Coordinating the flock…",
};

const OFFICE_EVENTS = [
  { emoji: "🐟", text: "Fish delivery! The office is briefly distracted.", kind: "fish" },
  { emoji: "❄️", text: "Snowstorm outside — warm drinks are on.", kind: "snow" },
  { emoji: "☕", text: "Coffee machine fixed. Productivity restored.", kind: "coffee" },
  { emoji: "🖨️", text: "Printer jam! Someone has called IT.", kind: "printer" },
  { emoji: "🐦", text: "Pigeon convention in the lobby. Expect extra mail.", kind: "pigeon" },
] as const;

type OfficeEvent = (typeof OFFICE_EVENTS)[number];

interface NpcRuntime {
  pos: { x: number; y: number };
  target: { x: number; y: number };
  bobPhase: number;
  direction: SpriteDirection;
  routineState?: AgentState;
}

function officeLight(hour: number, mode: "auto" | "day" | "night"): "day" | "night" {
  if (mode === "day" || mode === "night") return mode;
  return hour >= 7 && hour < 19 ? "day" : "night";
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
  const playerDirection = useRef<SpriteDirection>("front-left");
  const playerBobPhase = useRef(Math.random() * Math.PI * 2);

  // One wander-AI runtime + DOM handle per agent, keyed by agent id.
  const npcRuntimeRef = useRef<Map<string, NpcRuntime>>(new Map());
  const npcHandlesRef = useRef<Map<string, CharacterHandle | null>>(new Map());

  const [hoveredPigeon, setHoveredPigeon] = useState<PigeonInFlight | null>(null);
  const [officeEvent, setOfficeEvent] = useState<OfficeEvent | null>(null);
  // Time is browser-local. Start neutral so server and client render the
  // same HTML, then adopt the local clock after hydration.
  const [clock, setClock] = useState<Date | null>(null);

  const agents = useGameStore((s) => s.agents);
  const pigeonsInFlight = useGameStore((s) => s.pigeonsInFlight);
  const removePigeon = useGameStore((s) => s.removePigeon);
  const agentSpeech = useGameStore((s) => s.agentSpeech);
  const officeModeEnabled = useGameStore((s) => s.officeModeEnabled);
  const officeTimeMode = useGameStore((s) => s.officeTimeMode);

  // Stable ordering so the same agent always gets the same sprite/index
  // across re-renders (the store keeps agents in a Record, whose
  // iteration order isn't something to rely on).
  const agentList = useMemo(
    () => Object.values(agents).sort((a, b) => a.id.localeCompare(b.id)),
    [agents]
  );

  const light = officeLight(clock?.getHours() ?? 12, officeTimeMode);

  useEffect(() => {
    setClock(new Date());
    const interval = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!officeModeEnabled) {
      setOfficeEvent(null);
      return;
    }

    let eventTimer: number | undefined;
    let dismissTimer: number | undefined;
    const scheduleEvent = (delay: number) => {
      eventTimer = window.setTimeout(() => {
        setOfficeEvent(OFFICE_EVENTS[Math.floor(Math.random() * OFFICE_EVENTS.length)]!);
        dismissTimer = window.setTimeout(() => setOfficeEvent(null), 7_000);
        scheduleEvent(45_000 + Math.random() * 45_000);
      }, delay);
    };
    scheduleEvent(15_000 + Math.random() * 15_000);

    return () => {
      if (eventTimer) window.clearTimeout(eventTimer);
      if (dismissTimer) window.clearTimeout(dismissTimer);
    };
  }, [officeModeEnabled]);

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
        playerDirection.current = getDirectionFromDelta(dx, dy);
      }

      playerBobPhase.current += delta * 0.08;
      playerRef.current?.setPosition(playerPos.current.x, playerPos.current.y);
      playerRef.current?.setBob(Math.sin(playerBobPhase.current) * 1.5);
      playerRef.current?.setFacing(playerDirection.current);

      // --- Agents: state-driven office routines ---
      const liveIds = new Set(agentList.map((a) => a.id));
      for (const id of npcRuntimeRef.current.keys()) {
        if (!liveIds.has(id)) npcRuntimeRef.current.delete(id);
      }

      for (const agent of agentList) {
        let runtime = npcRuntimeRef.current.get(agent.id);
        if (!runtime) {
          const start = { ...OFFICE_STATIONS.entrance! };
          const newRuntime: NpcRuntime = {
            pos: start,
            target: start,
            bobPhase: Math.random() * Math.PI * 2,
            direction: "front-left",
          };
          runtime = newRuntime;
          npcRuntimeRef.current.set(agent.id, newRuntime);
        }

        if (runtime.routineState !== agent.state) {
          runtime.routineState = agent.state;
          runtime.target = { ...OFFICE_STATIONS[STATE_STATION[agent.state]]! };
        }

        const tdx = runtime.target.x - runtime.pos.x;
        const tdy = runtime.target.y - runtime.pos.y;
        const distance = Math.sqrt(tdx * tdx + tdy * tdy);
        if (distance >= 0.5) {
          runtime.pos.x += (tdx / distance) * NPC_SPEED * delta;
          runtime.pos.y += (tdy / distance) * NPC_SPEED * delta;
          runtime.direction = getDirectionFromDelta(tdx, tdy);
        }

        runtime.bobPhase += delta * 0.08;

        const handle = npcHandlesRef.current.get(agent.id);
        handle?.setPosition(runtime.pos.x, runtime.pos.y);
        handle?.setBob(Math.sin(runtime.bobPhase) * 1.5);
        handle?.setFacing(runtime.direction);
        // Ring color reflects the agent's real backend state (idle,
        // coding, blocked, ...) rather than the cosmetic wander AI above.
        handle?.setState(distance >= 0.5 ? "walking" : agent.state);
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
      <Character ref={playerRef} name="Watty" sprite={{ type: "directional", base: "watty" }} />

      {officeModeEnabled && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 transition-colors duration-1000 ${
            light === "night" ? "bg-slate-950/40" : "bg-amber-100/5"
          }`}
          style={{ mixBlendMode: light === "night" ? "multiply" : "screen" }}
        />
      )}

      {officeModeEnabled && officeEvent && (
        <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border border-white/15 bg-slate-950/85 px-3 py-1.5 text-center text-xs text-slate-100 shadow-lg backdrop-blur">
          <span className="mr-1.5">{officeEvent.emoji}</span>
          {officeEvent.text}
        </div>
      )}

      {officeModeEnabled && officeEvent?.kind === "snow" && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden text-lg text-white/70">
          <span className="office-snowflake left-[12%]">❄</span>
          <span className="office-snowflake left-[38%] [animation-delay:1.2s]">❄</span>
          <span className="office-snowflake left-[67%] [animation-delay:2.4s]">❄</span>
          <span className="office-snowflake left-[88%] [animation-delay:0.6s]">❄</span>
        </div>
      )}

      {agentList.map((agent, i) => {
        const liveSpeech = agentSpeech[agent.id];
        const speech =
          liveSpeech && liveSpeech.expiresAt > (clock?.getTime() ?? 0)
            ? liveSpeech.text
            : STATE_SPEECH[agent.state];
        return (
        <AgentCharacter
          key={agent.id}
          agent={agent}
          spriteBase={AGENT_SPRITE_BASES[i % AGENT_SPRITE_BASES.length]!}
          speech={speech}
          onHandle={(h) => npcHandlesRef.current.set(agent.id, h)}
        />
        );
      })}

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
  speech,
  onHandle,
}: {
  agent: Agent;
  spriteBase: string;
  speech?: string;
  onHandle: (handle: CharacterHandle | null) => void;
}) {
  return (
    <Character
      ref={onHandle}
      name={agent.name}
      sprite={{ type: "directional", base: spriteBase }}
      speech={speech}
    />
  );
}
