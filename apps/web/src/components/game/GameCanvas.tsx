"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Character, type CharacterHandle, type SpriteDirection } from "./Character";
import { PigeonSprite } from "./PigeonSprite";
import { PigeonTooltip } from "./PigeonTooltip";
import { useGameStore, type PigeonInFlight } from "@/stores/gameStore";
import type { Agent, AgentState } from "@/types/agent";

// Room art is a fixed 1470x1070 screenshot (club-penguin-office-open.png) —
// everything below is a percentage of that box, the same coordinate
// system Claude-Office uses for its office room, so nothing needs
// recomputing on resize.
const ROOM_ASPECT_RATIO = "1470 / 1070";
const ROOM_ART_WIDTH = 1470;
const ROOM_ART_HEIGHT = 1070;
const CHARACTER_SCALE_MULTIPLIER = 2;

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

interface OfficeProp {
  id: string;
  name: string;
  src: string;
  defaultPosition: OfficeStation;
  width: number;
  /** Visual-only correction for props whose art needs to fit a room corner. */
  renderScale?: number;
  renderRotation?: number;
  renderOffset?: { x: number; y: number };
}

interface PlacedOfficeProp extends OfficeStation {
  width: number;
}

type CoffeePhase = "approaching" | "grinding" | "pouring" | "sipping";

// These anchors correspond to places in the room art. Agent state remains
// the source of truth; this is only the visual routine chosen for that state.
const OFFICE_STATIONS: Record<string, OfficeStation> = {
  library: { x: 17, y: 61 },
  desk: { x: 53, y: 69 },
  collaboration: { x: 47, y: 80 },
  cafe: { x: 74, y: 64 },
  support: { x: 84, y: 79 },
  // The old y:91 entrance point sat behind the foreground wall, which
  // made its penguin look as though it had disappeared. This places the
  // station on the visible floor directly in front of the staff door.
  entrance: { x: 65, y: 58 },
};

// Version this whenever the committed furniture layout changes materially.
// It prevents an outdated browser-saved arrangement (including old widths)
// from overriding the current room art's tuned defaults after an update.
const PROP_POSITIONS_STORAGE_KEY = "penguinhq.office-prop-positions.v2";
const PROP_DEFAULT_LAYOUT_STORAGE_KEY = "penguinhq.office-prop-default-layout.v2";
const PROP_MIN_WIDTH = 6;
const PROP_MAX_WIDTH = 30;
const PROP_SIZE_STEP = 1.5;

const OFFICE_PROPS: OfficeProp[] = [
  {
    id: "desk",
    name: "Developer desk",
    src: "/sprites/props/office-desk-v1.png",
    defaultPosition: { x: 15.21249836904824, y: 75.01831851202584 },
    width: 18.5,
  },
  {
    id: "research-workstation",
    name: "Research workstation",
    src: "/sprites/props/research-workstation.png",
    defaultPosition: { x: 29.00751681782516, y: 64.89467022576784 },
    width: 21.5,
  },
  {
    id: "collaboration-table",
    name: "Collaboration table",
    src: "/sprites/props/collaboration-table.png",
    defaultPosition: { x: 64.46926514850713, y: 94.57860674976644 },
    width: 25,
  },
  {
    id: "coffee-nook",
    name: "Coffee nook",
    src: "/sprites/props/coffee-nook.png",
    defaultPosition: { x: 78.66545937290859, y: 70.86629951225235 },
    width: 22.5,
  },
  {
    id: "build-server-rack",
    name: "Build server rack",
    src: "/sprites/props/build-server-rack-replacement.png",
    defaultPosition: { x: 85.08345165127676, y: 85.49700644585175 },
    width: 30,
    // A full-width rack overwhelms the right corner. Keep the editor's
    // logical width intact but render a narrower cabinet turned into the
    // right wall, so saved layouts remain compatible.
    renderScale: 0.82,
    renderRotation: 0,
    // Offset is relative to the prop's own size, so it continues to fit the
    // corner as the responsive office frame changes size.
    renderOffset: { x: 22, y: -10 },
  },
  {
    id: "planning-board",
    name: "Planning board",
    src: "/sprites/props/planning-board.png",
    defaultPosition: { x: 38.94131700446553, y: 52.05712143717095 },
    width: 18.5,
  },
  {
    id: "nap-pod",
    name: "Nap pod",
    src: "/sprites/props/nap-pod.png",
    defaultPosition: { x: 36.4704850403374, y: 88.67198290767973 },
    width: 19,
  },
];

