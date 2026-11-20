import fc from 'fast-check';
import { TUNING as MARROW_TUNING } from 'marrow/core';
import type { MotionLevel } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { smootherstep } from './ease';
import { createTravel, startTravel, stepTravel, type TravelSegment, type TravelState } from './travel';
import {
  COVER_SLOPE_MAX,
  DISTANCE_FLOOR,
  TRAVEL_STEPS_MAX,
  genDeltaRun,
  genLevel,
  genSegment,
  genSpread,
  type TravelFrame,
} from './testgen';
import { TUNING } from './tuning';

// Test values. ZERO and ONE are the structural numbers; the rest are parameters of these tests.
const ZERO = 0;
const ONE = 1;
const HALF = 0.5;
const TWO = ONE + ONE;
const QUARTER = HALF * HALF;
/** The 10000-step cases use fewer runs and a 60 s limit, as marrow's slow tests do. */
const LONG_RUNS = 50;
const LONG_TIMEOUT_MS = 60000;
/** The constant-level blocks step by R / STEP_DIVISOR at most (Req 7.11: deltas up to R / 20). */
const STEP_DIVISOR = 20;
/** The unit blocks run on a segment from 0 to 1. */
const UNIT_FROM = ZERO;
const UNIT_TO = ONE;
/** h of design 4.3: the cover is 1 for |q - 0.5| <= h (the shipped values give 1/6). */
const PLATEAU_SHARE = MARROW_TUNING.maxClockStepMs / TUNING.minFadeMs;
/** The steps the short unit blocks use to reach arrival. */
const STEP_COUNT_SHORT = 4;
/** The progress of the example at which the cross-fade floor binds (Req 8.4). */
const NEAR_END = 0.9;

function segmentOf(durationMs: number): TravelSegment {
  return { from: UNIT_FROM, to: UNIT_TO, durationMs };
}

/** The sum of the unpaused deltas, in the order the travel adds them. */
function unpausedSum(frames: readonly TravelFrame[]): number {
  let sum = ZERO;
  for (const frame of frames) {
    if (!frame.paused && Number.isFinite(frame.dtMs) && frame.dtMs > ZERO) sum += frame.dtMs;
  }
  return sum;
}

/** Steps a travel at one constant delta until it arrives, and returns the states after each step. */
function runUntilArrival(state: TravelState, dtMs: number, motion: MotionLevel): TravelState[] {
  const states: TravelState[] = [];
  let current = state;
  for (let i = ZERO; i < TRAVEL_STEPS_MAX && current.phase !== 'arrived'; i++) {
    current = stepTravel(current, { dtMs, paused: false, motion }).state;
    states.push(current);
  }
  return states;
}

