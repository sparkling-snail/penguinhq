import { Penguin, type PenguinOptions, type WorldBounds } from "./Penguin";

const SPEED = 0.9;
const IDLE_MIN_MS = 1500;
const IDLE_MAX_MS = 4000;

/**
 * A non-player penguin with a minimal "wander" AI: pick a random point
 * inside its bounds, walk to it, idle for a bit, repeat. This is a
 * placeholder for real agent-driven movement — once an agent's task
 * state actually changes (Milestone: agent runtime), NPCPenguin's target
 * will be set from that instead of `pickNewTarget()`.
 */
export class NPCPenguin extends Penguin {
  private target: { x: number; y: number };
  private bounds: WorldBounds;
  private idleUntil = 0;

  constructor(options: PenguinOptions, bounds: WorldBounds) {
    super(options);
    this.bounds = bounds;
    this.target = { x: this.x, y: this.y };
    this.idleUntil = performance.now() + Math.random() * IDLE_MAX_MS;
  }

  setBounds(bounds: WorldBounds): void {
    this.bounds = bounds;
  }

  private pickNewTarget(): void {
    const margin = 40;
    const minY = this.bounds.minY ?? margin;
    this.target = {
      x: margin + Math.random() * (this.bounds.width - margin * 2),
      y: minY + Math.random() * (this.bounds.height - margin - minY),
    };
  }

  override update(delta: number): void {
    super.update(delta);

    const now = performance.now();
    if (now < this.idleUntil) {
      this.setState("idle");
      return;
    }

    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 4) {
      this.setState("idle");
      this.idleUntil = now + IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
      this.pickNewTarget();
      return;
    }

    this.setState("walking");
    this.x += (dx / distance) * SPEED * delta;
    this.y += (dy / distance) * SPEED * delta;
    this.scale.x = dx > 0 ? Math.abs(this.scale.x) : -Math.abs(this.scale.x);
  }
}
