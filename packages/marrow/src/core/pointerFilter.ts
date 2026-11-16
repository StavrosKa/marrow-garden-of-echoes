// The pointer filter (Requirement 8): one One Euro filter per active wrist, run on
// each axis of the camera-space wrist position, with its three parameters read from
// the tuning object (Req 8.1). The caller steps it once per consumed frame, with the
// presence time since the previous consumed frame (Req 8.2).
//
// A wrist's filter is dropped at its first invalid sample. So during a gap the state
// holds no position for that wrist, and the first valid sample after the gap starts
// a new filter and is output unchanged (Req 8.3). Nothing from before a gap reaches
// an output after it (Req 8.5), and an invalid wrist's pointer has no position field
// at all (Req 8.7).
import type { Landmark, Vec2, WristId } from './frame';
import { createOneEuro, oneEuroStep, type OneEuroConfig, type OneEuroState } from './oneEuro';
import type { Tuning } from './tuning';

/** The wrist samples of one consumed frame: one landmark for each active wrist. */
export type PointerSample = { readonly [W in WristId]?: Landmark };

/**
 * One wrist's pointer after the filter, still in camera space: the filtered position
 * while the wrist is valid, and no position at all while it is invalid (Req 8.7).
 */
export type FilteredPointer = { readonly valid: true; readonly pos: Vec2 } | { readonly valid: false };

/** The pointers of one step: one for each wrist in the sample. */
export type FilteredPointers = { readonly [W in WristId]?: FilteredPointer };

/** One wrist's filter: a One Euro filter on each axis. */
interface WristFilter {
  readonly x: OneEuroState;
  readonly y: OneEuroState;
}

export interface PointerFilterState {
  /** The One Euro parameters, read from the tuning object when the filter was created. */
  readonly cfg: OneEuroConfig;
  /** The filter of each wrist whose last sample was valid. Every other wrist has none. */
  readonly wrists: { readonly [W in WristId]?: WristFilter };
}

const WRISTS: readonly WristId[] = ['left', 'right'];

/** A filter that has seen no sample, with the One Euro parameters of `tuning`. */
export function createPointerFilter(tuning: Tuning): PointerFilterState {
  return {
    cfg: {
      minCutoffHz: tuning.oneEuroMinCutoffHz,
      beta: tuning.oneEuroBeta,
      dCutoffHz: tuning.oneEuroDCutoffHz,
    },
    wrists: {},
  };
}

/**
 * Forgets every wrist's samples, for resuming after Pause or a hidden tab: the next
 * valid sample of each wrist is output unchanged (Req 8.4). The parameters stay.
 */
export function resetPointerFilter(state: PointerFilterState): PointerFilterState {
  return { cfg: state.cfg, wrists: {} };
}

/**
 * Filters the wrist samples of one consumed frame, taken dtMs of presence time after
 * the previous consumed frame. A valid wrist gives its filtered position; an invalid
 * one gives an invalid pointer and loses its filter. A wrist that is not in the
 * sample gives no pointer and loses its filter too.
 */
export function stepPointerFilter(
  state: PointerFilterState,
  sample: PointerSample,
  dtMs: number,
): { state: PointerFilterState; pointers: FilteredPointers } {
  const wrists: { [W in WristId]?: WristFilter } = {};
  const pointers: { [W in WristId]?: FilteredPointer } = {};
  for (const wrist of WRISTS) {
    const landmark = sample[wrist];
    if (landmark === undefined) continue;
    if (!landmark.valid) {
      pointers[wrist] = { valid: false };
      continue;
    }
    const filter = state.wrists[wrist] ?? { x: createOneEuro(state.cfg), y: createOneEuro(state.cfg) };
    const x = oneEuroStep(filter.x, landmark.pos.x, dtMs);
    const y = oneEuroStep(filter.y, landmark.pos.y, dtMs);
    wrists[wrist] = { x: x.state, y: y.state };
    pointers[wrist] = { valid: true, pos: { x: x.value, y: y.value } };
  }
  return { state: { cfg: state.cfg, wrists }, pointers };
}
