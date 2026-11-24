// The inputs of the Scene Manager (garden-level design 2.8, 3 steps 4 and 6; requirements 2.7, 22.2). The forest layers
// come from the layer table in table order, and each frame's data comes from the session: the travel distance and cover,
// whether the session is travelling, and which targets are active and shown. The head is at rest in this task (the head
// view is not wired yet), so the view has no parallax.
import type { SessionState } from '../session/machine';
import { resolveLayerTable, TUNING as WORLD_TUNING, type LayerTableEntry, type Rect, type View } from 'world-view';
import type { FrameData, SceneLayerSpec, ShapeSpec } from 'world-view/pixi';
import { colourNumber, theme, type ThemeToken } from '../ui/theme';
import { FOREST_LAYERS } from './forestLayers';
import { spriteSlot, type SpriteName } from './spriteSlot';

/** The visible disc of a target as a fraction of its hit radius, so the visible circle is smaller (steering 4). */
export const TARGET_VISUAL_RATIO = 0.5;

/** The cover of a cross-fade is the darkest grey of the ramp (Req 2.4). */
export const COVER_TOKEN: ThemeToken = 'grey0';

/** Whether a fill names a colour of the theme. Layer fills are theme tokens, so the scene takes them from the theme. */
function themeTokenOf(fill: unknown): ThemeToken | undefined {
  return typeof fill === 'string' && Object.hasOwn(theme, fill) ? (fill as ThemeToken) : undefined;
}

/** One sprite slot placed in a band of its layer, in screen units: 0 to 1 across the screen's height, x scaled by the aspect. */
interface LayerBand {
  readonly name: SpriteName;
  readonly bounds: Rect;
}

/**
 * The placeholder bands of each forest layer, by layer id (art-and-motion.md file names). The slots are placeholders
 * until the owner's PNGs exist; a band is where the slot's shape sits in the frame. Fog and foliage have no layer of
 * the table, so they are not placed here.
 */
const FOREST_BANDS: Readonly<Record<string, readonly LayerBand[]>> = {
  'layer-0': [{ name: 'forest-sky', bounds: { x0: 0, y0: 0, x1: 1, y1: 1 } }],
  'layer-1': [{ name: 'forest-hills', bounds: { x0: -0.3, y0: 0.38, x1: 1.3, y1: 1.3 } }],
  'layer-2': [{ name: 'forest-fartrees-a', bounds: { x0: -0.1, y0: 0.5, x1: 1.1, y1: 0.85 } }],
  'layer-3': [{ name: 'glade1-ground', bounds: { x0: 0, y0: 0.72, x1: 1, y1: 1 } }],
  'layer-4': [
    { name: 'glade1-trunk-left', bounds: { x0: 0, y0: 0, x1: 0.14, y1: 1 } },
    { name: 'glade1-trunk-right', bounds: { x0: 0.86, y0: 0, x1: 1, y1: 1 } },
  ],
};

/** The shapes of one layer: each band's slot drawable, moved to the band's bounds. */
function shapesOf(layerId: string): ShapeSpec[] {
  return (FOREST_BANDS[layerId] ?? []).flatMap((band) =>
    spriteSlot(band.name).drawable.map((shape) => ({ ...shape, bounds: band.bounds })),
  );
}

/** The forest layers in table order, with a backdrop fill where the table gives one and the placeholder shapes of each. */
export function forestSceneLayers(): SceneLayerSpec[] {
  const defs = resolveLayerTable(FOREST_LAYERS, WORLD_TUNING);
  return defs.map((def, index) => {
    const entry: LayerTableEntry | undefined = FOREST_LAYERS[index];
    const token = themeTokenOf(entry?.fill);
    return { ...def, fill: token === undefined ? undefined : colourNumber(token), shapes: shapesOf(def.id) };
  });
}

/** What the scene reads each frame from the session and the stage (design 3 step 6). */
export interface FrameInput {
  readonly session: SessionState;
  /** Ids of the targets that can be selected now. */
  readonly active: readonly string[];
  /** Ids of the targets that are drawn. */
  readonly shown: readonly string[];
}

/** The frame data of the Scene Manager: the view of the travel and the targets' states. */
export function frameDataOf(input: FrameInput): FrameData {
  const travel = input.session.travel;
  const view: View = { travel: travel?.distance ?? 0, head: { x: 0, y: 0 } };
  return {
    view,
    interactionView: view,
    interactionHead: { x: 0, y: 0 },
    decorativeHead: { x: 0, y: 0 },
    cover: travel?.cover ?? 0,
    accentAlpha: 0,
    travelling: input.session.phase === 'TRAVELLING',
    active: new Set(input.active),
    shown: new Set(input.shown),
  };
}
