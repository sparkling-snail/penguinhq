import * as PIXI from "pixi.js-legacy";
import { PlayerController } from "./entities/PlayerController";
import { NPCPenguin } from "./entities/NPCPenguin";
import { Pigeon, type PigeonData } from "./entities/Pigeon";
import type { WorldBounds } from "./entities/Penguin";
import { buildRoom, ROOM_WALKABLE_TOP_FRACTION, type Room } from "./world/room";

const PIGEON_FLIGHT_FRAMES = 240;

export interface PixiAppCallbacks {
  onPigeonHover?: (data: PigeonData | null) => void;
}

/**
 * Owns the PIXI.Application instance and every entity in the scene.
 *
 * This class is framework-agnostic on purpose — no React imports here.
 * `GameCanvas.tsx` is a thin adapter that creates one of these on mount
 * and tears it down on unmount, which keeps the notoriously fiddly
 * "React + imperative canvas library" lifecycle contained to one small
 * component instead of leaking Pixi concerns throughout the React tree.
 */
export class PixiApp {
  readonly app: PIXI.Application;
  private world: PIXI.Container;
  private room: Room;
  private player: PlayerController;
  private npcs: NPCPenguin[] = [];
  private pigeons: Map<string, Pigeon> = new Map();
  private callbacks: PixiAppCallbacks;
  private width: number;
  private height: number;

  constructor(parent: HTMLElement, width: number, height: number, callbacks: PixiAppCallbacks = {}) {
    this.width = width;
    this.height = height;
    this.callbacks = callbacks;

    this.app = new PIXI.Application({
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    parent.appendChild(this.app.view as HTMLCanvasElement);

    this.world = new PIXI.Container();
    this.app.stage.addChild(this.world);

    this.room = buildRoom(width, height);
    this.world.addChild(this.room.container);

    const spawnBounds = this.bounds(width, height);
    const spawnY = (spawnBounds.minY ?? 0) + (height - 24 - (spawnBounds.minY ?? 0)) * 0.4;

    this.player = new PlayerController({ name: "You", bodyColor: 0x0ea5e9 }, spawnBounds);
    this.player.x = width / 2;
    this.player.y = spawnY;
    this.world.addChild(this.player);

    const npc = new NPCPenguin({ name: "Job Hunter", bodyColor: 0xf97316 }, spawnBounds);
    npc.x = width / 2 - 120;
    npc.y = spawnY + 20;
    this.world.addChild(npc);
    this.npcs.push(npc);

    this.app.ticker.add(this.tick);
  }

  /** Penguins may only walk the open ground in the room art, not the band
   * of buildings/fountain/sky along the top. */
  private bounds(width: number, height: number): WorldBounds {
    return { width, height, minY: height * ROOM_WALKABLE_TOP_FRACTION };
  }

  private tick = (delta: number): void => {
    this.player.update(delta);
    for (const npc of this.npcs) npc.update(delta);

    for (const [taskId, pigeon] of this.pigeons) {
      const stillFlying = pigeon.update(delta, PIGEON_FLIGHT_FRAMES);
      if (!stillFlying) {
        this.world.removeChild(pigeon);
        pigeon.destroy();
        this.pigeons.delete(taskId);
      }
    }

    // Depth-sort so penguins lower on screen render in front — a cheap
    // way to fake depth in a top-down/isometric-flavored scene.
    this.world.children.sort((a, b) => (a as PIXI.Container).y - (b as PIXI.Container).y);
  };

  spawnPigeon(data: PigeonData): void {
    if (this.pigeons.has(data.taskId)) return;
    const flightY = 60 + Math.random() * (this.height - 160);
    const pigeon = new Pigeon(data, flightY, this.width);

    pigeon.on("pointerover", () => this.callbacks.onPigeonHover?.(data));
    pigeon.on("pointerout", () => this.callbacks.onPigeonHover?.(null));

    this.world.addChild(pigeon);
    this.pigeons.set(data.taskId, pigeon);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.app.renderer.resize(width, height);
    this.room.resize(width, height);
    const bounds = this.bounds(width, height);
    this.player.setBounds(bounds);
    for (const npc of this.npcs) npc.setBounds(bounds);
  }

  destroy(): void {
    this.app.ticker.remove(this.tick);
    this.app.destroy(true, { children: true });
  }
}
