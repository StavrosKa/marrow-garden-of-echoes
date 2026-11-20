// Content and theme to the Scene Manager's input (design 8.3, 8.4): layers with their colours and
// shapes, and the targets of the placed stops. The colours are numbers from the theme module.
import { TUNING, type Tuning } from 'world-view';
import type { SceneLayerSpec, SceneTarget, ShapeSpec } from 'world-view/pixi';
import { colourNumber } from '../../ui/theme';
import { TARGET_TOKEN } from './constants';
import type { PlacedStop } from './placementSetup';
import { layerDefsOf, type ContentShape, type WorldContent } from './worldContent';

const ZERO = 0;

function toShape(shape: ContentShape, accent: boolean): ShapeSpec {
  const colour = colourNumber(shape.colour);
  if (shape.kind === 'rect') {
    const rounded = shape.radius !== undefined && shape.radius > ZERO;
    return {
      kind: rounded ? 'roundRect' : 'rect',
      bounds: { x0: shape.u0, y0: shape.v0, x1: shape.u1, y1: shape.v1 },
      colour,
      accent,
    };
  }
  return {
    kind: 'ellipse',
    bounds: { x0: shape.cu - shape.ru, y0: shape.cv - shape.rv, x1: shape.cu + shape.ru, y1: shape.cv + shape.rv },
    colour,
    accent,
  };
}

/** The layers in table order, with the factors of the table and the shapes (accent shapes last). */
export function sceneLayers(content: WorldContent, tuning: Tuning = TUNING): SceneLayerSpec[] {
  const defs = layerDefsOf(content, tuning);
  return content.layers.map((layer, i) => {
    const def = defs[i];
    if (def === undefined) throw new Error(`world slice: no layer definition at index ${i}`);
    const fill = layer.fill === undefined ? undefined : colourNumber(layer.fill.colour);
    return {
      id: def.id,
      depth: def.depth,
      anchor: def.anchor,
      factor: def.factor,
      backdrop: def.backdrop,
      interaction: def.interaction,
      fill,
      shapes: [
        ...layer.shapes.map((shape) => toShape(shape, false)),
        ...layer.accentShapes.map((shape) => toShape(shape, true)),
      ],
    };
  });
}

/** The targets of the placed stops, all drawn in the unselected colour. */
export function sceneTargets(stops: readonly PlacedStop[]): SceneTarget[] {
  const colour = colourNumber(TARGET_TOKEN);
  return stops.flatMap((stop) => stop.targets.map((target) => ({ id: target.id, point: target.point, r: target.r, colour })));
}
