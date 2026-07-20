import * as PIXI from "pixi.js-legacy";

const ROOM_TEXTURE_URL = "/sprites/lobby.webp";
// The source art's actual pixel size. Sprite scaling below needs this up
// front to compute a "cover" fit, but Texture.from() resolves the image
// asynchronously — texture.width/height read as a 1x1 placeholder until
// it's loaded — so the real dimensions are hardcoded rather than read off
// the texture.
const ROOM_NATURAL_WIDTH = 1518;
const ROOM_NATURAL_HEIGHT = 944;

// Fraction of the room's height, from the top, that's building/fountain/sky
// rather than open ground — penguins shouldn't be able to walk up into it.
// Eyeballed against the source art: the plaza opens up clear of the
// fountain and buildings starting a bit past halfway down.
export const ROOM_WALKABLE_TOP_FRACTION = 0.56;

export interface Room {
  container: PIXI.Container;
  resize: (width: number, height: number) => void;
}

/**
 * Renders the room as one piece of art (a Club Penguin town screenshot)
 * instead of procedurally-drawn tiles — same "ship a picture, don't draw
 * primitives" approach most 2D games with real art use. The image is
 * scaled and center-cropped to exactly fill the canvas, matching CSS
 * `background-size: cover` (which Pixi has no built-in equivalent of).
 */
export function buildRoom(width: number, height: number): Room {
  const container = new PIXI.Container();

  const sprite = new PIXI.Sprite(PIXI.Texture.from(ROOM_TEXTURE_URL));
  sprite.anchor.set(0.5);
  container.addChild(sprite);

  const layout = (w: number, h: number) => {
    const coverScale = Math.max(w / ROOM_NATURAL_WIDTH, h / ROOM_NATURAL_HEIGHT);
    sprite.scale.set(coverScale);
    sprite.x = w / 2;
    sprite.y = h / 2;
  };
  layout(width, height);

  return { container, resize: layout };
}
