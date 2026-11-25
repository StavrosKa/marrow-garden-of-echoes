// The layer table of the forest (art-and-motion.md, interaction-invariants.md section 8). Pure data: the scene reads
// it, and the journey tests check it against every segment with world-view's rules. The rows run from the farthest to
// the nearest, as validateLayerTable requires. The interaction layer carries the targets and has no factor of its own.
// The nearest layer is at depth 18, so no layer is at or below foregroundDepth (15): the door segments run to depth 18,
// and a layer nearer than that would be out of view there.
import type { LayerTableEntry } from 'world-view';

/** The interaction layer: the lanterns and the other targets sit on it. Its depth is the depth of the content slots. */
export const INTERACTION_LAYER: LayerTableEntry = Object.freeze({
  id: 'layer-3',
  depth: 24,
  anchor: 0,
  backdrop: false,
  interaction: true,
});

/**
 * The Whisper Glade layer table: the same five rows, with the same depths and factors as the forest, so the world-view
 * checks of journeys A and B hold for it too (Req 2.4). Its sprites differ, and sceneSetup gives it its own bands.
 */
export const WHISPER_LAYERS: readonly LayerTableEntry[] = Object.freeze([
  { id: 'layer-0', depth: 4000, anchor: 0, backdrop: true, factor: 0, fill: 'night' },
  { id: 'layer-1', depth: 600, anchor: 0, backdrop: true, factor: 0.03, fill: 'night2' },
  { id: 'layer-2', depth: 120, anchor: 0, backdrop: false, factor: 0.1 },
  INTERACTION_LAYER,
  { id: 'layer-4', depth: 18, anchor: 0, backdrop: false, factor: 0.6 },
]);

export const FOREST_LAYERS: readonly LayerTableEntry[] = Object.freeze([
  { id: 'layer-0', depth: 4000, anchor: 0, backdrop: true, factor: 0, fill: 'night' },
  { id: 'layer-1', depth: 600, anchor: 0, backdrop: true, factor: 0.03, fill: 'night2' },
  { id: 'layer-2', depth: 120, anchor: 0, backdrop: false, factor: 0.1 },
  INTERACTION_LAYER,
  { id: 'layer-4', depth: 18, anchor: 0, backdrop: false, factor: 0.6 },
]);
