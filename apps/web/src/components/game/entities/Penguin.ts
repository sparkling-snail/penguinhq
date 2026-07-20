import * as PIXI from "pixi.js-legacy";
import type { AgentState } from "@/types/agent";

const PENGUIN_TEXTURE_URL = "/sprites/penguin-blue.webp";
// Source art is 635x678; only the height is needed since a uniform scale
// derives the on-screen width from the texture's own aspect ratio once it
// loads (see the comment in world/room.ts for why the background image
// can't take this same shortcut).
const PENGUIN_NATURAL_HEIGHT = 678;
const PENGUIN_DISPLAY_HEIGHT = 74;
// How far below the container's origin the feet sit — matches the old
// shadow position so the sprite plants itself on the same spot the
// procedurally-drawn body used to.
const PENGUIN_FEET_Y = 30;

/** Bounds an entity is allowed to move within. `minY` keeps penguins out
 * of the room art's building/fountain band and confined to open ground. */
export interface WorldBounds {
  width: number;
  height: number;
  minY?: number;
}

const STATE_RING_COLOR: Record<AgentState, number> = {
  idle: 0x64748b,
  walking: 0x38bdf8,
  planning: 0xa78bfa,
  thinking: 0xa78bfa,
  coding: 0x22c55e,
  researching: 0xeab308,
  meeting: 0xf472b6,
  blocked: 0xef4444,
  waiting: 0xf59e0b,
  sleeping: 0x475569,
  debugging: 0xf97316,
  error: 0xdc2626,
};

export interface PenguinOptions {
  name: string;
  // Only one color of sprite exists today, so this doesn't affect the art
  // yet — kept so callers can still assign per-agent identity ahead of
  // more color variants landing (see stateRing for the current per-agent
  // visual signal).
  bodyColor?: number;
  scale?: number;
}

export class Penguin extends PIXI.Container {
  protected body: PIXI.Sprite;
  protected stateRing: PIXI.Graphics;
  protected nameLabel: PIXI.Text;
  protected shadow: PIXI.Graphics;

  private bobPhase = Math.random() * Math.PI * 2;
  private _state: AgentState = "idle";

  constructor(options: PenguinOptions) {
    super();

    this.shadow = new PIXI.Graphics();
    this.shadow.beginFill(0x000000, 0.35);
    this.shadow.drawEllipse(0, 30, 16, 5);
    this.shadow.endFill();
    this.addChild(this.shadow);

    this.stateRing = new PIXI.Graphics();
    this.addChild(this.stateRing);

    this.body = new PIXI.Sprite(PIXI.Texture.from(PENGUIN_TEXTURE_URL));
    // Anchor at the feet (bottom-center) and sit them on the shadow, so
    // `this.y` means "where the penguin is standing" the same way it did
    // for the old procedurally-drawn body.
    this.body.anchor.set(0.5, 1);
    this.body.y = PENGUIN_FEET_Y;
    this.body.scale.set(PENGUIN_DISPLAY_HEIGHT / PENGUIN_NATURAL_HEIGHT);
    this.addChild(this.body);

    this.nameLabel = new PIXI.Text(options.name, {
      fontFamily: "Inter, sans-serif",
      fontSize: 11,
      fill: 0xe2e8f0,
      stroke: 0x0b1120,
      strokeThickness: 3,
    });
    this.nameLabel.anchor.set(0.5);
    this.nameLabel.y = -52;
    this.addChild(this.nameLabel);

    if (options.scale) this.scale.set(options.scale);

    this.setState("idle");
  }

  setState(state: AgentState): void {
    this._state = state;
    this.stateRing.clear();
    this.stateRing.lineStyle(2, STATE_RING_COLOR[state], 0.9);
    this.stateRing.drawCircle(0, -7, 34);
  }

  get state(): AgentState {
    return this._state;
  }

  /** Called every tick by PixiApp's ticker. `delta` is in fractional frames. */
  update(delta: number): void {
    // Idle bob — a small vertical oscillation so the world never feels
    // static even when nothing else is animating.
    this.bobPhase += delta * 0.08;
    const bobOffset = this._state === "sleeping" ? 0 : Math.sin(this.bobPhase) * 1.5;
    this.body.y = PENGUIN_FEET_Y + bobOffset;
    this.stateRing.y = bobOffset;
  }
}
