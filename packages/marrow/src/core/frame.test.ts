import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  isLandmarkValid,
  type Landmark,
  type PoseFrame,
  type PoseLandmarks,
  type Vec2,
} from './frame';
import { TUNING } from './tuning';

// The visibility threshold always comes from TUNING. The other numbers are the
// edges of camera space (0 and 1) and the nearest numbers past them, tested on
// purpose, and one position well inside the frame.

/** The threshold under test. */
const MIN = TUNING.minVisibility;
/** A visibility just below the threshold, by the machine epsilon. */
const JUST_BELOW_MIN = MIN - Number.EPSILON;
/** The largest number below 0. */
const JUST_BELOW_0 = -Number.MIN_VALUE;
/** The smallest number above 1. */
const JUST_ABOVE_1 = 1 + Number.EPSILON;
/** A position well inside the frame. */
const INSIDE: Vec2 = { x: 0.5, y: 0.5 };

/** INSIDE with one axis set to value. */
const withAxis = (axis: 'x' | 'y', value: number): Vec2 =>
  axis === 'x' ? { x: value, y: INSIDE.y } : { x: INSIDE.x, y: value };

describe('isLandmarkValid', () => {
  it('is valid at visibility exactly minVisibility', () => {
    expect(isLandmarkValid(MIN, INSIDE, TUNING)).toBe(true);
  });

  it('is invalid at a visibility just below minVisibility', () => {
    expect(JUST_BELOW_MIN).toBeLessThan(MIN);
    expect(isLandmarkValid(JUST_BELOW_MIN, INSIDE, TUNING)).toBe(false);
  });

  it('takes minVisibility from the tuning argument', () => {
    const lower = { ...TUNING, minVisibility: JUST_BELOW_MIN };
    expect(isLandmarkValid(JUST_BELOW_MIN, INSIDE, lower)).toBe(true);
  });

  it('is invalid when visibility is NaN', () => {
    expect(isLandmarkValid(NaN, INSIDE, TUNING)).toBe(false);
  });

  // Each edge case below also has visibility exactly at the threshold.
  for (const axis of ['x', 'y'] as const) {
    for (const edge of [0, 1]) {
      it(`is valid with ${axis} exactly ${edge}`, () => {
        expect(isLandmarkValid(MIN, withAxis(axis, edge), TUNING)).toBe(true);
      });
    }

    it(`is invalid with ${axis} just below 0`, () => {
      expect(JUST_BELOW_0).toBeLessThan(0);
      expect(isLandmarkValid(MIN, withAxis(axis, JUST_BELOW_0), TUNING)).toBe(false);
    });

    it(`is invalid with ${axis} just above 1`, () => {
      expect(JUST_ABOVE_1).toBeGreaterThan(1);
      expect(isLandmarkValid(MIN, withAxis(axis, JUST_ABOVE_1), TUNING)).toBe(false);
    });

    it(`is invalid when ${axis} is NaN`, () => {
      expect(isLandmarkValid(MIN, withAxis(axis, NaN), TUNING)).toBe(false);
    });
  }

  it('is valid at each corner of the frame', () => {
    for (const x of [0, 1]) {
      for (const y of [0, 1]) {
        expect(isLandmarkValid(MIN, { x, y }, TUNING)).toBe(true);
      }
    }
  });
});

describe('PoseFrame', () => {
  // Checked by the type checker (npm run typecheck). At runtime this test does nothing.
  it('holds t, aspect and five landmarks, each a position and a validity flag (Req 2.1, 2.2)', () => {
    expectTypeOf<keyof PoseFrame>().toEqualTypeOf<'t' | 'aspect' | 'landmarks'>();
    expectTypeOf<keyof PoseLandmarks>().toEqualTypeOf<
      'leftWrist' | 'rightWrist' | 'nose' | 'leftShoulder' | 'rightShoulder'
    >();
    expectTypeOf<Landmark>().toEqualTypeOf<{ readonly pos: Vec2; readonly valid: boolean }>();
  });
});
