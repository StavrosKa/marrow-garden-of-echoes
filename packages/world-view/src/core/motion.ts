// Motion profile (Req 8.1, 8.2; steering section 8): the values of each motion level, read from
// tuning. The Full multipliers (1) and the Reduced head multiplier (0) define the levels, so they are
// named constants here, as marrow does for its own level values.
import type { MotionLevel } from 'marrow/core';
import { TUNING, type Tuning } from './tuning';

const ZERO = 0;
const ONE = 1;

/** The rank of a level by motion: its place in MOTION_ORDER, so a higher rank has more motion (Req 8.6). */
export type MotionRank = number;

/** The levels from the least motion to the most (Req 8.6: Reduced, Gentle, Full). */
const MOTION_ORDER: readonly MotionLevel[] = ['reduced', 'gentle', 'full'];

/** One row of the Req 8.2 table for one level. */
export interface MotionProfile {
  readonly headMultiplier: number;
  /** Multiplier of the segment duration. `null` for Reduced, where the table says "not used". */
  readonly travelDurationMultiplier: number | null;
  readonly travelStyle: 'travel' | 'fade';
  readonly ambientAmplitudeMultiplier: number;
  readonly ambientSpeedMultiplier: number;
  readonly particles: boolean;
  readonly lightFlicker: boolean;
  readonly pointerTrail: boolean;
}

/** The profile of a motion level (Req 8.2). Each call returns a new object. */
export function motionProfile(level: MotionLevel, tuning: Tuning = TUNING): MotionProfile {
  switch (level) {
    case 'full':
      return {
        headMultiplier: ONE,
        travelDurationMultiplier: ONE,
        travelStyle: 'travel',
        ambientAmplitudeMultiplier: ONE,
        ambientSpeedMultiplier: ONE,
        particles: true,
        lightFlicker: true,
        pointerTrail: true,
      };
    case 'gentle':
      return {
        headMultiplier: tuning.gentleHeadMultiplier,
        travelDurationMultiplier: tuning.gentleTravelMultiplier,
        travelStyle: 'travel',
        ambientAmplitudeMultiplier: tuning.gentleAmbientAmplitude,
        ambientSpeedMultiplier: tuning.gentleAmbientSpeed,
        particles: true,
        lightFlicker: true,
        pointerTrail: true,
      };
    case 'reduced':
      return {
        headMultiplier: ZERO,
        travelDurationMultiplier: null,
        travelStyle: 'fade',
        ambientAmplitudeMultiplier: tuning.reducedAmbientAmplitude,
        ambientSpeedMultiplier: tuning.reducedAmbientSpeed,
        particles: false,
        lightFlicker: false,
        pointerTrail: false,
      };
    default:
      throw new Error(`unknown motion level: ${String(level)}`);
  }
}

/**
 * The rank of a level by motion, used to find a change to less motion (Req 8.6). Internal to the
 * package: it is not on the entry point.
 */
export function motionRank(level: MotionLevel): MotionRank {
  const rank = MOTION_ORDER.indexOf(level);
  if (rank < ZERO) throw new Error(`unknown motion level: ${String(level)}`);
  return rank;
}
