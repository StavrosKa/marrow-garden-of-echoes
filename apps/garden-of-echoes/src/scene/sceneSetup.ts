// The inputs of the Scene Manager (garden-level design 2.8, 3 steps 4 and 6; requirements 2.7, 22.2). The forest layers
// come from the layer table in table order, and each frame's data comes from the session: the travel distance and cover,
// whether the session is travelling, and which targets are active and shown. The head is at rest in this task (the head
// view is not wired yet), so the view has no parallax.
import type { SessionState } from '../session/machine';
import { resolveLayerTable, TUNING as WORLD_TUNING, type LayerTableEntry, type View } from 'world-view';
import type { FrameData, SceneLayerSpec } from 'world-view/pixi';
import { colourNumber, theme, type ThemeToken } from '../ui/theme';
import { FOREST_LAYERS } from './forestLayers';

/** The visible disc of a target as a fraction of its hit radius, so the visible circle is smaller (steering 4). */
export const TARGET_VISUAL_RATIO = 0.5;

/** The cover of a cross-fade is the darkest grey of the ramp (Req 2.4). */
export const COVER_TOKEN: ThemeToken = 'grey0';

/** Whether a fill names a colour of the theme. Layer fills are theme tokens, so the scene takes them from the theme. */
function themeTokenOf(fill: unknown): ThemeToken | undefined {
  return typeof fill === 'string' && Object.hasOwn(theme, fill) ? (fill as ThemeToken) : undefined;
}

/** The forest layers in table order, with a backdrop fill where the table gives one. Shapes come with the final art. */
export function forestSceneLayers(): SceneLayerSpec[] {
  const defs = resolveLayerTable(FOREST_LAYERS, WORLD_TUNING);
  return defs.map((def, index) => {
    const entry: LayerTableEntry | undefined = FOREST_LAYERS[index];
    const token = themeTokenOf(entry?.fill);
    return { ...def, fill: token === undefined ? undefined : colourNumber(token), shapes: [] };
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
