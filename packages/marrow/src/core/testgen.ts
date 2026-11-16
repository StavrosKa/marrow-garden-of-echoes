// fast-check generators for the core property tests (design section 10.1). Test
// code only: reached by relative import, never exported from marrow/core. Generator
// ranges are test parameters, not tuning values (requirements Appendix B).
import fc from 'fast-check';
import type { ClockFlags } from './clocks';
import type { Landmark, Vec2 } from './frame';
import type { MappingParams } from './mapping';
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

/**
 * The range of the play aspect A and of the frame aspect a in the mapping properties
 * (Req 10.3, 14.8). Test parameters, not tuning values (requirements Appendix B).
 */
export const ASPECT_MIN = 1.0;
export const ASPECT_MAX = 2.4;

/**
 * How far outside its space a point from genVec2Camera or genVec2Screen can lie, on
 * each axis. With 1, camera points lie in -1..2 on both axes, and screen points in
 * -1..A + 1 on x and -1..2 on y. A test parameter, not a tuning value. It is finite,
 * so no point holds NaN or an infinity.
 */
export const OUTSIDE_MARGIN = 1;

/** Camera space is 0..1 on each axis, and screen space is 0..1 on y (glossary). Geometry, not a tuning value. */
const UNIT_EXTENT = 1;

/** A number in lo..hi, with lo and hi themselves drawn often. */
function genClosed(lo: number, hi: number): fc.Arbitrary<number> {
  return fc.oneof(fc.constantFrom(lo, hi), fc.double({ min: lo, max: hi, noNaN: true }));
}

/**
 * A coordinate on an axis of a space that spans 0..extent: inside it, with both edges
 * drawn often, or anywhere from OUTSIDE_MARGIN below it to OUTSIDE_MARGIN above it.
 */
function genAxis(extent: number): fc.Arbitrary<number> {
  return fc.oneof(
    genClosed(0, extent),
    fc.double({ min: -OUTSIDE_MARGIN, max: extent + OUTSIDE_MARGIN, noNaN: true }),
  );
}

/**
 * Mapping parameters (Req 10.3, 14.8): A and a in ASPECT_MIN..ASPECT_MAX, the gain in
 * reachGainMin..reachGainMax, and the centre inside the play area [0, A] x [0, 1].
 * Every range includes its ends, and the ends are drawn often. In some samples a
 * equals A exactly, so A > a, A < a and A = a all occur.
 */
export function genMappingParams(): fc.Arbitrary<MappingParams> {
  const aspect = genClosed(ASPECT_MIN, ASPECT_MAX);
  return fc
    .record({
      playAspect: aspect,
      // undefined stands for a frame aspect equal to the play aspect.
      frameAspect: fc.option(aspect, { nil: undefined }),
      gain: genClosed(TUNING.reachGainMin, TUNING.reachGainMax),
      // The centre as fractions of the play area's width and height. A fraction of
      // exactly 1 gives exactly A, and no fraction gives more than A.
      centre: fc.record({ x: genUnit(), y: genUnit() }),
    })
    .map(({ playAspect, frameAspect, gain, centre }) => ({
      playAspect,
      frameAspect: frameAspect ?? playAspect,
      gain,
      centre: { x: centre.x * playAspect, y: centre.y },
    }));
}

/**
 * A camera-space point (Req 10.3). Each coordinate lies in the frame, 0..1 with both
 * edges, or outside it within OUTSIDE_MARGIN. So points occur inside the frame,
 * outside it on one axis, and outside it on both. Never NaN or infinite.
 */
export function genVec2Camera(): fc.Arbitrary<Vec2> {
  return fc.record({ x: genAxis(UNIT_EXTENT), y: genAxis(UNIT_EXTENT) });
}

/**
 * A screen-space point for the play aspect A (Req 10.3). Each coordinate lies in the
 * play area [0, A] x [0, 1], with every edge, or outside it within OUTSIDE_MARGIN.
 * Never NaN or infinite.
 */
export function genVec2Screen(playAspect: number): fc.Arbitrary<Vec2> {
  return fc.record({ x: genAxis(playAspect), y: genAxis(UNIT_EXTENT) });
}