function initialPropLayouts(): Record<string, PlacedOfficeProp> {
  return Object.fromEntries(
    OFFICE_PROPS.map((prop) => [prop.id, { ...prop.defaultPosition, width: prop.width }])
  );
}

function mergePropLayouts(
  base: Record<string, PlacedOfficeProp>,
  saved: Record<string, Partial<PlacedOfficeProp>>
): Record<string, PlacedOfficeProp> {
  const merged = { ...base };
  for (const prop of OFFICE_PROPS) {
    const layout = saved[prop.id];
    if (typeof layout?.x === "number" && typeof layout.y === "number") {
      merged[prop.id] = {
        x: clamp(layout.x, MARGIN_X, 100 - MARGIN_X),
        y: clamp(layout.y, WALKABLE_MIN_Y, WALKABLE_MAX_Y),
        width:
          typeof layout.width === "number"
            ? clamp(layout.width, PROP_MIN_WIDTH, PROP_MAX_WIDTH)
            : base[prop.id]!.width,
      };
    }
  }
  return merged;
}

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

// Every specialist has a permanent visible station. Work state changes the
// ring, speech, and animation, not their home location, so the office stays
// populated instead of emptying one area whenever several agents share a
// state such as "searching" or "meeting".
const HOME_STATION_BY_ROLE: Record<string, keyof typeof OFFICE_STATIONS> = {
  tech_scout: "library",
  portfolio: "desk",
  job_hunter: "entrance",
  leetcode_coach: "collaboration",
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
  routineKey?: string;
}

const FISH_DELIVERY_POSITION = { x: 76, y: 77 };

type TableMeetingSlot = {
  /** Anchor measured from the collaboration prop's bottom-centre origin. */
  x: number;
  y: number;
  direction: SpriteDirection;
  /** Sitting is only valid where the furniture has an actual stool. */
  pose: "seated" | "standing";
  /** Rear attendees must be occluded by the table, like a real game scene. */
  depth: "front" | "rear";
};

// A table should model capacity, rather than forcing every nearby character
// into a generic "seated" pose. This prop has exactly three visible stools:
// left coral, front aqua, and right yellow. The remaining two flock members
// take standing discussion slots behind the tabletop, where the furniture
// naturally occludes their lower bodies.
//
// Every point is local to the prop's bottom-centre origin and scales with its
// width, so moving/resizing the furniture cannot break the meeting formation.
const TABLE_MEETING_SLOTS: readonly TableMeetingSlot[] = [
  { x: -0.294, y: -0.237, direction: "front-right", pose: "seated", depth: "front" },
  { x: 0, y: -0.127, direction: "front-left", pose: "seated", depth: "front" },
  { x: 0.303, y: -0.237, direction: "front-left", pose: "seated", depth: "front" },
  { x: -0.19, y: -0.49, direction: "rear-right", pose: "standing", depth: "rear" },
  { x: 0.19, y: -0.49, direction: "rear-left", pose: "standing", depth: "rear" },
] as const;

// Watty owns the central chair. The four specialists take the left, right,
// then rear discussion positions in stable agent-list order.
const AGENT_TABLE_SLOT_INDICES = [0, 2, 3, 4] as const;
const WATTY_TABLE_SLOT_INDEX = 1;

// Prop widths are percentages of the room's width, while `top` is a
// percentage of its height. Convert vertical offsets measured from a square
// prop image before adding them to a room-space y coordinate; without this,
// seats drift down onto the tabletop in our non-square 1470x1070 room.
const PROP_WIDTH_TO_ROOM_Y = ROOM_ART_WIDTH / ROOM_ART_HEIGHT;

// The pod image is positioned from its bottom-centre. This anchor lands
// Watty's feet on the mattress, inside the open doorway, and scales with
// the prop when the user resizes it.
const NAP_POD_SLEEP_ANCHOR = { x: 0.02, y: -0.27 } as const;
const COFFEE_MAKER_ANCHOR = { x: 0.06, y: 0.03 } as const;

