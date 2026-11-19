import fc from 'fast-check';
import type { MotionLevel } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { motionProfile, motionRank, type MotionProfile } from './motion';
import { genLevel } from './testgen';
import { TUNING } from './tuning';

// The table of Req 8.2. Its values are the level values 1 and 0 (named here as the table gives them),
// the tuning keys, and the booleans of the table. "not used" is null.
const TABLE: Record<MotionLevel, MotionProfile> = {
  full: {
    headMultiplier: 1,
    travelDurationMultiplier: 1,
    travelStyle: 'travel',
    ambientAmplitudeMultiplier: 1,
    ambientSpeedMultiplier: 1,
    particles: true,
    lightFlicker: true,
    pointerTrail: true,
  },
  gentle: {
    headMultiplier: TUNING.gentleHeadMultiplier,
    travelDurationMultiplier: TUNING.gentleTravelMultiplier,
    travelStyle: 'travel',
    ambientAmplitudeMultiplier: TUNING.gentleAmbientAmplitude,
    ambientSpeedMultiplier: TUNING.gentleAmbientSpeed,
    particles: true,
    lightFlicker: true,
    pointerTrail: true,
  },
  reduced: {
    headMultiplier: 0,
    travelDurationMultiplier: null,
    travelStyle: 'fade',
    ambientAmplitudeMultiplier: TUNING.reducedAmbientAmplitude,
    ambientSpeedMultiplier: TUNING.reducedAmbientSpeed,
    particles: false,
    lightFlicker: false,
    pointerTrail: false,
  },
};

describe('motion profile equals the table for every level', () => {
  it('motion profile equals the table for every level', () => {
    for (const level of ['full', 'gentle', 'reduced'] as const) {
      expect(motionProfile(level)).toEqual(TABLE[level]);
    }
  });

  it('motion profile equals the table for every level: the head multiplier is in 0..1 at any level', () => {
    fc.assert(
      fc.property(genLevel(), (level) => {
        const profile = motionProfile(level);
        expect(profile.headMultiplier).toBeGreaterThanOrEqual(0);
        expect(profile.headMultiplier).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe('motionRank orders the levels by motion', () => {
  it('motionRank orders the levels by motion: reduced < gentle < full', () => {
    expect(motionRank('reduced')).toBeLessThan(motionRank('gentle'));
    expect(motionRank('gentle')).toBeLessThan(motionRank('full'));
  });
});
