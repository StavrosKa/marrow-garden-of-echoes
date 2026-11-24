// The camera-space reach of a synthetic player during calibration (garden-level design 2.5; requirement 19.1, 19.6).
// The covered region is the centred square of the frame whose area is the profile's reachShare, so a share of 0.5
// covers a square of side sqrt(0.5). Each sample is one seeded draw in each axis.
import { nextUnit, type Rng } from '../challenges/rng';
import type { Vec2 } from '../core';
import type { SimProfile } from './tuning';

/** The centre of the camera frame on each axis, in normalized units. */
const CENTRE = 0.5;

/** `count` camera-space samples inside the covered region, and the generator after the draws. */
export function sweepSamples(
  profile: SimProfile,
  rng: Rng,
  count: number,
): { readonly samples: readonly Vec2[]; readonly rng: Rng } {
  const side = Math.sqrt(profile.reachShare);
  const samples: Vec2[] = [];
  let current = rng;
  for (let i = 0; i < count; i++) {
    const x = nextUnit(current);
    const y = nextUnit(x.rng);
    current = y.rng;
    samples.push({
      x: CENTRE + (x.value - CENTRE) * side,
      y: CENTRE + (y.value - CENTRE) * side,
    });
  }
  return { samples, rng: current };
}
