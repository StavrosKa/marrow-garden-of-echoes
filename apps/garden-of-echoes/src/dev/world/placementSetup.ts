// Placement of the two stops (Req 9.3, 12.1, 12.2, 14.2; design 8.3). Marrow's placeTargets chooses
// the slots. This file builds the comfort grid and the mapping for each input mode, places the
// targets of both stops, and turns the chosen slots into world points at the stop's rest view.
import {
  createCalibration,
  chooseWholeScreen,
  createGrid,
  makeMapping,
  markAllValid,
  placeTargets,
  TUNING as MARROW_TUNING,
  type CalibrationResult,
  type Mapping,
  type Vec2,
} from 'marrow/core';
import { parallaxMargin, screenToWorld, TUNING, type ProjectionFrame, type Tuning, type WorldPoint } from 'world-view';
import { stopTravel, type ContentSegment, type WorldContent } from './worldContent';

const ZERO = 0;
const ONE = 1;
const HALF = 0.5;
const ACTIVE_WRIST = 'right';

/** The comfort grids (keyed by wrist) and the mapping that goes with them. */
export interface ComfortSetup {
  readonly grids: CalibrationResult['grids'];
  readonly mapping: Mapping;
}

/** One target of a stop: its id, its world point on the interaction layer and its hit radius. */
export interface PlacedTarget {
  readonly id: string;
  readonly point: WorldPoint;
  readonly r: number;
}

/** A stop after placement: its anchor and depth, the slots that were chosen and the targets at them. */
export interface PlacedStop {
  readonly id: string;
  readonly travel: number;
  readonly depth: number;
  readonly kind: 'simultaneous' | 'sequential';
  /** The screen slots the targets were given, in target order. */
  readonly slots: readonly Vec2[];
  readonly m: number;
  readonly r: number;
  readonly targets: readonly PlacedTarget[];
}

/** Why placement did not start the slice. The copy for each notice is in copy/ (Req 12.2). */
export type PlacementNotice = 'placementNotSimultaneous' | 'placementNone';

export type PlacementOutcome =
  | { readonly ok: true; readonly stops: readonly PlacedStop[] }
  | { readonly ok: false; readonly notice: PlacementNotice };

/**
 * Mouse mode (Req 12.4): the whole screen is comfortable. The grid comes from Marrow's chooseWholeScreen
 * on a simulated-input calibration state, and the mapping is built from the transform that the
 * result carries. The frame aspect of simulated input is the play area's aspect.
 */
export function mouseComfort(playAspect: number, r: number): ComfortSetup {
  const created = createCalibration({
    activeWrists: [ACTIVE_WRIST],
    mode: 'simulated',
    demand: { slots: [], n: ONE, r, m: ZERO },
    frameAspect: playAspect,
    playAspect,
    tuning: MARROW_TUNING,
  });
  const step = chooseWholeScreen(created);
  const result = step.state.result;
  if (result === null) throw new Error('world-view: chooseWholeScreen did not complete the calibration');
  const mapping = makeMapping({
    playAspect,
    frameAspect: playAspect,
    gain: result.transform.gain,
    centre: result.transform.centre,
  });
  return { grids: result.grids, mapping };
}

/**
 * Camera mode (Req 14.2): the whole camera frame is comfortable for the active wrist (markAllValid), the
 * reach gain is 1 and the comfort centre is the centre of the play area. No calibration screen runs.
 */
export function cameraComfort(playAspect: number, frameAspect: number): ComfortSetup {
  const grid = markAllValid(createGrid(MARROW_TUNING));
  const mapping = makeMapping({
    playAspect,
    frameAspect,
    gain: ONE,
    centre: { x: playAspect * HALF, y: HALF },
  });
  return { grids: { [ACTIVE_WRIST]: grid }, mapping };
}

/**
 * Places the targets of both stops (Req 12.1, 12.2, 9.3). Slots are in screen space: `(u * aspect, v)`.
 * Stop 1 must place simultaneously; stop 2 may place sequentially but not with `none`. Each chosen slot
 * becomes the world point `screenToWorld(slot, { travel: stop, head: (0, 0) }, layer, frame)`, where the
 * layer is the interaction layer at the stop's depth and anchor. No grid is changed here.
 */
export function placeStops(
  content: WorldContent,
  segment: ContentSegment,
  frame: ProjectionFrame,
  grids: CalibrationResult['grids'],
  mapping: Mapping,
  r: number,
  tuning: Tuning = TUNING,
): PlacementOutcome {
  const m = parallaxMargin(content.sceneScale, frame.aspect, tuning);
  const stops: PlacedStop[] = [];
  for (const [index, stop] of content.stops.entries()) {
    const travel = stopTravel(stop, segment);
    const slots = stop.slots.map((slot) => ({ x: slot.u * frame.aspect, y: slot.v }));
    const result = placeTargets({ slots, n: stop.targets, r, m }, grids, mapping, MARROW_TUNING);
    if (index === ZERO && result.kind !== 'simultaneous') return { ok: false, notice: 'placementNotSimultaneous' };
    if (result.kind === 'none') return { ok: false, notice: 'placementNone' };
    const chosen = result.kind === 'simultaneous' ? result.slots : result.targetSlots;
    const restView = { travel, head: { x: ZERO, y: ZERO } };
    const layer = { depth: stop.depth, anchor: travel, factor: tuning.interactionFactor };
    const targets: PlacedTarget[] = [];
    for (const [k, slot] of chosen.entries()) {
      const point = screenToWorld(slot, restView, layer, frame, tuning);
      if (point === null) return { ok: false, notice: 'placementNone' };
      targets.push({ id: `${stop.id}-${k}`, point, r });
    }
    stops.push({ id: stop.id, travel, depth: stop.depth, kind: result.kind, slots: chosen, m, r, targets });
  }
  return { ok: true, stops };
}
