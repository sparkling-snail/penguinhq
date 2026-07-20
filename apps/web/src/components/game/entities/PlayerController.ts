import { Penguin, type PenguinOptions, type WorldBounds } from "./Penguin";

const SPEED = 2.6; // px per frame at delta=1

/**
 * The one penguin the user directly controls — WASD/arrow keys.
 *
 * Input handling lives here rather than in GameCanvas so the controller
 * is a self-contained, testable unit: construct it, call `update(delta)`
 * every tick, and it moves itself and keeps its own facing/animation
 * state in sync. `destroy()` (inherited from PIXI.Container, overridden
 * below) removes its window listeners so it doesn't leak when the canvas
 * unmounts.
 */
export class PlayerController extends Penguin {
  private pressed = new Set<string>();
  private bounds: WorldBounds;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    this.pressed.add(e.key.toLowerCase());
  };
  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.pressed.delete(e.key.toLowerCase());
  };

  constructor(options: PenguinOptions, bounds: WorldBounds) {
    super(options);
    this.bounds = bounds;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  setBounds(bounds: WorldBounds): void {
    this.bounds = bounds;
  }

  override update(delta: number): void {
    super.update(delta);

    let dx = 0;
    let dy = 0;
    if (this.pressed.has("w") || this.pressed.has("arrowup")) dy -= 1;
    if (this.pressed.has("s") || this.pressed.has("arrowdown")) dy += 1;
    if (this.pressed.has("a") || this.pressed.has("arrowleft")) dx -= 1;
    if (this.pressed.has("d") || this.pressed.has("arrowright")) dx += 1;

    const moving = dx !== 0 || dy !== 0;
    this.setState(moving ? "walking" : "idle");

    if (!moving) return;

    // Normalize diagonal movement so it isn't faster than cardinal movement.
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = (dx / length) * SPEED * delta;
    const ny = (dy / length) * SPEED * delta;

    this.x = Math.min(Math.max(this.x + nx, 24), this.bounds.width - 24);
    this.y = Math.min(Math.max(this.y + ny, this.bounds.minY ?? 24), this.bounds.height - 24);

    // Flip to face movement direction.
    if (dx !== 0) this.scale.x = dx > 0 ? Math.abs(this.scale.x) : -Math.abs(this.scale.x);
  }

  override destroy(options?: Parameters<Penguin["destroy"]>[0]): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    super.destroy(options);
  }
}
