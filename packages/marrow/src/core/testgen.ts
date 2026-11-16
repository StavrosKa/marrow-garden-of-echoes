// fast-check generators for the core property tests (design section 10.1). Test
// code only: reached by relative import, never exported from marrow/core. Generator
// ranges are test parameters, not tuning values (requirements Appendix B).
import fc from 'fast-check';
import type { ClockFlags } from './clocks';
import type { Landmark, Vec2 } from './frame';
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

/** One consumed frame of one wrist: its sample and the presence time since the previous frame. */
export interface PointerPathStep extends Landmark {
  /** Presence time since the previous consumed frame, in milliseconds (Req 8.2). */
  readonly dtMs: number;
}

/** The longest gap genPointerPath makes, in milliseconds of presence time (design section 10.1). */
export const GAP_MAX_MS = 2000;

/** A camera-space coordinate, 0..1 with both edges: where a valid landmark lies (Req 2.5). */
function genUnit(): fc.Arbitrary<number> {
  return fc.oneof(fc.constantFrom(0, 1), fc.double({ min: 0, max: 1, noNaN: true }));
}

/** Any position at all, NaN and infinities included: what an invalid landmark may carry. */
function genAnyPos(): fc.Arbitrary<Vec2> {
  return fc.record({ x: fc.double(), y: fc.double() });
}

/** One to ten valid samples in camera space, each with a delta from genDtClamped. */
function genValidRun(): fc.Arbitrary<PointerPathStep[]> {
  const step = fc
    .record({ dtMs: genDtClamped(), pos: fc.record({ x: genUnit(), y: genUnit() }) })
    .map(({ dtMs, pos }) => ({ dtMs, pos, valid: true }));
  return fc.array(step, { minLength: 1, maxLength: 10 });
}

/**
 * The first parts, in order, while their sum stays within durationMs, then steps of
 * `step` and a remainder up to durationMs. Never empty: a gap has at least one sample.
 */
function splitDuration(durationMs: number, parts: readonly number[], step: number): number[] {
  const deltas: number[] = [];
  let sum = 0;
  for (const part of parts) {
    if (sum + part > durationMs) break;
    deltas.push(part);
    sum += part;
  }
  while (sum < durationMs) {
    const part = Math.min(step, durationMs - sum);
    deltas.push(part);
    sum += part;
  }
  return deltas.length > 0 ? deltas : [0];
}

/**
 * One gap: invalid samples at any position. Their deltas are whole milliseconds, so
 * their sum, the gap's duration, is exact: exactly 0, exactly GAP_MAX_MS, or a whole
 * number in between.
 */
function genGap(): fc.Arbitrary<PointerPathStep[]> {
  const step = Math.floor(TUNING.maxClockStepMs);
  const duration = fc.oneof(
    fc.constantFrom(0, GAP_MAX_MS),
    fc.integer({ min: 0, max: GAP_MAX_MS }),
  );
  const parts = fc.array(fc.integer({ min: 0, max: step }), { maxLength: 30 });
  return fc.tuple(duration, parts).chain(([durationMs, chosen]) =>
    fc.tuple(
      ...splitDuration(durationMs, chosen, step).map((dtMs) =>
        genAnyPos().map((pos) => ({ dtMs, pos, valid: false })),
      ),
    ),
  );
}

/**
 * One wrist's samples over consecutive consumed frames (Req 8): runs of valid
 * samples in camera space, separated by gaps of invalid samples. A gap's duration is
 * the sum of the deltas of its invalid samples, 0..GAP_MAX_MS, and two gaps are never
 * next to each other. Every delta is in 0..maxClockStepMs, and 0 is common. A path
 * may start with a gap and may end with one.
 */
export function genPointerPath(): fc.Arbitrary<PointerPathStep[]> {
  return fc
    .record({
      lead: fc.option(genGap(), { nil: undefined }),
      body: fc.array(fc.tuple(genValidRun(), genGap()), { minLength: 1, maxLength: 5 }),
      tail: fc.option(genValidRun(), { nil: undefined }),
    })
    .map(({ lead, body, tail }) => [...(lead ?? []), ...body.flat(2), ...(tail ?? [])]);
}
