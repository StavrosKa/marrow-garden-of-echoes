// The inputs of the Scene Manager (garden-level design 2.8, 3 steps 4 and 6; requirements 2.4, 2.7, 22.2). The layers come
// from the layer table of the current backdrop in table order, and each frame's data comes from the session: the travel
// distance and cover, whether the session is travelling, and which targets are active and shown. The head is at rest in
// this task (the head view is not wired yet), so the view has no parallax.
import type { MotionLevel } from 'marrow/core';
import type { SessionState } from '../session/machine';
import { ROUTE } from '../session/stageOrder';
import { resolveLayerTable, TUNING as WORLD_TUNING, type LayerTableEntry, type Rect, type View } from 'world-view';
import type { FrameData, SceneLayerSpec, SceneTarget, ShapeSpec } from 'world-view/pixi';
import type { GardenState } from '../session/stageDriver';
import { lanternSceneKey, lanternSceneTargets } from '../stages/lantern-glade/scene';
import { whisperSceneKey, whisperSceneTargets } from '../stages/whisper-glade/scene';
import { colourNumber, theme, type ThemeToken } from '../ui/theme';
import { FOREST_LAYERS, WHISPER_LAYERS } from './forestLayers';
import { spriteSlot, type SpriteName } from './spriteSlot';

/** The Scene Manager's targets of the stage in progress: the lanterns, or the Whisper Glade targets, or none. */
export function sceneTargetsOf(state: GardenState): SceneTarget[] {
  if (state.stage?.kind === 'whisper') return whisperSceneTargets(state);
  if (state.stage?.kind === 'placeholder') return placeholderSceneTargets(state);
  return lanternSceneTargets(state);
}

/** The one visible disc of a placeholder stage (Req 9.1, 9.2), at its placed point. */
function placeholderSceneTargets(state: GardenState): SceneTarget[] {
  const stage = state.stage;
  const placed = state.placed;
  const point = placed?.points[0];
  if (stage === null || stage.kind !== 'placeholder' || placed === null || point === undefined) return [];
  return [{ id: stage.rule.targetId, point, r: placed.snapshot.radius, colour: spriteSlot('lantern-unlit').drawable[0]?.colour ?? 0 }];
}

/** The key of the scene targets: the scene is updated only when this changes. */
export function sceneKeyOf(state: GardenState): string {
  if (state.stage?.kind === 'whisper') return whisperSceneKey(state);
  if (state.stage?.kind === 'placeholder') {
    return `placeholder:${state.stage.rule.done ? 1 : 0}:${state.placed?.points.length ?? 0}:${state.placed?.snapshot.radius ?? 0}`;
  }
  return lanternSceneKey(state);
}

/** The visible disc of a target as a fraction of its hit radius, so the visible circle is smaller (steering 4). */
export const TARGET_VISUAL_RATIO = 0.5;

/** The cover of a cross-fade is the darkest grey of the ramp (Req 2.4). */
export const COVER_TOKEN: ThemeToken = 'grey0';

/** The backdrop of the scene: the Lantern Glade forest, or the Whisper Glade (Req 2.4). Each has its own layers. */
export type Backdrop = 'lantern' | 'whisper';

/** The index of journey A in the route, the travel the backdrop switch belongs to. */
const JOURNEY_A_STEP = ROUTE.findIndex((step) => step.kind === 'travel' && step.journey === 'journeyA');

/**
 * The backdrop of the scene in this frame. It switches once, to the Whisper Glade, and never back (`current` latches it).
 * Full and Gentle switch when journey A arrives, in the frame where the session leaves TRAVELLING. Reduced motion
 * switches at the plateau of its cross-fade, where the cover is full, so the switch is hidden under the cover (Req 2.4).
 */
export function backdropOf(session: SessionState, motion: MotionLevel, current: Backdrop): Backdrop {
  if (current === 'whisper') return 'whisper';
  if (session.stage === 'whisper-glade' || session.stage === 'whisper-hall' || session.stage === 'bloom') return 'whisper';
  if (session.done.includes('whisper-glade')) return 'whisper';
  const crossing =
    motion === 'reduced' &&
    session.phase === 'TRAVELLING' &&
    session.step === JOURNEY_A_STEP &&
    (session.travel?.cover ?? 0) >= 1;
  return crossing ? 'whisper' : 'lantern';
}

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
 * The placeholder bands of the lantern forest, by layer id (art-and-motion.md file names). The slots are placeholders
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

/**
 * The placeholder bands of the Whisper Glade. The sky and the hills are the forest's own, and the other layers have their
 * own slots (Req 2.4, 22.3). The trunks are narrower than the lantern trunks, and the ground is a different band.
 */
const WHISPER_BANDS: Readonly<Record<string, readonly LayerBand[]>> = {
  'layer-0': [{ name: 'forest-sky', bounds: { x0: 0, y0: 0, x1: 1, y1: 1 } }],
  'layer-1': [{ name: 'forest-hills', bounds: { x0: -0.3, y0: 0.38, x1: 1.3, y1: 1.3 } }],
  'layer-2': [{ name: 'forest-fartrees-b', bounds: { x0: -0.1, y0: 0.48, x1: 1.1, y1: 0.8 } }],
  'layer-3': [{ name: 'glade2-ground', bounds: { x0: 0, y0: 0.7, x1: 1, y1: 1 } }],
  'layer-4': [
    { name: 'glade2-trunk-left', bounds: { x0: 0, y0: 0, x1: 0.1, y1: 1 } },
    { name: 'glade2-trunk-right', bounds: { x0: 0.9, y0: 0, x1: 1, y1: 1 } },
  ],
};

/** The layer table and the bands of each backdrop. */
const SCENES: Readonly<Record<Backdrop, { readonly table: readonly LayerTableEntry[]; readonly bands: Readonly<Record<string, readonly LayerBand[]>> }>> = {
  lantern: { table: FOREST_LAYERS, bands: FOREST_BANDS },
  whisper: { table: WHISPER_LAYERS, bands: WHISPER_BANDS },
};

/** The shapes of one layer: each band's slot drawable, moved to the band's bounds. */
function shapesOf(layerId: string, bands: Readonly<Record<string, readonly LayerBand[]>>): ShapeSpec[] {
  return (bands[layerId] ?? []).flatMap((band) => spriteSlot(band.name).drawable.map((shape) => ({ ...shape, bounds: band.bounds })));
}

/** The layers of a backdrop in table order, with a backdrop fill where the table gives one and the placeholder shapes of each. */
export function sceneLayersOf(backdrop: Backdrop): SceneLayerSpec[] {
  const { table, bands } = SCENES[backdrop];
  const defs = resolveLayerTable(table, WORLD_TUNING);
  return defs.map((def, index) => {
    const entry: LayerTableEntry | undefined = table[index];
    const token = themeTokenOf(entry?.fill);
    return { ...def, fill: token === undefined ? undefined : colourNumber(token), shapes: shapesOf(def.id, bands) };
  });
}

/** The lantern forest's layers (the backdrop before journey A arrives). */
export function forestSceneLayers(): SceneLayerSpec[] {
  return sceneLayersOf('lantern');
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
