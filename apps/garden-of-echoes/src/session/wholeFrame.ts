// The reach of simulated input (garden-level design 2.7; requirement 20.3): the whole play area is comfortable for the
// one wrist that the mouse serves. The calibration is marrow's own, run as the playground's mouse setup runs it, so the
// placement sees the same kind of comfort grids that a camera player would give it.
import { chooseWholeScreen, createCalibration, makeMapping, TUNING, type Mapping, type WristId } from 'marrow/core';
import type { PlaceRoundInput } from '../stages/shared/placeRound';

/** The wrist that the mouse serves. Simulated input has one pointer (Req 20.3). */
export const SIMULATED_WRISTS: readonly WristId[] = ['right'];

export interface WholeFrameReach {
  readonly grids: PlaceRoundInput['grids'];
  readonly mapping: Mapping;
}

/** The comfort grids and the mapping of simulated input for a play area of this aspect. */
export function wholeFrameReach(playAspect: number): WholeFrameReach {
  const created = createCalibration({
    activeWrists: [...SIMULATED_WRISTS],
    mode: 'simulated',
    demand: { slots: [], n: 1, r: TUNING.hitRadius, m: 0 },
    frameAspect: playAspect,
    playAspect,
    tuning: TUNING,
  });
  const result = chooseWholeScreen(created).state.result;
  if (result === null) throw new Error('wholeFrameReach: the whole-screen calibration did not complete');
  const mapping = makeMapping({
    playAspect,
    frameAspect: playAspect,
    gain: result.transform.gain,
    centre: result.transform.centre,
  });
  return { grids: result.grids, mapping };
}
