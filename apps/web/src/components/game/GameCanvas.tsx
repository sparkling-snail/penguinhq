"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Character, type CharacterHandle, type SpriteDirection } from "./Character";
import { PigeonSprite } from "./PigeonSprite";
import { PigeonTooltip } from "./PigeonTooltip";
import { useGameStore, type PigeonInFlight } from "@/stores/gameStore";
import type { Agent, AgentState } from "@/types/agent";

// Room art is a fixed 1470x1070 screenshot (office-background.png) —
// everything below is a percentage of that box, the same coordinate
// system Claude-Office (github.com/W17ant/Claude-Office, MIT) uses for its office room, so nothing needs
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
const MEETING_WALK_SPEED = 0.23;
// Let each cosmetic activity read as a deliberate work session. Agents now
// remain at a station for 90–150 seconds before choosing their next stop.
const AUTONOMY_STEP_MIN_MS = 90_000;
const AUTONOMY_STEP_JITTER_MS = 60_000;

// The 4 named penguin sprites we have art for. Agents beyond the 4th
// cycle back through this list rather than needing a 1:1 asset per agent.
const AGENT_SPRITE_BASES = ["bluey", "kip", "luna", "ziggy"];
const AGENT_SPRITE_BY_ROLE: Record<string, string> = {
  job_hunter: "bluey",
  leetcode_coach: "kip",
  tech_scout: "luna",
  portfolio: "ziggy",
};

// Only the three real table-chair facings need the stool-free seated art.
// Other directions intentionally fall back to the original seated sprites.
const SEATED_NO_STOOL_SPRITES: Partial<Record<string, Partial<Record<SpriteDirection, string>>>> = {
  bluey: {
    "front-left": "/sprites/agents/bluey-seated-nostool-front-left.png",
    "front-right": "/sprites/agents/bluey-seated-nostool-front-right.png",
  },
  kip: {
    "front-left": "/sprites/agents/kip-seated-nostool-front-left.png",
    "front-right": "/sprites/agents/kip-seated-nostool-front-right.png",
  },
  watty: { "front-left": "/sprites/agents/watty-seated-nostool-front-left.png" },
};