function fishGatherPosition(index: number): OfficeStation {
  const spots = [
    { x: 69, y: 78 },
    { x: 73, y: 83 },
    { x: 79, y: 84 },
    { x: 84, y: 79 },
  ];
  return spots[index % spots.length]!;
}

function officeLight(hour: number, mode: "auto" | "day" | "night"): "day" | "night" {
  if (mode === "day" || mode === "night") return mode;
  return hour >= 7 && hour < 19 ? "day" : "night";
}

function stationForAgent(agent: Agent): OfficeStation {
  const stationKey = HOME_STATION_BY_ROLE[agent.role] ?? STATE_STATION[agent.state];
  return { ...OFFICE_STATIONS[stationKey]! };
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
  const roomRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<CharacterHandle>(null);
  const pressedRef = useRef<Set<string>>(new Set());
  const roomScaleRef = useRef(1);
  const propDragRef = useRef<{ id: string; offset: OfficeStation } | null>(null);

  const playerPos = useRef({ x: 50, y: 80 });
  const playerDirection = useRef<SpriteDirection>("front-left");
  const playerBobPhase = useRef(Math.random() * Math.PI * 2);

  // One wander-AI runtime + DOM handle per agent, keyed by agent id.
  const npcRuntimeRef = useRef<Map<string, NpcRuntime>>(new Map());
  const npcHandlesRef = useRef<Map<string, CharacterHandle | null>>(new Map());

  const [hoveredPigeon, setHoveredPigeon] = useState<PigeonInFlight | null>(null);
  const [officeEvent, setOfficeEvent] = useState<OfficeEvent | null>(null);
  const [propLayouts, setPropLayouts] = useState<Record<string, PlacedOfficeProp>>(initialPropLayouts);
  const [savedDefaultLayouts, setSavedDefaultLayouts] =
    useState<Record<string, PlacedOfficeProp>>(initialPropLayouts);
  const [draggingPropId, setDraggingPropId] = useState<string | null>(null);
  const [selectedPropId, setSelectedPropId] = useState<string | null>(null);
  const [flockSeated, setFlockSeated] = useState(false);
  const [playerSleeping, setPlayerSleeping] = useState(false);
  const [coffeePhase, setCoffeePhase] = useState<CoffeePhase | null>(null);
  const [propPositionsLoaded, setPropPositionsLoaded] = useState(false);
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
  const collaborationTable = propLayouts["collaboration-table"];
  const napPod = propLayouts["nap-pod"];
  const coffeeNook = propLayouts["coffee-nook"];

  const tableMeetingSlot = (slotIndex: number): TableMeetingSlot =>
    TABLE_MEETING_SLOTS[slotIndex % TABLE_MEETING_SLOTS.length]!;

  const tableMeetingZIndex = (slotIndex: number): number => {
    const table = collaborationTable ?? { x: 59, y: 91, width: 25 };
    const tableZIndex = Math.round(table.y * 100) - 1;
    return tableMeetingSlot(slotIndex).depth === "rear" ? tableZIndex - 2 : tableZIndex + 3;
  };

  const tableMeetingPosition = (slotIndex: number): OfficeStation => {
    const table = collaborationTable ?? { x: 59, y: 91, width: 25 };
    const anchor = tableMeetingSlot(slotIndex);
    return {
      x: table.x + table.width * anchor.x,
      y: table.y + table.width * anchor.y * PROP_WIDTH_TO_ROOM_Y,
    };
  };

  const sleepingPosition = (): OfficeStation => {
    const pod = napPod ?? { x: 33.1, y: 91.2, width: 19 };
    return {
      x: pod.x + pod.width * NAP_POD_SLEEP_ANCHOR.x,
      y: pod.y + pod.width * NAP_POD_SLEEP_ANCHOR.y * PROP_WIDTH_TO_ROOM_Y,
    };
  };

  const coffeeMakerPosition = (): OfficeStation => {
    const nook = coffeeNook ?? { x: 75.7, y: 67.1, width: 22.5 };
    return {
      x: nook.x + nook.width * COFFEE_MAKER_ANCHOR.x,
      y: nook.y + nook.width * COFFEE_MAKER_ANCHOR.y,
    };
  };

  useEffect(() => {
    if (coffeePhase !== "grinding" && coffeePhase !== "pouring" && coffeePhase !== "sipping") return;
    const delay = coffeePhase === "grinding" ? 1_450 : coffeePhase === "pouring" ? 1_350 : 2_400;
    const timer = window.setTimeout(() => {
      setCoffeePhase((phase) =>
        phase === "grinding" ? "pouring" : phase === "pouring" ? "sipping" : null
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [coffeePhase]);

  useEffect(() => {
    setClock(new Date());
    const interval = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    try {
      const initial = initialPropLayouts();
      const savedDefaults = window.localStorage.getItem(PROP_DEFAULT_LAYOUT_STORAGE_KEY);
      const defaults = savedDefaults
        ? mergePropLayouts(initial, JSON.parse(savedDefaults) as Record<string, Partial<PlacedOfficeProp>>)
        : initial;
      const savedLayout = window.localStorage.getItem(PROP_POSITIONS_STORAGE_KEY);
      const layout = savedLayout
        ? mergePropLayouts(defaults, JSON.parse(savedLayout) as Record<string, Partial<PlacedOfficeProp>>)
        : defaults;
      // On first upgrade to saved defaults, keep the user's existing room
      // arrangement as the new reset point instead of reverting it.
      const defaultLayout = savedDefaults ? defaults : layout;
      if (!savedDefaults) {
        window.localStorage.setItem(PROP_DEFAULT_LAYOUT_STORAGE_KEY, JSON.stringify(defaultLayout));
      }
      setSavedDefaultLayouts(defaultLayout);
      setPropLayouts(layout);
    } catch {
      // Ignore malformed local storage and use the default room layout.
    } finally {
      setPropPositionsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!propPositionsLoaded) return;
    window.localStorage.setItem(PROP_POSITIONS_STORAGE_KEY, JSON.stringify(propLayouts));
  }, [propLayouts, propPositionsLoaded]);

  // Characters are authored against the room image's native 1469px width.
  // ResizeObserver keeps their pixel dimensions in lockstep with the CSS
  // background as the room grows or shrinks with the viewport.
  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const updateScale = () => {
      roomScaleRef.current = room.clientWidth / ROOM_ART_WIDTH;
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(room);
    return () => observer.disconnect();
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

      if (coffeePhase && (dx !== 0 || dy !== 0)) setCoffeePhase(null);
      const walkingToCoffee = coffeePhase === "approaching";
      const playerMoving = !flockSeated && !playerSleeping && !walkingToCoffee && (dx !== 0 || dy !== 0);
      playerRef.current?.setState(
        playerSleeping
          ? "sleeping"
          : flockSeated
            ? "meeting"
            : walkingToCoffee
              ? "walking"
              : coffeePhase
                ? "waiting"
                : playerMoving
                  ? "walking"
                  : "idle"
      );

      if (walkingToCoffee) {
        const target = coffeeMakerPosition();
        const cdx = target.x - playerPos.current.x;
        const cdy = target.y - playerPos.current.y;
        const distance = Math.sqrt(cdx * cdx + cdy * cdy);
        if (distance < 0.45) {
          playerPos.current = target;
          playerDirection.current = "rear-left";
          setCoffeePhase("grinding");
        } else {
          playerPos.current.x += (cdx / distance) * PLAYER_SPEED * delta;
          playerPos.current.y += (cdy / distance) * PLAYER_SPEED * delta;
          playerDirection.current = getDirectionFromDelta(cdx, cdy);
        }
      } else if (playerMoving) {
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
      const playerDisplayPosition = playerSleeping
        ? sleepingPosition()
        : flockSeated
          ? tableMeetingPosition(WATTY_TABLE_SLOT_INDEX)
          : playerPos.current;
      playerRef.current?.setPosition(playerDisplayPosition.x, playerDisplayPosition.y);
      if (flockSeated) playerRef.current?.setZIndex(tableMeetingZIndex(WATTY_TABLE_SLOT_INDEX));
      playerRef.current?.setScale(
        roomScaleRef.current * CHARACTER_SCALE_MULTIPLIER * (playerSleeping ? 0.62 : 1)
      );
      playerRef.current?.setBob(playerSleeping ? 0 : Math.sin(playerBobPhase.current) * 1.5);
      playerRef.current?.setFacing(
        playerSleeping ? false : coffeePhase && coffeePhase !== "approaching" ? "rear-left" : playerDirection.current
      );

      // --- Agents: state-driven office routines ---
      const liveIds = new Set(agentList.map((a) => a.id));
      for (const id of npcRuntimeRef.current.keys()) {
        if (!liveIds.has(id)) npcRuntimeRef.current.delete(id);
      }

      for (const [agentIndex, agent] of agentList.entries()) {
        const tableSlotIndex = AGENT_TABLE_SLOT_INDICES[agentIndex % AGENT_TABLE_SLOT_INDICES.length]!;
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

        const fishDeliveryActive = !flockSeated && officeEvent?.kind === "fish";
        const routineKey = flockSeated
          ? `seated:${agentIndex}`
          : fishDeliveryActive
            ? `fish:${agentIndex}`
            : `home:${agent.role}`;
        if (runtime.routineKey !== routineKey) {
          runtime.routineKey = routineKey;
          runtime.target = flockSeated
            ? tableMeetingPosition(tableSlotIndex)
            : fishDeliveryActive
              ? { ...fishGatherPosition(agentIndex) }
              : stationForAgent(agent);
        }

        if (flockSeated) runtime.pos = { ...runtime.target };

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
        if (flockSeated) handle?.setZIndex(tableMeetingZIndex(tableSlotIndex));
        handle?.setScale(roomScaleRef.current * CHARACTER_SCALE_MULTIPLIER);
        handle?.setBob(flockSeated ? 0 : Math.sin(runtime.bobPhase) * 1.5);
        handle?.setFacing(flockSeated ? tableMeetingSlot(tableSlotIndex).direction : runtime.direction);
        // Ring color reflects the agent's real backend state (idle,
        // coding, blocked, ...) rather than the cosmetic wander AI above.
        handle?.setState(flockSeated ? "meeting" : distance >= 0.5 ? "walking" : agent.state);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [agentList, officeEvent, flockSeated, playerSleeping, coffeePhase, collaborationTable, napPod, coffeeNook]);

  const beginPropDrag = (event: React.PointerEvent<HTMLButtonElement>, prop: OfficeProp) => {
    const room = roomRef.current;
    const position = propLayouts[prop.id];
    if (!room || !position) return;

    const bounds = room.getBoundingClientRect();
    propDragRef.current = {
      id: prop.id,
      offset: {
        x: ((event.clientX - bounds.left) / bounds.width) * 100 - position.x,
        y: ((event.clientY - bounds.top) / bounds.height) * 100 - position.y,
      },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingPropId(prop.id);
    setSelectedPropId(prop.id);
  };

  const moveProp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const room = roomRef.current;
    const drag = propDragRef.current;
    if (!room || !drag) return;

    const bounds = room.getBoundingClientRect();
    const pointerPosition = {
      x: ((event.clientX - bounds.left) / bounds.width) * 100,
      y: ((event.clientY - bounds.top) / bounds.height) * 100,
    };
    setPropLayouts((current) => ({
      ...current,
      [drag.id]: {
        ...current[drag.id]!,
        x: clamp(pointerPosition.x - drag.offset.x, MARGIN_X, 100 - MARGIN_X),
        y: clamp(pointerPosition.y - drag.offset.y, WALKABLE_MIN_Y, WALKABLE_MAX_Y),
      },
    }));
  };

  const endPropDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    propDragRef.current = null;
    setDraggingPropId(null);
  };

  const resetPropPositions = () => {
    propDragRef.current = null;
    setDraggingPropId(null);
    setSelectedPropId(null);
    setPropLayouts(savedDefaultLayouts);
  };

  const saveCurrentAsDefault = () => {
    setSavedDefaultLayouts(propLayouts);
    window.localStorage.setItem(PROP_DEFAULT_LAYOUT_STORAGE_KEY, JSON.stringify(propLayouts));
  };

  const resizeProp = (id: string, delta: number) => {
    setPropLayouts((current) => ({
      ...current,
      [id]: {
        ...current[id]!,
        width: clamp(current[id]!.width + delta, PROP_MIN_WIDTH, PROP_MAX_WIDTH),
      },
    }));
  };

  return (
    <div
      ref={roomRef}
      className="relative mx-auto h-auto w-full overflow-hidden rounded-xl bg-cover bg-center"
      style={{
        aspectRatio: ROOM_ASPECT_RATIO,
        maxHeight: "100%",
        backgroundImage: "url(/sprites/club-penguin-office-open.png)",
      }}
    >
      <Character
        ref={playerRef}
        name="Watty"
        speech={
          playerSleeping
            ? "Zzz…"
            : coffeePhase === "approaching"
              ? "Coffee time!"
              : coffeePhase === "grinding"
                ? "Grinding beans…"
                : coffeePhase === "pouring"
                  ? "Steady pour…"
                  : coffeePhase === "sipping"
                    ? "Ahh, perfect."
                    : undefined
        }
        showStatus={!playerSleeping && !flockSeated}
        sprite={
          playerSleeping
            ? { type: "static", url: "/sprites/agents/watty-sleeping.png" }
            : {
                type: "directional",
                base: "watty",
                pose: flockSeated && tableMeetingSlot(WATTY_TABLE_SLOT_INDEX).pose === "seated"
                  ? "seated"
                  : "standing",
              }
        }
      />

      {OFFICE_PROPS.map((prop) => {
        const layout = propLayouts[prop.id] ?? { ...prop.defaultPosition, width: prop.width };
        const dragging = draggingPropId === prop.id;
        const selected = selectedPropId === prop.id;
        return (
          <button
            key={prop.id}
            type="button"
            aria-label={`Move ${prop.name}`}
            title={`Drag to move ${prop.name}`}
            onPointerDown={(event) => beginPropDrag(event, prop)}
            onPointerMove={moveProp}
            onPointerUp={endPropDrag}
            onPointerCancel={endPropDrag}
            className={`absolute touch-none select-none transition-[filter] ${
              dragging
                ? "cursor-grabbing brightness-110"
                : selected
                  ? "cursor-grab brightness-110 drop-shadow-[0_0_8px_rgba(125,211,252,0.85)]"
                  : "cursor-grab hover:brightness-110"
            }`}
            style={{
              left: `${layout.x}%`,
              top: `${layout.y}%`,
              width: `${layout.width}%`,
              zIndex: Math.round(layout.y * 100) - 1,
              transform: `translate(-50%, -100%) translate(${prop.renderOffset?.x ?? 0}%, ${prop.renderOffset?.y ?? 0}%) rotate(${prop.renderRotation ?? 0}deg) scale(${prop.renderScale ?? 1})`,
            }}
          >
            <img src={prop.src} alt="" draggable={false} className="block h-auto w-full" />
          </button>
        );
      })}

      {selectedPropId && (() => {
        const prop = OFFICE_PROPS.find((candidate) => candidate.id === selectedPropId);
        const layout = prop ? propLayouts[prop.id] : undefined;
        if (!prop || !layout) return null;
        return (
          <div
            className="absolute z-[10050] flex items-center gap-1 rounded-md border border-sky-200/50 bg-slate-950/90 p-1 shadow-lg"
            style={{
              left: `${layout.x}%`,
              top: `${Math.max(4, layout.y - 12)}%`,
              transform: "translateX(-50%)",
            }}
          >
            <button
              type="button"
              aria-label={`Make ${prop.name} smaller`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => resizeProp(prop.id, -PROP_SIZE_STEP)}
              className="rounded px-2 py-0.5 text-sm font-bold text-slate-100 hover:bg-white/10"
            >
              −
            </button>
            <span className="max-w-28 truncate px-1 text-[10px] text-sky-100">{prop.name}</span>
            <button
              type="button"
              aria-label={`Make ${prop.name} larger`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => resizeProp(prop.id, PROP_SIZE_STEP)}
              className="rounded px-2 py-0.5 text-sm font-bold text-slate-100 hover:bg-white/10"
            >
              +
            </button>
            {prop.id === "collaboration-table" && (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setPlayerSleeping(false);
                  setCoffeePhase(null);
                  setFlockSeated((seated) => !seated);
                }}
                className="ml-1 rounded bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-100 hover:bg-sky-400/30"
              >
                {flockSeated ? "Stand flock" : "Seat flock"}
              </button>
            )}
            {prop.id === "nap-pod" && (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setFlockSeated(false);
                  setCoffeePhase(null);
                  setPlayerSleeping((sleeping) => !sleeping);
                }}
                className="ml-1 rounded bg-indigo-500/25 px-2 py-0.5 text-[10px] font-semibold text-indigo-100 hover:bg-indigo-400/35"
              >
                {playerSleeping ? "Wake Watty" : "Sleep Watty"}
              </button>
            )}
            {prop.id === "coffee-nook" && (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setFlockSeated(false);
                  setPlayerSleeping(false);
                  setCoffeePhase((phase) => (phase ? null : "approaching"));
                }}
                className="ml-1 rounded bg-amber-500/25 px-2 py-0.5 text-[10px] font-semibold text-amber-100 hover:bg-amber-400/35"
              >
                {coffeePhase ? "Cancel coffee" : "Make coffee"}
              </button>
            )}
          </div>
        );
      })()}

      {coffeePhase && coffeePhase !== "approaching" && coffeeNook && (
        <div
          aria-label={`Coffee is ${coffeePhase}`}
          className={`office-coffee-action office-coffee-action--${coffeePhase} pointer-events-none absolute`}
          style={{
            left: `${coffeeNook.x + coffeeNook.width * 0.08}%`,
            top: `${coffeeNook.y - coffeeNook.width * 0.43}%`,
            zIndex: Math.round(coffeeNook.y * 100) + 20_000,
          }}
        >
          <span className="office-coffee-cup">☕</span>
          <span className="office-coffee-steam">〰</span>
          <span className="office-coffee-spark">✦</span>
        </div>
      )}

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

      {officeModeEnabled && officeEvent?.kind === "fish" && (
        <div
          aria-label="Fresh fish delivery"
          className="office-fish-delivery pointer-events-none absolute"
          style={{
            left: `${FISH_DELIVERY_POSITION.x}%`,
            top: `${FISH_DELIVERY_POSITION.y}%`,
            zIndex: Math.round(FISH_DELIVERY_POSITION.y * 100),
          }}
        >
          <img src="/sprites/fish-delivery.webp" alt="A cooler filled with fresh fish" />
          <span>Fresh catch!</span>
        </div>
      )}

      {agentList.map((agent, i) => {
        const liveSpeech = agentSpeech[agent.id];
        const tableSlotIndex = AGENT_TABLE_SLOT_INDICES[i % AGENT_TABLE_SLOT_INDICES.length]!;
        const speech =
          liveSpeech && liveSpeech.expiresAt > (clock?.getTime() ?? 0)
            ? liveSpeech.text
            : STATE_SPEECH[agent.state];
        return (
        <AgentCharacter
          key={agent.id}
          agent={agent}
          spriteBase={AGENT_SPRITE_BASES[i % AGENT_SPRITE_BASES.length]!}
          seated={flockSeated && tableMeetingSlot(tableSlotIndex).pose === "seated"}
          inMeeting={flockSeated}
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
        WASD / arrow keys to move · Drag furniture to place it · Select furniture to resize
      </div>
      <button
        type="button"
        onClick={resetPropPositions}
        className="absolute bottom-3 right-3 rounded-md border border-white/15 bg-slate-950/70 px-2 py-1 text-xs text-slate-200 transition-colors hover:bg-slate-800"
      >
        Reset furniture
      </button>
      <button
        type="button"
        onClick={saveCurrentAsDefault}
        className="absolute bottom-3 right-28 rounded-md border border-sky-200/30 bg-sky-950/70 px-2 py-1 text-xs text-sky-100 transition-colors hover:bg-sky-900"
      >
        Save as default
      </button>
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
  seated,
  inMeeting,
  speech,
  onHandle,
}: {
  agent: Agent;
  spriteBase: string;
  seated: boolean;
  inMeeting: boolean;
  speech?: string;
  onHandle: (handle: CharacterHandle | null) => void;
}) {
  return (
    <Character
      ref={onHandle}
      name={agent.name}
      sprite={{ type: "directional", base: spriteBase, pose: seated ? "seated" : "standing" }}
      speech={speech}
      showStatus={!inMeeting}
    />
  );
}
