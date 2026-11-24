// The placement of one round (Requirement 10, 12; design 2.8). The authored world slots become screen
// slots at the rest view, planPlacement applies the resting band, and each chosen screen object goes
// back to its world point by identity. The help levels are read only through snapshotRound (Req 12.1).
import { planPlacement } from 'marrow/challenges';
import type { ComfortGrid, HelpState, Mapping, Tuning, Vec2, WristId } from 'marrow/core';
import {
  depthScale,
  parallaxMargin,
  TUNING,
  worldToScreen,
  type LayerRef,
  type ProjectionFrame,
  type View,
  type WorldPoint,
} from 'world-view';
import { snapshotRound, type RoundSnapshot } from '../../session/roundSnapshot';

/** The comfort grids of planPlacement, keyed by wrist. */
type WristGrids = Parameters<typeof planPlacement>[1];

/**
 * The round's placement. `points` holds the world points the round shows targets at: one per target
 * for a sequential round, and none for a round with no usable slot. `points` are the caller's own
 * world point objects.
 */
export interface PlacedRound {
  readonly kind: 'simultaneous' | 'sequential' | 'none';
  readonly points: readonly WorldPoint[];
  readonly snapshot: RoundSnapshot;
  readonly bandSlotsUsed: number;
}

export interface PlaceRoundInput {
  /** The authored candidate slots, on the interaction layer. */
  readonly worldSlots: readonly WorldPoint[];
  readonly n: number;
  /** Read only through snapshotRound. */
  readonly help: HelpState;
  readonly grids: WristGrids;
  /** The wrists in use. Only their grids count (one hand: the other wrist's grid is dropped). */
  readonly activeWrists: readonly WristId[];
  readonly mapping: Mapping;
  readonly view: View;
  readonly frame: ProjectionFrame;
  /** The interaction layer. Its factor must be TUNING.interactionFactor, which parallaxMargin assumes. */
  readonly layer: LayerRef;
  readonly bandY: number;
  readonly core: Tuning;
}

/** The grids of the active wrists only. A wrist with no grid stays absent. */
function activeGrids(grids: WristGrids, active: readonly WristId[]): WristGrids {
  const kept: { right?: ComfortGrid; left?: ComfortGrid } = {};
  for (const wrist of active) {
    const grid = grids[wrist];
    if (grid !== undefined) kept[wrist] = grid;
  }
  return kept;
}

/** Places the targets of one round (Req 10, 12). Projects at head (0, 0) so the margin m covers every head offset. */
export function placeRound(input: PlaceRoundInput): PlacedRound {
  const { worldSlots, n, help, grids, activeWrists, mapping, view, frame, layer, bandY, core } = input;
  if (layer.factor !== TUNING.interactionFactor) {
    throw new Error('placeRound: the layer is not the interaction layer (its factor must be interactionFactor)');
  }
  const snapshot = snapshotRound(help, core);
  // The radius that targetScreen gives a target of this layer: the radius times the layer's depth scale.
  const r = snapshot.radius * depthScale(layer, view.travel);
  const m = parallaxMargin(frame.sceneScale, frame.aspect);
  const rest: View = { travel: view.travel, head: { x: 0, y: 0 } };

  // Each projection is a new object, so the Map tells two authored points apart even when they project
  // to equal coordinates. Culled points have no screen position and are left out.
  const owner = new Map<Vec2, WorldPoint>();
  const slots: Vec2[] = [];
  for (const point of worldSlots) {
    const screen = worldToScreen(point, rest, frame);
    if (screen === null) continue;
    slots.push(screen);
    owner.set(screen, point);
  }

  const { result, bandSlotsUsed } = planPlacement(
    { slots, n, r, m },
    activeGrids(grids, activeWrists),
    mapping,
    core,
    bandY,
  );
  const back = (slot: Vec2): WorldPoint => {
    const point = owner.get(slot);
    if (point === undefined) throw new Error('placeRound: a chosen slot has no world point');
    return point;
  };
  if (result.kind === 'none') return { kind: 'none', points: [], snapshot, bandSlotsUsed };
  const shown = result.kind === 'simultaneous' ? result.slots : result.targetSlots;
  return { kind: result.kind, points: shown.map(back), snapshot, bandSlotsUsed };
}