// The generated PNG canvases have different transparent padding. Normalize
// their actual visible heights so every occupied chair reads as the same size.
const SEATED_SPRITE_SCALE: Partial<Record<string, number>> = {
  bluey: 1,
  kip: 0.981,
  watty: 1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Map screen-space travel to the matching visible pose. "Front" means the
// penguin is travelling down/toward the viewer, while "rear" means up/away.
// The left/right suffix follows the direction the beak and feet point.
function getDirectionFromDelta(dx: number, dy: number): SpriteDirection {
  if (dy < 0 && dx >= 0) return "rear-right";
  if (dy < 0 && dx < 0) return "rear-left";
  if (dy >= 0 && dx >= 0) return "front-right";
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
  workingSrc?: string;
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
type ServerRepairPhase =
  | "alert"
  | "approaching"
  | "diagnosing"
  | "repairing"
  | "rebooting"
  | "verified";
type LunaRoutine =
  | { kind: "planning-board" }
  | { kind: "research-workstation" }
  | { kind: "wander"; position: OfficeStation };
type AutonomousRoutine =
  | "entrance"
  | "library"
  | "desk"
  | "collaboration"
  | "collaboration-seat"
  | "cafe"
  | "planning-board"
  | "nap-pod";

// These anchors correspond to places in the room art. Agent state remains
// the source of truth; this is only the visual routine chosen for that state.
const OFFICE_STATIONS: Record<string, OfficeStation> = {
  library: { x: 17, y: 61 },
  top_middle: { x: 52, y: 53 },
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
    src: "/sprites/props/developer-desk-chair.png",
    // This is a complete transparent scene, including Kip in the chair.
    // Swap it in only after he has walked to the desk; it preserves the
    // correct depth ordering without fragile multi-layer compositing.
    workingSrc: "/sprites/props/developer-desk-kip.png",
    defaultPosition: { x: 15.21249836904824, y: 75.01831851202584 },
    width: 18.5,
  },
  {
    id: "research-workstation",
    name: "Research workstation",
    src: "/sprites/props/research-workstation.png",
    workingSrc: "/sprites/props/research-workstation-luna.png",
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
  tech_scout: "top_middle",
  portfolio: "desk",
  job_hunter: "entrance",
  leetcode_coach: "collaboration",
};

// Cosmetic routines keep the office alive between real backend tasks. Each
// role gets a different loop, offset by its position in the roster, so the
// flock disperses naturally instead of marching in sync. A live task state
// always overrides this selection below.
const AUTONOMOUS_ROUTINES_BY_ROLE: Record<string, readonly AutonomousRoutine[]> = {
  job_hunter: ["entrance", "collaboration-seat", "cafe"],
  leetcode_coach: ["desk", "collaboration", "cafe"],
  // Ziggy recharges between assignments, then wakes immediately for real work.
  portfolio: ["nap-pod"],
};

function isLiveWorkState(state: AgentState): boolean {
  return !["idle", "waiting", "sleeping", "walking"].includes(state);
}

function autonomousRoutineForAgent(
  agent: Agent,
  agentIndex: number,
  autonomyBeat: number
): AutonomousRoutine | null {
  const cycle = AUTONOMOUS_ROUTINES_BY_ROLE[agent.role];
  return cycle ? cycle[(autonomyBeat + agentIndex) % cycle.length]! : null;
}

// These are floor positions, deliberately clear of the workstation art. A
// role should never use a furniture centre as a walk target: that makes the
// sprite appear to stand on a monitor rather than beside the workstation.
function jobHunterTaskPosition(state: AgentState): OfficeStation {
  if (state === "searching" || state === "researching") return { x: 48, y: 74 };
  if (state === "evaluating" || state === "thinking" || state === "planning") {
    return { x: 47, y: 81 };
  }
  return { ...OFFICE_STATIONS[STATE_STATION[state]]! };
}

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

const SERVER_REPAIR_SPEECH: Record<ServerRepairPhase, string> = {
  alert: "Uh-oh. Rack three is blinking red!",
  approaching: "On my way—save the build queue!",
  diagnosing: "Scanning logs… temperature is nominal.",
  repairing: "Reseating cables and replacing a frosty fuse…",
  rebooting: "Three, two, one… reboot!",
  verified: "All green. Builds are flying again!",
};

const OFFICE_EVENTS = [
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
// take standing discussion slots along the far side of the table. They are
// occluded by the tabletop so the meeting retains correct scene depth.
//
// Every point is local to the prop's bottom-centre origin and scales with its
// width, so moving/resizing the furniture cannot break the meeting formation.
const TABLE_MEETING_SLOTS: readonly TableMeetingSlot[] = [
  // Stool-free sprite canvases retain a small transparent lower margin. These
  // anchors place the visible feet on the stool cushions (not on the table).
  { x: -0.264, y: -0.26, direction: "front-right", pose: "seated", depth: "front" },
  { x: 0, y: -0.19, direction: "front-left", pose: "seated", depth: "front" },
  { x: 0.353, y: -0.26, direction: "front-left", pose: "seated", depth: "front" },
  // Sprite filenames describe the camera angle, not the beak direction:
  // front-left faces visually right and front-right faces visually left.
  { x: -0.19, y: -0.59, direction: "front-left", pose: "standing", depth: "rear" },
  { x: 0.19, y: -0.59, direction: "front-right", pose: "standing", depth: "rear" },
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

// The sleeping illustration is wide (1431x970), unlike the upright square
// poses. Anchor its bottom edge on the mattress and use a dedicated scale.
const NAP_POD_SLEEP_ANCHOR = { x: -0.01, y: -0.34 } as const;
const NAP_POD_SLEEP_SCALE = 0.63525;
const NAP_POD_SLEEP_HORIZONTAL_SCALE = 1.3552;
// Ziggy's generated sleeping canvas is much wider and has more transparent
// headroom than Watty's. Normalize the visible silhouette for the same pod.
const PORTFOLIO_SLEEP_SCALE = 0.5248;
const PORTFOLIO_SLEEP_HORIZONTAL_SCALE = 0.936;
const COFFEE_MAKER_ANCHOR = { x: 0.06, y: 0.03 } as const;

/**
 * The nap pod is a tall foreground prop. A character whose feet cross its
 * body should be drawn behind it, just as they would be in an isometric game.
 * The bounds are expressed in the same percentage coordinates as the prop,
 * so dragging or resizing the pod keeps its occlusion region aligned.
 */
function isBehindNapPod(position: OfficeStation, pod: PlacedOfficeProp): boolean {
  const podHeight = pod.width * PROP_WIDTH_TO_ROOM_Y;
  return (
    position.x >= pod.x - pod.width * 0.46 &&
    position.x <= pod.x + pod.width * 0.32 &&
    position.y >= pod.y - podHeight * 0.83 &&
    position.y <= pod.y - podHeight * 0.1
  );
}

function napPodOcclusionZIndex(pod: PlacedOfficeProp): number {
  // Props use `y * 100 - 1`; stay one layer beneath that furniture plane.
  return Math.round(pod.y * 100) - 2;
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
  const researchAgentSeatedRef = useRef(false);
  const developerAgentSeatedRef = useRef(false);
  const lunaAtPlanningBoardRef = useRef(false);
  const autonomousSeatedAgentIdsRef = useRef<Set<string>>(new Set());
  const portfolioSleepingRef = useRef(false);

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
  const [flockWalkingToSeats, setFlockWalkingToSeats] = useState(false);
  const [playerSleeping, setPlayerSleeping] = useState(false);
  const [coffeePhase, setCoffeePhase] = useState<CoffeePhase | null>(null);
  const [serverRepairPhase, setServerRepairPhase] = useState<ServerRepairPhase | null>(null);
  const [researchAgentSeated, setResearchAgentSeated] = useState(false);
  const [developerAgentSeated, setDeveloperAgentSeated] = useState(false);
  const [autonomousSeatedAgentIds, setAutonomousSeatedAgentIds] = useState<Set<string>>(
    () => new Set()
  );
  const [portfolioSleeping, setPortfolioSleeping] = useState(false);
  const [lunaRoutine, setLunaRoutine] = useState<LunaRoutine>({ kind: "planning-board" });
  const [autonomyBeat, setAutonomyBeat] = useState(0);
  const [lunaAtPlanningBoard, setLunaAtPlanningBoard] = useState(false);
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
  const developerDesk = propLayouts["desk"];
  const researchWorkstation = propLayouts["research-workstation"];
  const planningBoard = propLayouts["planning-board"];
  const napPod = propLayouts["nap-pod"];
  const coffeeNook = propLayouts["coffee-nook"];
  const serverRack = propLayouts["build-server-rack"];
  const flockAtTable = flockSeated && !flockWalkingToSeats;
  const researchSeatPosition = useMemo(() => {
    const workstation = researchWorkstation ?? { x: 29, y: 65, width: 21.5 };
    return {
      // The chair and Luna are slightly left of the square prop's centre.
      x: workstation.x - workstation.width * 0.1,
      // Props are bottom-anchored; convert the chair's local vertical offset
      // from prop-width units into the room's non-square coordinate system.
      y: workstation.y - workstation.width * 0.11 * PROP_WIDTH_TO_ROOM_Y,
    };
  }, [researchWorkstation]);
  const developerSeatPosition = useMemo(() => {
    const desk = developerDesk ?? { x: 15.2, y: 75, width: 18.5 };
    return {
      x: desk.x + desk.width * 0.13,
      y: desk.y - desk.width * 0.08 * PROP_WIDTH_TO_ROOM_Y,
    };
  }, [developerDesk]);
  const planningBoardPosition = useMemo(() => {
    const board = planningBoard ?? { x: 39, y: 52, width: 18.5 };
    return {
      x: board.x + board.width * 0.04,
      y: board.y + board.width * 0.18,
    };
  }, [planningBoard]);
  const serverRepairPosition = useMemo(() => {
    const rack = serverRack ?? { x: 85.1, y: 85.5, width: 30 };
    // The rack artwork is shifted into the right corner at render time.
    // This point lands Bluey at its front-left service panel.
    return {
      x: rack.x + rack.width * 0.015,
      y: rack.y - rack.width * 0.035 * PROP_WIDTH_TO_ROOM_Y,
    };
  }, [serverRack]);

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

  const portfolioSleepingPosition = (): OfficeStation => {
    const pod = napPod ?? { x: 33.1, y: 91.2, width: 19 };
    const position = sleepingPosition();
    return { x: position.x + pod.width * 0.04, y: position.y };
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
    if (
      serverRepairPhase !== "alert" &&
      serverRepairPhase !== "diagnosing" &&
      serverRepairPhase !== "repairing" &&
      serverRepairPhase !== "rebooting" &&
      serverRepairPhase !== "verified"
    ) return;
    const delays: Record<Exclude<ServerRepairPhase, "approaching">, number> = {
      alert: 2_800,
      diagnosing: 4_500,
      repairing: 7_500,
      rebooting: 5_500,
      verified: 3_500,
    };
    const timer = window.setTimeout(() => {
      setServerRepairPhase((phase) => {
        if (phase === "alert") return "approaching";
        if (phase === "diagnosing") return "repairing";
        if (phase === "repairing") return "rebooting";
        if (phase === "rebooting") return "verified";
        return null;
      });
    }, delays[serverRepairPhase]);
    return () => window.clearTimeout(timer);
  }, [serverRepairPhase]);

  // Bluey runs a preventative maintenance pass while otherwise idle. The
  // first fault appears soon enough to discover; later checks are sparse so
  // the routine remains a delightful office event instead of constant noise.
  useEffect(() => {
    const hunter = agentList.find((agent) => agent.role === "job_hunter");
    if (!hunter || isLiveWorkState(hunter.state)) return;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      timer = window.setTimeout(() => {
        setServerRepairPhase((phase) => phase ?? "alert");
        schedule(90_000 + Math.random() * 45_000);
      }, delay);
    };
    schedule(18_000);
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [agentList]);

  useEffect(() => {
    setClock(new Date());
    const interval = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // Advance the non-Luna specialists through their role-specific routines.
  // The random cadence prevents a mechanical, synchronized office loop.
  useEffect(() => {
    const scheduleNextBeat = () =>
      window.setTimeout(() => {
        setAutonomyBeat((beat) => beat + 1);
        timer = scheduleNextBeat();
      }, AUTONOMY_STEP_MIN_MS + Math.random() * AUTONOMY_STEP_JITTER_MS);
    let timer = scheduleNextBeat();
    return () => window.clearTimeout(timer);
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

  // Luna alternates between planning, researching, and exploring the floor.
  // Real research work and shared office events override this cosmetic loop.
  useEffect(() => {
    let timer: number | undefined;
    const scheduleNextStop = () => {
      timer = window.setTimeout(() => {
        setLunaRoutine((current) => {
          const choices = (["planning-board", "research-workstation", "wander"] as const).filter(
            (kind) => kind !== current.kind
          );
          const kind = choices[Math.floor(Math.random() * choices.length)]!;
          if (kind === "wander") {
            return {
              kind,
              position: { x: 18 + Math.random() * 64, y: 55 + Math.random() * 31 },
            };
          }
          return { kind };
        });
        scheduleNextStop();
      }, AUTONOMY_STEP_MIN_MS + Math.random() * AUTONOMY_STEP_JITTER_MS);
    };
    scheduleNextStop();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, []);

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
          : flockAtTable
            ? "meeting"
            : flockWalkingToSeats
              ? "walking"
            : walkingToCoffee
              ? "walking"
              : coffeePhase
                ? "waiting"
                : playerMoving
                  ? "walking"
                  : "idle"
      );

      if (flockWalkingToSeats) {
        const target = tableMeetingPosition(WATTY_TABLE_SLOT_INDEX);
        const cdx = target.x - playerPos.current.x;
        const cdy = target.y - playerPos.current.y;
        const distance = Math.sqrt(cdx * cdx + cdy * cdy);
        if (distance < 0.45) {
          playerPos.current = target;
          playerDirection.current = tableMeetingSlot(WATTY_TABLE_SLOT_INDEX).direction;
        } else {
          playerPos.current.x += (cdx / distance) * PLAYER_SPEED * delta;
          playerPos.current.y += (cdy / distance) * PLAYER_SPEED * delta;
          playerDirection.current = getDirectionFromDelta(cdx, cdy);
        }
      } else if (walkingToCoffee) {
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
        : flockAtTable
          ? tableMeetingPosition(WATTY_TABLE_SLOT_INDEX)
          : playerPos.current;
      playerRef.current?.setPosition(playerDisplayPosition.x, playerDisplayPosition.y);
      if (playerSleeping) {
        const pod = napPod ?? { x: 33.1, y: 91.2, width: 19 };
        playerRef.current?.setZIndex(Math.round(pod.y * 100));
      } else if (flockAtTable) {
        playerRef.current?.setZIndex(tableMeetingZIndex(WATTY_TABLE_SLOT_INDEX));
      } else if (napPod && isBehindNapPod(playerDisplayPosition, napPod)) {
        playerRef.current?.setZIndex(napPodOcclusionZIndex(napPod));
      }
      playerRef.current?.setScale(
        roomScaleRef.current *
          CHARACTER_SCALE_MULTIPLIER *
          (playerSleeping ? NAP_POD_SLEEP_SCALE : 1)
      );
      playerRef.current?.setBob(playerSleeping ? 0 : Math.sin(playerBobPhase.current) * 1.5);
      playerRef.current?.setFacing(
        playerSleeping
          ? false
          : flockAtTable
            ? tableMeetingSlot(WATTY_TABLE_SLOT_INDEX).direction
            : coffeePhase && coffeePhase !== "approaching"
              ? "rear-left"
              : playerDirection.current
      );
      let meetingArrivalComplete =
        !flockWalkingToSeats ||
        Math.hypot(
          playerPos.current.x - tableMeetingPosition(WATTY_TABLE_SLOT_INDEX).x,
          playerPos.current.y - tableMeetingPosition(WATTY_TABLE_SLOT_INDEX).y
        ) < 0.45;

      // --- Agents: state-driven office routines ---
      const liveIds = new Set(agentList.map((a) => a.id));
      for (const id of npcRuntimeRef.current.keys()) {
        if (!liveIds.has(id)) npcRuntimeRef.current.delete(id);
      }

      let activeResearcherSeen = false;
      let activeDeveloperSeen = false;
      let planningLunaSeen = false;
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

        const serverRepairActive =
          !flockSeated &&
          agent.role === "job_hunter" &&
          serverRepairPhase !== null;
        const stateDrivenRoutine =
          !flockSeated &&
          !serverRepairActive &&
          agent.role !== "tech_scout" &&
          isLiveWorkState(agent.state);
        const autonomousRoutine =
          !flockSeated &&
          !serverRepairActive &&
          !stateDrivenRoutine &&
          agent.role !== "tech_scout" &&
          autonomousRoutineForAgent(agent, agentIndex, autonomyBeat);
        const autonomousTableSeat = autonomousRoutine === "collaboration-seat";
        const developerRoutineActive =
          agent.role === "leetcode_coach" &&
          (autonomousRoutine === "desk" ||
            (stateDrivenRoutine &&
              ["thinking", "coding", "debugging", "evaluating"].includes(agent.state)));
        const assignedResearchActive =
          !flockSeated &&
          agent.role === "tech_scout" &&
          (agent.state === "researching" || agent.state === "searching");
        const autonomousLunaActive =
          !flockSeated &&
          !assignedResearchActive &&
          agent.role === "tech_scout";
        const researchRoutineActive =
          assignedResearchActive ||
          (autonomousLunaActive && lunaRoutine.kind === "research-workstation");
        const planningRoutineActive =
          autonomousLunaActive && lunaRoutine.kind === "planning-board";
        const wanderingLunaActive = autonomousLunaActive && lunaRoutine.kind === "wander";
        if (researchRoutineActive) activeResearcherSeen = true;
        if (developerRoutineActive) activeDeveloperSeen = true;
        if (planningRoutineActive) planningLunaSeen = true;
        const routineKey = flockSeated
          ? `seated:${agentIndex}`
          : serverRepairActive
              ? serverRepairPhase === "alert"
                ? `server-alert:${agent.role}`
                : `server-repair:${serverRepairPosition.x}:${serverRepairPosition.y}`
            : stateDrivenRoutine
              ? developerRoutineActive
                ? `developer:${agent.state}:${developerSeatPosition.x}:${developerSeatPosition.y}`
                : `live:${agent.state}`
              : autonomousRoutine
                ? developerRoutineActive
                  ? `developer:autonomous:${developerSeatPosition.x}:${developerSeatPosition.y}`
                  : `autonomous:${autonomousRoutine}`
            : researchRoutineActive
              ? `research:${researchSeatPosition.x}:${researchSeatPosition.y}`
              : planningRoutineActive
                ? `planning-board:${planningBoardPosition.x}:${planningBoardPosition.y}`
                : wanderingLunaActive
                  ? `luna-wander:${lunaRoutine.position.x}:${lunaRoutine.position.y}`
                : `home:${agent.role}`;
        if (runtime.routineKey !== routineKey) {
          runtime.routineKey = routineKey;
          runtime.target = flockSeated
            ? tableMeetingPosition(tableSlotIndex)
          : serverRepairActive
                ? serverRepairPhase === "alert"
                  ? { ...runtime.pos }
                  : { ...serverRepairPosition }
              : stateDrivenRoutine
                ? developerRoutineActive
                  ? { ...developerSeatPosition }
                  : agent.role === "job_hunter"
                    ? jobHunterTaskPosition(agent.state)
                    : { ...OFFICE_STATIONS[STATE_STATION[agent.state]]! }
              : autonomousRoutine
                  ? developerRoutineActive
                    ? { ...developerSeatPosition }
                    : autonomousRoutine === "collaboration-seat"
                    ? { ...tableMeetingPosition(tableSlotIndex) }
                    : autonomousRoutine === "planning-board"
                    ? { ...planningBoardPosition }
                    : autonomousRoutine === "nap-pod"
                    ? { ...portfolioSleepingPosition() }
                    : { ...OFFICE_STATIONS[autonomousRoutine]! }
              : researchRoutineActive
                ? { ...researchSeatPosition }
                : planningRoutineActive
                  ? { ...planningBoardPosition }
                  : wanderingLunaActive
                    ? { ...lunaRoutine.position }
                  : stationForAgent(agent);
        }

        const tdx = runtime.target.x - runtime.pos.x;
        const tdy = runtime.target.y - runtime.pos.y;
        const distance = Math.sqrt(tdx * tdx + tdy * tdy);
        const agentSeatedAtTable =
          (flockAtTable && tableMeetingSlot(tableSlotIndex).pose === "seated") ||
          (autonomousTableSeat && distance < 0.5);
        const wasAutonomouslySeated = autonomousSeatedAgentIdsRef.current.has(agent.id);
        const isAutonomouslySeated = autonomousTableSeat && distance < 0.5;
        if (wasAutonomouslySeated !== isAutonomouslySeated) {
          if (isAutonomouslySeated) autonomousSeatedAgentIdsRef.current.add(agent.id);
          else autonomousSeatedAgentIdsRef.current.delete(agent.id);
          setAutonomousSeatedAgentIds(new Set(autonomousSeatedAgentIdsRef.current));
        }
        const portfolioNapActive =
          agent.role === "portfolio" && autonomousRoutine === "nap-pod" && distance < 0.5;
        if (portfolioSleepingRef.current !== portfolioNapActive) {
          portfolioSleepingRef.current = portfolioNapActive;
          setPortfolioSleeping(portfolioNapActive);
        }
        if (flockAtTable) runtime.pos = { ...runtime.target };

        if (distance >= 0.5) {
          const speed = flockWalkingToSeats ? MEETING_WALK_SPEED : NPC_SPEED;
          runtime.pos.x += (tdx / distance) * speed * delta;
          runtime.pos.y += (tdy / distance) * speed * delta;
          runtime.direction = getDirectionFromDelta(tdx, tdy);
        }
        if (serverRepairActive && serverRepairPhase === "approaching" && distance < 0.5) {
          setServerRepairPhase("diagnosing");
        }
        if (flockWalkingToSeats && Math.hypot(runtime.target.x - runtime.pos.x, runtime.target.y - runtime.pos.y) >= 0.5) {
          meetingArrivalComplete = false;
        }

        if (researchRoutineActive) {
          const arrived = distance < 0.5;
          if (researchAgentSeatedRef.current !== arrived) {
            researchAgentSeatedRef.current = arrived;
            setResearchAgentSeated(arrived);
          }
        }

        if (developerRoutineActive) {
          const arrived = distance < 0.5;
          if (developerAgentSeatedRef.current !== arrived) {
            developerAgentSeatedRef.current = arrived;
            setDeveloperAgentSeated(arrived);
          }
        }

        if (planningRoutineActive) {
          const arrived = distance < 0.5;
          if (lunaAtPlanningBoardRef.current !== arrived) {
            lunaAtPlanningBoardRef.current = arrived;
            setLunaAtPlanningBoard(arrived);
          }
        }

        runtime.bobPhase += delta * 0.08;

        const handle = npcHandlesRef.current.get(agent.id);
        handle?.setPosition(runtime.pos.x, runtime.pos.y);
        if (agentSeatedAtTable) handle?.setZIndex(tableMeetingZIndex(tableSlotIndex));
        else if (portfolioNapActive) {
          const pod = napPod ?? { x: 33.1, y: 91.2, width: 19 };
          handle?.setZIndex(Math.round(pod.y * 100));
        } else if (napPod && isBehindNapPod(runtime.pos, napPod)) {
          handle?.setZIndex(napPodOcclusionZIndex(napPod));
        }
        handle?.setScale(
          roomScaleRef.current *
            CHARACTER_SCALE_MULTIPLIER *
            (portfolioNapActive ? PORTFOLIO_SLEEP_SCALE : 1)
        );
        handle?.setBob(
          agentSeatedAtTable ||
            portfolioNapActive ||
            (planningRoutineActive && distance < 0.5) ||
            (serverRepairActive && serverRepairPhase !== "alert" && distance < 0.5)
            ? 0
            : Math.sin(runtime.bobPhase) * 1.5
        );
        handle?.setFacing(
          portfolioNapActive
            ? false
          : agentSeatedAtTable
            ? tableMeetingSlot(tableSlotIndex).direction
            : serverRepairActive && serverRepairPhase !== "alert" && distance < 0.5
              ? "front-right"
            : planningRoutineActive && distance < 0.5
              ? "rear-right"
              : runtime.direction
        );
        // Ring color reflects the agent's real backend state (idle,
        // coding, blocked, ...) rather than the cosmetic wander AI above.
        handle?.setState(
          agentSeatedAtTable
            ? "meeting"
            : portfolioNapActive
              ? "sleeping"
            : distance >= 0.5
              ? "walking"
              : serverRepairActive
                ? serverRepairPhase === "alert"
                  ? "error"
                  : serverRepairPhase === "diagnosing"
                    ? "evaluating"
                    : serverRepairPhase === "repairing"
                      ? "debugging"
                      : serverRepairPhase === "rebooting"
                        ? "waiting"
                        : "idle"
              : autonomousRoutine === "planning-board"
                ? "planning"
              : planningRoutineActive
                ? "planning"
                : agent.state
        );
      }

      if (flockWalkingToSeats && meetingArrivalComplete) setFlockWalkingToSeats(false);

      if (!activeResearcherSeen && researchAgentSeatedRef.current) {
        researchAgentSeatedRef.current = false;
        setResearchAgentSeated(false);
      }
      if (!activeDeveloperSeen && developerAgentSeatedRef.current) {
        developerAgentSeatedRef.current = false;
        setDeveloperAgentSeated(false);
      }
      if (!planningLunaSeen && lunaAtPlanningBoardRef.current) {
        lunaAtPlanningBoardRef.current = false;
        setLunaAtPlanningBoard(false);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [agentList, officeEvent, flockSeated, flockWalkingToSeats, flockAtTable, playerSleeping, coffeePhase, serverRepairPhase, lunaRoutine, autonomyBeat, collaborationTable, developerSeatPosition, researchSeatPosition, planningBoardPosition, serverRepairPosition, napPod, coffeeNook]);

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
        backgroundImage: "url(/sprites/office-background.png)",
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
        showStatus={!playerSleeping && !flockAtTable}
        horizontalScale={playerSleeping ? NAP_POD_SLEEP_HORIZONTAL_SCALE : 1}
        scaleMultiplier={flockAtTable ? SEATED_SPRITE_SCALE.watty : 1}
        activity={
          coffeePhase === "grinding"
            ? "coffee-grinding"
            : coffeePhase === "pouring"
              ? "coffee-pouring"
              : coffeePhase === "sipping"
                ? "coffee-sipping"
                : undefined
        }
        sprite={
          playerSleeping
            ? { type: "static", url: "/sprites/agents/watty-sleeping.png" }
            : {
                type: "directional",
                base: "watty",
                pose: flockAtTable && tableMeetingSlot(WATTY_TABLE_SLOT_INDEX).pose === "seated"
                  ? "seated"
                  : "standing",
                seatedSpriteUrls: SEATED_NO_STOOL_SPRITES.watty,
                initialDirection: "front-left",
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
            <img
              src={
                ((prop.id === "research-workstation" && researchAgentSeated) ||
                  (prop.id === "desk" && developerAgentSeated)) &&
                prop.workingSrc
                  ? prop.workingSrc
                  : prop.src
              }
              alt=""
              draggable={false}
              className={`block h-auto w-full ${
                prop.id === "desk" && developerAgentSeated
                  ? "office-developer-working"
                  : ""
              }`}
            />
          </button>
        );
      })}

      {selectedPropId && (() => {
        const prop = OFFICE_PROPS.find((candidate) => candidate.id === selectedPropId);
        const layout = prop ? propLayouts[prop.id] : undefined;
        if (!prop || !layout) return null;
        return (
          <div
            className="absolute z-[30050] flex items-center gap-1 rounded-md border border-sky-200/50 bg-slate-950/90 p-1 shadow-lg"
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
                  const nextSeated = !flockSeated;
                  setFlockSeated(nextSeated);
                  setFlockWalkingToSeats(nextSeated);
                  // The edit toolbar sits over the front chair at this table
                  // location. A meeting should read as a clean scene, not as
                  // furniture-edit mode, so close it once the flock arrives.
                  // Re-select the table at any time to stand the flock up.
                  if (nextSeated) setSelectedPropId(null);
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
                  setFlockWalkingToSeats(false);
                  setCoffeePhase(null);
                  const nextSleeping = !playerSleeping;
                  setPlayerSleeping(nextSleeping);
                  if (nextSleeping) setSelectedPropId(null);
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
                  setFlockWalkingToSeats(false);
                  setPlayerSleeping(false);
                  const nextPhase = coffeePhase ? null : "approaching";
                  setCoffeePhase(nextPhase);
                  if (nextPhase) setSelectedPropId(null);
                }}
                className="ml-1 rounded bg-amber-500/25 px-2 py-0.5 text-[10px] font-semibold text-amber-100 hover:bg-amber-400/35"
              >
                {coffeePhase ? "Cancel coffee" : "Make coffee"}
              </button>
            )}
            {prop.id === "build-server-rack" && (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setServerRepairPhase((phase) => (phase ? null : "alert"));
                  setSelectedPropId(null);
                }}
                className="ml-1 rounded bg-cyan-500/25 px-2 py-0.5 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-400/35"
              >
                {serverRepairPhase ? "Cancel repair" : "Call Job Hunter"}
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
          <span className="office-coffee-stream" />
          <span className="office-coffee-steam">〰</span>
          <span className="office-coffee-spark">✦</span>
          <span className="office-coffee-bean office-coffee-bean--one">●</span>
          <span className="office-coffee-bean office-coffee-bean--two">●</span>
        </div>
      )}

      {lunaAtPlanningBoard && planningBoard && (
        <div
          aria-hidden="true"
          className="office-planning-sparks pointer-events-none absolute"
          style={{
            left: `${planningBoard.x + planningBoard.width * 0.2}%`,
            top: `${planningBoard.y - planningBoard.width * 0.62 * PROP_WIDTH_TO_ROOM_Y}%`,
            zIndex: Math.round(planningBoard.y * 100) + 20_010,
          }}
        >
          <span>✦</span>
          <span>✎</span>
          <span>✦</span>
        </div>
      )}

      {serverRepairPhase && serverRepairPhase !== "alert" && serverRepairPhase !== "approaching" && serverRack && (
        <div
          aria-label={`Server repair: ${serverRepairPhase}`}
          className={`office-server-repair office-server-repair--${serverRepairPhase} pointer-events-none absolute`}
          style={{
            left: `${serverRack.x + serverRack.width * 0.22}%`,
            top: `${serverRack.y - serverRack.width * 0.47 * PROP_WIDTH_TO_ROOM_Y}%`,
            zIndex: Math.round(serverRack.y * 100) + 20_020,
          }}
        >
          <span className="office-server-scan" />
          <span className="office-server-tool">🔧</span>
          <span className="office-server-spark office-server-spark--one">✦</span>
          <span className="office-server-spark office-server-spark--two">✦</span>
          <span className="office-server-status">
            {serverRepairPhase === "diagnosing"
              ? "DIAGNOSTIC  ▰▰▱"
              : serverRepairPhase === "repairing"
                ? "PATCHING  ▰▰▰▱"
                : serverRepairPhase === "rebooting"
                  ? "REBOOTING…"
                  : "ALL SYSTEMS GREEN"}
          </span>
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

      {agentList.map((agent, i) => {
        if (researchAgentSeated && agent.role === "tech_scout") return null;
        if (developerAgentSeated && agent.role === "leetcode_coach") return null;
        const liveSpeech = agentSpeech[agent.id];
        const tableSlotIndex = AGENT_TABLE_SLOT_INDICES[i % AGENT_TABLE_SLOT_INDICES.length]!;
        const autonomousTableSeat = autonomousSeatedAgentIds.has(agent.id);
        const speech =
          portfolioSleeping && agent.role === "portfolio"
            ? "Zzz… portfolio compiling…"
          : agent.role === "job_hunter" && serverRepairPhase
            ? SERVER_REPAIR_SPEECH[serverRepairPhase]
            : liveSpeech && liveSpeech.expiresAt > (clock?.getTime() ?? 0)
            ? liveSpeech.text
            : STATE_SPEECH[agent.state];
        return (
        <AgentCharacter
          key={agent.id}
          agent={agent}
          spriteBase={AGENT_SPRITE_BY_ROLE[agent.role] ?? AGENT_SPRITE_BASES[i % AGENT_SPRITE_BASES.length]!}
          seated={
            (flockAtTable && tableMeetingSlot(tableSlotIndex).pose === "seated") ||
            autonomousTableSeat
          }
          seatedDirection={tableMeetingSlot(tableSlotIndex).direction}
          seatedScale={SEATED_SPRITE_SCALE[AGENT_SPRITE_BY_ROLE[agent.role] ?? AGENT_SPRITE_BASES[i % AGENT_SPRITE_BASES.length]!] ?? 1}
          inMeeting={flockAtTable || autonomousTableSeat}
          sleeping={portfolioSleeping && agent.role === "portfolio"}
          sleepingHorizontalScale={PORTFOLIO_SLEEP_HORIZONTAL_SCALE}
          activity={
            agent.role === "job_hunter" && serverRepairPhase && serverRepairPhase !== "approaching"
              ? serverRepairPhase === "alert"
                ? "server-alert"
                : serverRepairPhase === "diagnosing"
                  ? "server-diagnose"
                  : serverRepairPhase === "repairing"
                    ? "server-repair"
                    : serverRepairPhase === "rebooting"
                      ? "server-reboot"
                      : "server-celebrate"
              : lunaAtPlanningBoard && agent.role === "tech_scout"
                ? "planning-board"
                : undefined
          }
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
  seatedDirection,
  seatedScale,
  inMeeting,
  sleeping,
  sleepingHorizontalScale,
  activity,
  speech,
  onHandle,
}: {
  agent: Agent;
  spriteBase: string;
  seated: boolean;
  seatedDirection: SpriteDirection;
  seatedScale: number;
  inMeeting: boolean;
  sleeping: boolean;
  sleepingHorizontalScale: number;
  activity?:
    | "planning-board"
    | "server-alert"
    | "server-diagnose"
    | "server-repair"
    | "server-reboot"
    | "server-celebrate";
  speech?: string;
  onHandle: (handle: CharacterHandle | null) => void;
}) {
  return (
    <Character
      ref={onHandle}
      name={agent.name}
      sprite={
        sleeping
          ? { type: "static", url: "/sprites/agents/ziggy-sleeping.png" }
          : {
              type: "directional",
              base: spriteBase,
              pose: seated ? "seated" : "standing",
              seatedSpriteUrls: SEATED_NO_STOOL_SPRITES[spriteBase],
              initialDirection: seated ? seatedDirection : "front-left",
            }
      }
      speech={speech}
      showStatus={!inMeeting && !sleeping}
      horizontalScale={sleeping ? sleepingHorizontalScale : 1}
      scaleMultiplier={seated ? seatedScale : 1}
      activity={activity}
    />
  );
}