describe('travel arrives exactly once and never while paused', () => {
  it('travel arrives exactly once and never while paused', () => {
    fc.assert(
      fc.property(genSegment(), genLevel(), genDeltaRun(), (segment, level, frames) => {
        const started = startTravel(createTravel(segment), level);
        // R is read from the state of startTravel, not recomputed.
        const remaining = started.part!.remainingMs;
        let state: TravelState = started;
        let arrivals = ZERO;
        for (const frame of frames) {
          const step = stepTravel(state, { dtMs: frame.dtMs, paused: frame.paused, motion: level });
          for (const event of step.events) {
            expect(event.kind).toBe('arrived');
            // Req 7.10: no arrival in a paused step.
            expect(frame.paused).toBe(false);
            arrivals += ONE;
          }
          // Req 7.10: at most one arrival in the whole run.
          expect(arrivals).toBeLessThanOrEqual(ONE);
          state = step.state;
        }
        const sum = unpausedSum(frames);
        // Req 7.10: at or above R + tolerance there is exactly one arrival; below R - tolerance, none.
        // Between the two bounds the test asserts nothing.
        if (sum >= remaining + TUNING.arrivalToleranceMs) expect(arrivals).toBe(ONE);
        if (sum < remaining - TUNING.arrivalToleranceMs) expect(arrivals).toBe(ZERO);
      }),
      { numRuns: LONG_RUNS },
    );
  }, LONG_TIMEOUT_MS);

  it('travel arrives exactly once and never while paused: whole-millisecond deltas arrive exactly', () => {
    for (const durationMs of [TUNING.journeyMinMs, TUNING.journeyMaxMs, TUNING.doorMs]) {
      fc.assert(
        fc.property(fc.array(fc.integer({ min: ONE, max: MARROW_TUNING.maxClockStepMs }), { minLength: ONE }), (sizes) => {
          // Whole-millisecond deltas whose sum is exactly the duration: take the sizes until the sum is reached.
          const deltas: number[] = [];
          let total = ZERO;
          for (const size of sizes) {
            if (total >= durationMs) break;
            const delta = Math.min(size, durationMs - total);
            deltas.push(delta);
            total += delta;
          }
          if (total < durationMs) deltas.push(durationMs - total);

          let state = startTravel(createTravel(segmentOf(durationMs)), 'full');
          let elapsed = ZERO;
          let arrivedAt = -ONE;
          deltas.forEach((dtMs, i) => {
            const step = stepTravel(state, { dtMs, paused: false, motion: 'full' });
            elapsed += dtMs;
            if (elapsed < durationMs) {
              // Req 7.12: no arrival before the sum reaches the duration.
              expect(step.events).toEqual([]);
            } else if (arrivedAt < ZERO) {
              // Req 7.12: the step in which the sum first equals the duration reports arrival, with the distance exactly `to`.
              expect(step.events).toEqual([{ kind: 'arrived' }]);
              expect(step.travel).toBe(UNIT_TO);
              arrivedAt = i;
            } else {
              expect(step.events).toEqual([]);
            }
            state = step.state;
          });
          expect(arrivedAt).toBeGreaterThanOrEqual(ZERO);
        }),
      );
    }
  }, LONG_TIMEOUT_MS);
});

describe('travel constant level', () => {
  it('travel across motion level changes: constant Full and Gentle are monotone, in range and ease in and out (7.11)', () => {
    fc.assert(
      fc.property(genSegment(), fc.constantFrom<MotionLevel>('full', 'gentle'), genSpread(HALF, ONE), (segment, level, share) => {
        const started = startTravel(createTravel(segment), level);
        // A delta of up to R / 20 (Req 7.11).
        const dtMs = (started.part!.remainingMs / STEP_DIVISOR) * share;
        const states = runUntilArrival(started, dtMs, level);
        expect(states[states.length - ONE]!.phase).toBe('arrived');
        const steps = states.map((state) => ({ travel: state.distance, progress: state.p }));
        // Monotone and in range; arrival is exactly `to`.
        let previous = segment.from;
        for (const step of steps) {
          expect(step.travel).toBeGreaterThanOrEqual(previous);
          expect(step.travel).toBeGreaterThanOrEqual(segment.from);
          expect(step.travel).toBeLessThanOrEqual(segment.to);
          previous = step.travel;
        }
        expect(steps[steps.length - ONE]!.travel).toBe(segment.to);
        // Ease in and out: the first step and the last step before arrival move less than a step near p = 0.5.
        const last = steps.length - ONE;
        const moveAt = (i: number): number => steps[i]!.travel - (i === ZERO ? segment.from : steps[i - ONE]!.travel);
        const middle = Math.max(
          ...steps
            .map((step, i) => ({ move: moveAt(i), p: step.progress }))
            .filter(({ p }) => p >= HALF - QUARTER && p <= HALF + QUARTER)
            .map(({ move }) => move),
        );
        expect(moveAt(ZERO)).toBeLessThan(middle);
        expect(moveAt(last - ONE)).toBeLessThan(middle);
      }),
      { numRuns: LONG_RUNS },
    );
  }, LONG_TIMEOUT_MS);

  it('travel across motion level changes: constant Reduced holds from until the fade midpoint, then to', () => {
    fc.assert(
      fc.property(genSegment(), genSpread(HALF, ONE), (segment, share) => {
        const started = startTravel(createTravel(segment), 'reduced');
        const dtMs = (started.part!.remainingMs / STEP_DIVISOR) * share;
        const states = runUntilArrival(started, dtMs, 'reduced');
        for (const state of states) {
          // Only the two values: from before the midpoint of the fade, to from it.
          expect(state.distance === segment.from || state.distance === segment.to).toBe(true);
          if (state.p < HALF) expect(state.distance).toBe(segment.from);
          if (state.p >= HALF) expect(state.distance).toBe(segment.to);
        }
        expect(states[states.length - ONE]!.distance).toBe(segment.to);
      }),
      { numRuns: LONG_RUNS },
    );
  }, LONG_TIMEOUT_MS);
});

