// fast-check generators for the core property tests (design section 10.1). Test
// code only: reached by relative import, never exported from marrow/core. Generator
// ranges are test parameters, not tuning values (requirements Appendix B).
import fc from 'fast-check';
import type { ClockFlags } from './clocks';
import { TUNING } from './tuning';

/**
 * Raw frame deltas for the clocks (Req 16.2, 16.6): exactly 0 and -0, NaN and both
 * infinities, numbers from -maxClockStepMs to three times maxClockStepMs, and any
 * other number.
 */
export function genDt(): fc.Arbitrary<number> {
  const max = TUNING.maxClockStepMs;
  return fc.oneof(
    fc.constantFrom(0, -0, NaN, Infinity, -Infinity),
    fc.double({ min: -max, max: 3 * max, noNaN: true }),
    fc.double(),
  );
}

/** Deltas the clocks can return, for the reducers: 0..maxClockStepMs, both ends included. */
export function genDtClamped(): fc.Arbitrary<number> {
  const max = TUNING.maxClockStepMs;
  return fc.oneof(fc.constantFrom(0, max), fc.double({ min: 0, max, noNaN: true }));
}

/** The flags of one clock step, in every combination of paused, hidden and holdActive. */
export function genClockFlags(): fc.Arbitrary<ClockFlags> {
  return fc.record({ paused: fc.boolean(), hidden: fc.boolean(), holdActive: fc.boolean() });
}
