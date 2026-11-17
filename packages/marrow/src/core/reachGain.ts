// The comfort centre and the reach gain (Requirement 13): the two parameters of the
// mapping that calibration sets from the comfort grids of the active wrists. It
// computes them once when it completes (Req 12.8), and again for each demand check
// while the player paints (design section 14.2).
//
// Everything is measured at gain 1, through the mapping that makeMapping gives at the
// identity gain, so this file has no camera-to-screen formula of its own: the mapping
// is the only conversion between the two spaces (Req 10.1).
//   centre: the mean of the screen-space centres of the valid cells, a cell counted
//           once for each wrist it is valid for (Req 13.1);
//   span:   the larger side of the screen-space bounding box of the same cells, each
//           taken as its whole rectangle (Req 13.2);
//   gain:   reachGainSpanTarget / span, clamped to reachGainMin..reachGainMax (Req 13.3).
// The mapping mirrors x, so a cell's left edge in camera space becomes its right edge
// on screen. The box is therefore the minimum and the maximum over every mapped
// corner, never "the left corner gives the left edge".
//
// With no valid cell, the gain is the identity and the centre is the play-area centre
// (Req 13.4). The box sizes the gain and nothing else (Req 13.5): it is not returned,
// and no grid changes (Req 13.6). Which slots are reachable is decided from the valid
// cells alone, through the mapping (Requirement 14).
//
// The caller supplies valid aspects, finite and above 0 as makeMapping needs, and grids
// of the size of the tuning it passes. Nothing here checks them or throws.
import { cellRectCamera, validCells, type ComfortGrid } from './comfortGrid';
import type { WristId } from './frame';
import { clamp } from './geometry';
import { makeMapping, type MappingParams } from './mapping';
import type { Tuning } from './tuning';

/** The comfort grid of each active wrist (Req 11.1). A wrist with no grid is not active. */
export type WristGrids = { readonly [W in WristId]?: ComfortGrid };

/** The comfort centre c and the reach gain g: the parameters of the mapping that calibration sets (Req 13). */
export type ComfortTransform = Pick<MappingParams, 'centre' | 'gain'>;

/**
 * The identity scale: a reach gain of 1 moves no point. This is a fact about scaling,
 * so it is named here and not read from reachGainMin, which is a tuning value (Req 13.4).
 */
const IDENTITY_GAIN = 1;
/**
 * The middle of an interval lies halfway between its ends: the play area's centre is
 * (A * HALF, HALF), and a cell's centre lies halfway between its edges. Geometry, not a
 * tuning value.
 */
const HALF = 0.5;
/** Both wrists, in a fixed order, so the sums do not depend on the order of the keys of the grids. */
const WRISTS: readonly WristId[] = ['left', 'right'];

/**
 * The comfort centre and the reach gain for the grids of the active wrists (Req 13.1-13.4),
 * with a camera image of aspect frameAspect (a) and a play area of aspect playAspect (A).
 * The grids are only read.
 */
export function computeComfortTransform(
  grids: WristGrids,
  frameAspect: number,
  playAspect: number,
  tuning: Tuning,
): ComfortTransform {
  // The transform with no valid cell (Req 13.4): the identity gain about the play-area
  // centre. It moves no point, so the mapping it gives is the base mapping.
  const identity: ComfortTransform = {
    centre: { x: playAspect * HALF, y: HALF },
    gain: IDENTITY_GAIN,
  };
  const { toScreen } = makeMapping({ playAspect, frameAspect, ...identity });

  let counted = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const wrist of WRISTS) {
    const grid = grids[wrist];
    if (grid === undefined) continue;
    for (const { col, row } of validCells(grid, tuning)) {
      const { x0, y0, x1, y1 } = cellRectCamera(col, row, tuning);
      const centre = toScreen({ x: (x0 + x1) * HALF, y: (y0 + y1) * HALF });
      counted += 1;
      sumX += centre.x;
      sumY += centre.y;
      for (const x of [x0, x1]) {
        for (const y of [y0, y1]) {
          const corner = toScreen({ x, y });
          minX = Math.min(minX, corner.x);
          maxX = Math.max(maxX, corner.x);
          minY = Math.min(minY, corner.y);
          maxY = Math.max(maxY, corner.y);
        }
      }
    }
  }
  if (counted === 0) return identity;

  const span = Math.max(maxX - minX, maxY - minY);
  return {
    centre: { x: sumX / counted, y: sumY / counted },
    gain: clamp(tuning.reachGainSpanTarget / span, tuning.reachGainMin, tuning.reachGainMax),
  };
}