describe('travel unit rules', () => {
  it('travel unit rules: a delta of 0, negative, NaN or infinite moves nothing (7.8)', () => {
    const started = startTravel(createTravel(segmentOf(TUNING.journeyMinMs)), 'full');
    const moved = stepTravel(started, { dtMs: TUNING.journeyMinMs / 4, paused: false, motion: 'full' }).state;
    for (const dtMs of [ZERO, -ONE, Number.NaN, Number.POSITIVE_INFINITY]) {
      const step = stepTravel(moved, { dtMs, paused: false, motion: 'full' });
      expect(Object.is(step.progress, moved.p)).toBe(true);
      expect(Object.is(step.travel, moved.distance)).toBe(true);
      expect(step.events).toEqual([]);
    }
  });

  it('travel unit rules: a start request while travelling or arrived changes nothing (7.7)', () => {
    const travelling = startTravel(createTravel(segmentOf(TUNING.journeyMinMs)), 'full');
    expect(startTravel(travelling, 'gentle')).toBe(travelling);
    const arrived = stepTravel(travelling, { dtMs: TUNING.journeyMinMs, paused: false, motion: 'full' }).state;
    expect(arrived.phase).toBe('arrived');
    expect(startTravel(arrived, 'full')).toBe(arrived);
  });

  it('travel unit rules: a paused step changes nothing and emits no event (7.6)', () => {
    const started = startTravel(createTravel(segmentOf(TUNING.journeyMinMs)), 'full');
    const moved = stepTravel(started, { dtMs: TUNING.journeyMinMs / 4, paused: false, motion: 'full' }).state;
    const paused = stepTravel(moved, { dtMs: TUNING.journeyMinMs, paused: true, motion: 'full' });
    expect(Object.is(paused.progress, moved.p)).toBe(true);
    expect(paused.events).toEqual([]);
    expect(paused.travelling).toBe(true);
  });

  it('travel unit rules: travelling is true until arrival, and no event comes after it (7.9)', () => {
    const duration = TUNING.journeyMinMs;
    let state = startTravel(createTravel(segmentOf(duration)), 'full');
    const flags: boolean[] = [];
    let arrivals = ZERO;
    for (let i = ZERO; i < STEP_COUNT_SHORT; i++) {
      const step = stepTravel(state, { dtMs: duration / STEP_COUNT_SHORT, paused: false, motion: 'full' });
      flags.push(step.travelling);
      arrivals += step.events.length;
      state = step.state;
    }
    expect(flags.slice(0, flags.length - ONE).every((flag) => flag)).toBe(true);
    expect(flags[flags.length - ONE]).toBe(false);
    expect(arrivals).toBe(ONE);
  });

  it('travel unit rules: arrival sets p to 1 and the distance to `to` exactly, with one event (7.5)', () => {
    const started = startTravel(createTravel(segmentOf(TUNING.journeyMinMs)), 'full');
    // A sum a hair short of R still arrives (arrivalToleranceMs).
    const arrive = stepTravel(started, { dtMs: TUNING.journeyMinMs - TUNING.arrivalToleranceMs * HALF, paused: false, motion: 'full' });
    expect(arrive.events).toEqual([{ kind: 'arrived' }]);
    expect(arrive.progress).toBe(ONE);
    expect(arrive.travel).toBe(UNIT_TO);
    expect(arrive.cover).toBe(ZERO);
    // The stored state carries the same arrival values, so the next step sees them.
    expect(arrive.state.p).toBe(ONE);
    expect(arrive.state.distance).toBe(UNIT_TO);
    const after = stepTravel(arrive.state, { dtMs: TUNING.journeyMinMs, paused: false, motion: 'full' });
    expect(after.events).toEqual([]);
    expect(after.state).toBe(arrive.state);
  });

  it('travel unit rules: the distance starts exactly at from and follows the smootherstep of p (7.3, 7.4)', () => {
    const segment: TravelSegment = { from: HALF, to: UNIT_TO, durationMs: TUNING.journeyMinMs };
    const created = createTravel(segment);
    expect(created.distance).toBe(segment.from);
    const started = startTravel(created, 'full');
    expect(started.distance).toBe(segment.from);
    const step = stepTravel(started, { dtMs: TUNING.journeyMinMs / 4, paused: false, motion: 'full' });
    expect(step.progress).toBeCloseTo(QUARTER, 12);
    expect(step.travel).toBeCloseTo(segment.from + (segment.to - segment.from) * smootherstep(QUARTER), 12);
  });

  it('travel unit rules: a Gentle travel lasts the segment duration times gentleTravelMultiplier (8.3)', () => {
    const segment = segmentOf(TUNING.journeyMinMs);
    const gentle = startTravel(createTravel(segment), 'gentle');
    expect(gentle.part?.style).toBe('travel');
    expect(gentle.part?.remainingMs).toBe(segment.durationMs * TUNING.gentleTravelMultiplier);
  });

  it('travel unit rules: a fade rises to cover 1 at the switch and falls to 0 at arrival, and progress reaches 1 (8.4)', () => {
    const fadeLength = Math.max(TUNING.crossFadeMs, TUNING.minFadeMs);
    const started = startTravel(createTravel(segmentOf(TUNING.journeyMinMs)), 'reduced');
    expect(started.part?.remainingMs).toBe(fadeLength);
    const dtMs = fadeLength / STEP_COUNT_SHORT;
    const quarter = stepTravel(started, { dtMs, paused: false, motion: 'reduced' });
    expect(quarter.cover).toBeCloseTo(smootherstep(HALF / (ONE - 2 * PLATEAU_SHARE)), 12);
    expect(quarter.travel).toBe(UNIT_FROM);
    const half = stepTravel(quarter.state, { dtMs, paused: false, motion: 'reduced' });
    expect(half.cover).toBe(ONE);
    expect(half.travel).toBe(UNIT_TO);
    const threeQuarters = stepTravel(half.state, { dtMs, paused: false, motion: 'reduced' });
    expect(threeQuarters.cover).toBeCloseTo(smootherstep(HALF / (ONE - 2 * PLATEAU_SHARE)), 12);
    const end = stepTravel(threeQuarters.state, { dtMs, paused: false, motion: 'reduced' });
    expect(end.events).toEqual([{ kind: 'arrived' }]);
    expect(end.cover).toBe(ZERO);
    expect(end.progress).toBe(ONE);
  });

  it('travel unit rules: the cover is exactly 1 on the plateau |q - 0.5| <= h and falls outside it (8.4)', () => {
    const fadeLength = Math.max(TUNING.crossFadeMs, TUNING.minFadeMs);
    const started = startTravel(createTravel(segmentOf(TUNING.journeyMinMs)), 'reduced');
    // The first step with q >= 0.5 lies on the plateau: the switch is under full cover, by the formula.
    const onPlateau = stepTravel(started, { dtMs: fadeLength * (HALF + PLATEAU_SHARE / TWO), paused: false, motion: 'reduced' });
    expect(onPlateau.cover).toBe(ONE);
    expect(onPlateau.travel).toBe(UNIT_TO);
    // Past the plateau, at q = 0.5 + 1.5h, the cover is the smootherstep of 0.5 / (1 - 2h).
    const beyond = stepTravel(onPlateau.state, { dtMs: fadeLength * PLATEAU_SHARE, paused: false, motion: 'reduced' });
    expect(beyond.cover).toBeCloseTo(smootherstep(HALF / (ONE - 2 * PLATEAU_SHARE)), 12);
    expect(beyond.cover).toBeLessThan(ONE);
  });

  it('travel unit rules: a paused or bad-delta step returns the stored progress, distance and cover unchanged (7.6, 7.8)', () => {
    // The seed 774323422 regression: after the switch, a paused step must not move the cover.
    const fadeLength = Math.max(TUNING.crossFadeMs, TUNING.minFadeMs);
    const started = startTravel(createTravel(segmentOf(TUNING.journeyMinMs)), 'reduced');
    const switched = stepTravel(started, { dtMs: fadeLength * (HALF + PLATEAU_SHARE / TWO), paused: false, motion: 'reduced' }).state;
    for (const input of [
      { dtMs: TUNING.glideEpsilon, paused: true, motion: 'reduced' as const },
      { dtMs: ZERO, paused: false, motion: 'reduced' as const },
      { dtMs: -ONE, paused: false, motion: 'reduced' as const },
      { dtMs: Number.NaN, paused: false, motion: 'reduced' as const },
    ]) {
      const step = stepTravel(switched, input);
      expect(Object.is(step.cover, switched.cover)).toBe(true);
      expect(Object.is(step.progress, switched.p)).toBe(true);
      expect(Object.is(step.travel, switched.distance)).toBe(true);
      expect(step.state.cover).toBe(switched.cover);
      expect(step.travelling).toBe(true);
    }
  });

  it('travel unit rules: Full to Gentle at p keeps p and the distance, with remaining D * (1 - p) (8.6.1)', () => {
    const segment = segmentOf(TUNING.journeyMinMs);
    const moved = stepTravel(startTravel(createTravel(segment), 'full'), { dtMs: TUNING.journeyMinMs * QUARTER, paused: false, motion: 'full' }).state;
    const changed = stepTravel(moved, { dtMs: ZERO, paused: false, motion: 'gentle' });
    expect(changed.state.level).toBe('gentle');
    expect(changed.progress).toBe(moved.p);
    expect(changed.travel).toBe(moved.distance);
    expect(changed.state.part?.b).toBe(moved.p);
    expect(changed.state.part?.remainingMs).toBe(segment.durationMs * TUNING.gentleTravelMultiplier * (ONE - moved.p));
  });

  it('travel unit rules: a change to Reduced at p switches to a fade with b = p, d0 = distance and X = max(crossFadeMs * (1 - p), minFadeMs) (8.6.2)', () => {
    const moved = stepTravel(startTravel(createTravel(segmentOf(TUNING.journeyMinMs)), 'full'), {
      dtMs: TUNING.journeyMinMs * QUARTER,
      paused: false,
      motion: 'full',
    }).state;
    const switched = stepTravel(moved, { dtMs: ZERO, paused: false, motion: 'reduced' });
    const part = switched.state.part;
    expect(part?.style).toBe('fade');
    expect(part?.b).toBe(moved.p);
    if (part?.style === 'fade') {
      expect(part.d0).toBe(moved.distance);
      expect(part.remainingMs).toBe(Math.max(TUNING.crossFadeMs * (ONE - moved.p), TUNING.minFadeMs));
      expect(part.switched).toBe(false);
    }
    expect(switched.cover).toBe(ZERO);
  });

  it('travel unit rules: a change to more motion leaves the running travel unchanged (8.6.3)', () => {
    const gentle = stepTravel(startTravel(createTravel(segmentOf(TUNING.journeyMinMs)), 'gentle'), {
      dtMs: TUNING.journeyMinMs / 4,
      paused: false,
      motion: 'gentle',
    }).state;
    const toFull = stepTravel(gentle, { dtMs: ZERO, paused: false, motion: 'full' });
    expect(toFull.state).toEqual(gentle);
    const reduced = stepTravel(gentle, { dtMs: ZERO, paused: false, motion: 'reduced' }).state;
    const back = stepTravel(reduced, { dtMs: ZERO, paused: false, motion: 'full' });
    expect(back.state.level).toBe('reduced');
    expect(back.state).toEqual(reduced);
  });

  it('travel unit rules: Gentle to Full to Gentle changes nothing (8.6.3)', () => {
    const start = startTravel(createTravel(segmentOf(TUNING.journeyMinMs)), 'gentle');
    const dts = [TUNING.journeyMinMs / 8, TUNING.journeyMinMs / 8, TUNING.journeyMinMs / 8];
    let withChanges = start;
    dts.forEach((dtMs, i) => {
      const motion: MotionLevel = i === ONE ? 'full' : 'gentle';
      withChanges = stepTravel(withChanges, { dtMs, paused: false, motion }).state;
    });
    let plain = start;
    for (const dtMs of dts) plain = stepTravel(plain, { dtMs, paused: false, motion: 'gentle' }).state;
    expect(withChanges).toEqual(plain);
  });

  it('travel unit rules: a change while idle only decides the next travel (8.6.4)', () => {
    const idle = createTravel(segmentOf(TUNING.journeyMinMs));
    const step = stepTravel(idle, { dtMs: TUNING.journeyMinMs, paused: false, motion: 'reduced' });
    expect(step.state).toBe(idle);
    expect(step.travelling).toBe(false);
    expect(startTravel(idle, 'reduced').part?.style).toBe('fade');
    expect(startTravel(idle, 'full').part?.style).toBe('travel');
  });

  it('travel unit rules: the cross-fade floor binds for a switch at p = 0.9 (8.4)', () => {
    const segment = segmentOf(TUNING.journeyMinMs);
    const nearEnd = stepTravel(startTravel(createTravel(segment), 'full'), {
      dtMs: TUNING.journeyMinMs * NEAR_END,
      paused: false,
      motion: 'full',
    }).state;
    expect(nearEnd.p).toBeCloseTo(NEAR_END, 9);
    const switched = stepTravel(nearEnd, { dtMs: ZERO, paused: false, motion: 'reduced' });
    const part = switched.state.part;
    // crossFadeMs * (1 - 0.9) is 150 ms, so the floor gives minFadeMs.
    expect(TUNING.crossFadeMs * (ONE - nearEnd.p)).toBeLessThan(TUNING.minFadeMs);
    expect(part?.remainingMs).toBe(TUNING.minFadeMs);
    // The cover changes by at most COVER_SLOPE_MAX * dt / X per step, with X = minFadeMs.
    const dtMs = TUNING.minFadeMs / STEP_COUNT_SHORT;
    let state = switched.state;
    let previousCover = switched.cover;
    for (let i = ZERO; i < TRAVEL_STEPS_MAX && state.phase !== 'arrived'; i++) {
      const step = stepTravel(state, { dtMs, paused: false, motion: 'reduced' });
      expect(Math.abs(step.cover - previousCover)).toBeLessThanOrEqual((COVER_SLOPE_MAX * dtMs) / TUNING.minFadeMs + DISTANCE_FLOOR);
      previousCover = step.cover;
      state = step.state;
    }
  });
});
