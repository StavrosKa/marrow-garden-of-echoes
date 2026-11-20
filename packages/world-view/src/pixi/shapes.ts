// Drawing of backdrops, shapes, targets and the cover. Everything is drawn in local units of
// DRAW_UNIT per layer unit; the Graphics object is scaled back by 1 / DRAW_UNIT (design 7.2).
import type { Rect } from '../core/types';
import type { GraphicsLike } from './ports';
import type { ShapeSpec } from './types';

/** Local drawing units per screen unit. A precaution about small circles (design 11 item 11), not a tuning value. */
export const DRAW_UNIT = 1024;

const HALF = 0.5;

/** A backdrop rectangle, in layer units, filled with a colour. */
export function drawBackdrop(graphics: GraphicsLike, rect: Rect, colour: number): void {
  graphics.rect(rect.x0 * DRAW_UNIT, rect.y0 * DRAW_UNIT, (rect.x1 - rect.x0) * DRAW_UNIT, (rect.y1 - rect.y0) * DRAW_UNIT);
  graphics.fill(colour);
}

/**
 * The shapes of one group (accent or not), in layer units. A unit x coordinate of the shapes is a
 * fraction of the width, so it is multiplied by the aspect (the width in screen units).
 */
export function drawShapes(graphics: GraphicsLike, shapes: readonly ShapeSpec[], aspect: number, accent: boolean): void {
  for (const shape of shapes) {
    if ((shape.accent === true) !== accent) continue;
    const { x0, y0, x1, y1 } = shape.bounds;
    const left = x0 * aspect * DRAW_UNIT;
    const top = y0 * DRAW_UNIT;
    const width = (x1 - x0) * aspect * DRAW_UNIT;
    const height = (y1 - y0) * DRAW_UNIT;
    switch (shape.kind) {
      case 'rect':
        graphics.rect(left, top, width, height);
        break;
      case 'ellipse':
        graphics.ellipse(left + width * HALF, top + height * HALF, width * HALF, height * HALF);
        break;
      case 'roundRect':
        graphics.roundRect(left, top, width, height, Math.min(width, height) * HALF);
        break;
    }
    graphics.fill(shape.colour);
  }
}

/** A target's visible disc, centred on its own origin, at `r` in local units. The caller passes `r * targetVisualRatio`, not the hit radius. */
export function drawTarget(graphics: GraphicsLike, r: number, colour: number): void {
  graphics.clear();
  graphics.circle(0, 0, r * DRAW_UNIT);
  graphics.fill(colour);
}

/** The cover: a rectangle over the whole viewport `[0, aspect] x [0, 1]`. */
export function drawCover(graphics: GraphicsLike, aspect: number, colour: number): void {
  graphics.clear();
  graphics.rect(0, 0, aspect * DRAW_UNIT, DRAW_UNIT);
  graphics.fill(colour);
}
