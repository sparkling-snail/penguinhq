import * as PIXI from "pixi.js-legacy";
import type { PigeonStatus } from "@/types/events";

/**
 * A flying messenger pigeon carrying an envelope — the physical
 * visualization of one Kafka-style task-transfer event.
 *
 * Milestone 1 ships the animation primitive: a pigeon spawns off one edge
 * of the world, flies to the other side carrying a colored envelope, and
 * is interactive (hover shows a tooltip via a native `title`-style
 * approach is not available in Pixi, so callers wire pointer events to
 * open a React tooltip — see GameCanvas). Once the real task queue exists
 * (later milestone), source/destination become actual room coordinates
 * instead of "left edge to right edge."
 */

const STATUS_COLOR: Record<PigeonStatus, number> = {
  success: 0x22c55e,
  retry: 0xeab308,
  dead_letter: 0xef4444,
  high_priority: 0x38bdf8,
  ai_collab: 0xa855f7,
};

export interface PigeonData {
  taskId: string;
  sourceAgentId: string;
  destinationAgentId: string;
  priority: "low" | "normal" | "high";
  latencyMs: number;
  retries: number;
  queue: string;
  payloadSizeBytes: number;
  status: PigeonStatus;
}

export class Pigeon extends PIXI.Container {
  readonly data: PigeonData;

  private bird: PIXI.Graphics;
  private envelope: PIXI.Graphics;
  private wingPhase = 0;
  private progress = 0; // 0 -> 1 across the flight path
  private startX: number;
  private endX: number;
  private flightY: number;

  constructor(data: PigeonData, flightY: number, worldWidth: number) {
    super();
    this.data = data;
    this.flightY = flightY;
    this.startX = -40;
    this.endX = worldWidth + 40;
    this.x = this.startX;
    this.y = this.flightY;

    this.envelope = new PIXI.Graphics();
    const color = STATUS_COLOR[data.status];
    this.envelope.beginFill(color);
    this.envelope.lineStyle(1, 0x0b1120, 0.6);
    this.envelope.drawRoundedRect(-7, 2, 14, 10, 2);
    this.envelope.endFill();
    this.envelope.moveTo(-7, 2);
    this.envelope.lineTo(0, 8);
    this.envelope.lineTo(7, 2);
    this.addChild(this.envelope);

    this.bird = new PIXI.Graphics();
    this.redrawBird(0);
    this.addChild(this.bird);

    this.eventMode = "static";
    this.cursor = "pointer";
  }

  private redrawBird(wingLift: number): void {
    this.bird.clear();
    // Outlined in slate so the pale body still reads against the icy floor.
    this.bird.lineStyle(1, 0x475569, 0.7);
    this.bird.beginFill(0xe2e8f0);
    this.bird.drawEllipse(0, -6, 10, 6); // body
    this.bird.drawCircle(8, -10, 4); // head
    this.bird.endFill();

    this.bird.lineStyle();
    this.bird.beginFill(0xf97316);
    this.bird.drawPolygon([12, -10, 17, -9, 12, -8]); // beak
    this.bird.endFill();

    this.bird.lineStyle(1, 0x475569, 0.7);
    this.bird.beginFill(0x94a3b8);
    this.bird.drawEllipse(-4, -6 - wingLift, 7, 3); // wing
    this.bird.endFill();
  }

  /** Returns true while still in flight; false once it reaches the far edge. */
  update(delta: number, durationFrames: number): boolean {
    this.progress += delta / durationFrames;
    this.wingPhase += delta * 0.6;

    this.x = this.startX + (this.endX - this.startX) * this.progress;
    this.y = this.flightY + Math.sin(this.progress * Math.PI * 6) * 6;
    this.redrawBird(Math.abs(Math.sin(this.wingPhase)) * 4);

    return this.progress < 1;
  }
}
