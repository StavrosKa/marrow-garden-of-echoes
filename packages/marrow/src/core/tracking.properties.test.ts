import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { presenceDelta, sessionDelta } from './clocks';
import { createDwell, stepDwell, type DwellState, type HitArea, type PointerInput } from './dwell';
import { genTrackingRun, type TrackingRunCase, type TrackingStepCase } from './testgen';
import { createTracking, stepTracking, type TrackingStep } from './tracking';
import { TUNING } from './tuning';

// The properties of Req 18.12 - 18.14 (steering section 10, invariant 5). Each composes the functions
// the way the driver does (design section 3): presenceDelta first, then stepTracking on the presence
// delta, then sessionDelta from the hold of the same step. The oracles are written here from the
// inputs: continuous lost time and continuous valid time are summed from the presence deltas and the
// validity of the active wrists, and nothing is read from the reducer but its outputs. Problems are
// collected and checked once per run, because an expect call for every step is too slow.

const RUNS = 300;
/** How many problems of a failing run are shown. A test parameter. */
const SHOWN = 5;

/** One step of a run as the driver computes it. */
interface Driven {
  readonly step: TrackingStepCase;
  readonly presenceDt: number;
  readonly sessionDt: number;
  readonly result: TrackingStep;
}

/** Runs the steps through presenceDelta, stepTracking and sessionDelta. `nose` can replace the drawn nose by an always valid one. */
function drive(run: TrackingRunCase, nose: 'as drawn' | 'always valid'): Driven[] {
  let state = createTracking({ activeWrists: run.activeWrists, mode: 'camera', tuning: TUNING });
  return run.steps.map((step) => {
    const presenceDt = presenceDelta(step.rawDt, { paused: step.paused, hidden: step.hidden }, TUNING);
    const result = stepTracking(
      state,
      { wristValid: step.wristValid, noseValid: nose === 'always valid' ? true : step.noseValid, calibrating: false },
      presenceDt,
    );
    state = result.state;
    return { step, presenceDt, sessionDt: sessionDelta(presenceDt, result.holdActive), result };
  });
}

/**
 * What a step outputs, as text: the three flags, the events, the timers and the hint wrist of the
 * new state (not its configuration, which holds the whole tuning object), and both deltas.
 */
function outputKey(d: Driven): string {
  const { holdActive, overlayVisible, oneWristHint, events } = d.result;
  const { lostMs, validMs, invalidMs, hintWrist } = d.result.state;
  return JSON.stringify([holdActive, overlayVisible, oneWristHint, events, lostMs, validMs, invalidMs, hintWrist, d.presenceDt, d.sessionDt]);
}

/** Whether an active wrist is valid in the step. A wrist that is not active is never looked at. */
const anyActiveValid = (run: TrackingRunCase, step: TrackingStepCase): boolean => run.activeWrists.some((w) => step.wristValid[w]);

/** A fixed target, held by whichever active wrist is valid, so that the dwell state shows what the pointers did. */
const AREA: HitArea = { targetId: 't0', activationId: 'a0', centre: { x: 0.5, y: 0.5 }, radius: TUNING.hitRadius };

/** The dwell states of a driven run: a pointer for each active wrist, at the centre of the target while valid, on the presence delta. */
function dwellStates(run: TrackingRunCase, driven: readonly Driven[]): { states: DwellState[]; events: string[] } {
  let state = createDwell(TUNING);
  const states: DwellState[] = [];
  const events: string[] = [];
  driven.forEach(({ step, presenceDt }, i) => {
    const pointers: PointerInput[] = run.activeWrists.map((wrist) =>
      step.wristValid[wrist] ? { wrist, valid: true, pos: AREA.centre } : { wrist, valid: false },
    );
    const result = stepDwell(state, { dt: presenceDt, pointers, hitAreas: [AREA] });
    state = result.state;
    states.push(state);
    for (const e of result.events) events.push(`${i}:${e.targetId}:${e.wrist}`);
  });
  return { states, events };
}

describe('tracking properties (Req 18.12 - 18.14)', () => {
  // tracking_head_only_loss_harmless (Req 18.12): when at least one active wrist is valid in every step,
  // whatever the nose does, no hold begins, the session delta equals the presence delta in every step, and
  // the Dwell Engine's state is the same as for the same sequence with the nose always valid. The tracking
  // outputs themselves are the same too, step by step, with the nose drawn and with it always valid. The
  // dwell engine runs on the presence delta and on the pointers of the active wrists, as the driver does.
  it('tracking_head_only_loss_harmless', () => {
    fc.assert(
      fc.property(genTrackingRun(true), (run) => {
        const problems: string[] = [];
        const drawn = drive(run, 'as drawn');
        const steady = drive(run, 'always valid');
        const a = dwellStates(run, drawn);
        const b = dwellStates(run, steady);
        drawn.forEach((d, i) => {
          const other = steady[i];
          if (!anyActiveValid(run, d.step)) problems.push(`step ${i}: the run has a step without a valid active wrist`);
          if (d.result.holdActive || d.result.overlayVisible) problems.push(`step ${i}: a hold or an overlay with a valid wrist`);
          if (d.sessionDt !== d.presenceDt) problems.push(`step ${i}: session delta ${d.sessionDt}, presence delta ${d.presenceDt}`);
          if (other === undefined || outputKey(d) !== outputKey(other)) problems.push(`step ${i}: the outputs depend on the nose`);
        });
        expect(problems.slice(0, SHOWN)).toEqual([]);
        // Equal, not merely close: the same numbers and the same events, step by step.
        expect(a.states).toStrictEqual(b.states);
        expect(a.events).toStrictEqual(b.events);
      }),
      { numRuns: RUNS },
    );
    // About a second alone; the limit is generous because the whole suite runs in parallel.
  }, 60_000);

  // tracking_hold_timing_and_session_clock (Req 18.13): outside calibration and simulated input, the session
  // clock advances by the full clamped delta in every step that is not paused, not hidden and not in a hold,
  // does not advance in any step in a hold, and a hold begins in the first step in which continuous lost time
  // exceeds trackingHoldAfterMs and in no earlier step. Continuous lost time is summed here from the presence
  // deltas of the steps with no valid active wrist, and reset by any step with one; a hold that is already on
  // is left to Req 18.14.
  it('tracking_hold_timing_and_session_clock', () => {
    fc.assert(
      fc.property(genTrackingRun(false), (run) => {
        const problems: string[] = [];
        let lostMs = 0;
        let holdBefore = false;
        drive(run, 'as drawn').forEach(({ step, presenceDt, sessionDt, result }, i) => {
          lostMs = anyActiveValid(run, step) ? 0 : lostMs + presenceDt;
          const paused = step.paused || step.hidden;
          // rawDt is within 0..maxClockStepMs, so the clamped delta is rawDt itself.
          if (presenceDt !== (paused ? 0 : step.rawDt)) problems.push(`step ${i}: presence delta ${presenceDt} for ${step.rawDt}`);
          if (!holdBefore && result.holdActive !== lostMs > TUNING.trackingHoldAfterMs) {
            problems.push(`step ${i}: lost time ${lostMs}, hold ${result.holdActive}`);
          }
          if (result.holdActive && sessionDt !== 0) problems.push(`step ${i}: the session clock advanced by ${sessionDt} in a hold`);
          if (!result.holdActive && !paused && sessionDt !== step.rawDt) {
            problems.push(`step ${i}: the session clock advanced by ${sessionDt}, not the full ${step.rawDt}`);
          }
          if (paused && sessionDt !== 0) problems.push(`step ${i}: the session clock advanced while paused or hidden`);
          holdBefore = result.holdActive;
        });
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  // tracking_resume_needs_full_second (Req 18.14): a hold ends only in a step in which continuous valid time
  // reaches trackingResumeMs, and valid stretches shorter than that, however many, never end it. The oracle
  // sums the presence deltas of the steps with a valid active wrist while a hold is on, and resets the sum in
  // any step without one: the hold ends in exactly the steps in which the sum is at least trackingResumeMs
  // (Req 18.6), and the overlay goes with it.
  it('tracking_resume_needs_full_second', () => {
    fc.assert(
      fc.property(genTrackingRun(false), (run) => {
        const problems: string[] = [];
        let validMs = 0;
        let holdBefore = false;
        drive(run, 'as drawn').forEach(({ step, presenceDt, result }, i) => {
          if (holdBefore) {
            validMs = anyActiveValid(run, step) ? validMs + presenceDt : 0;
            const ends = !result.holdActive;
            if (ends !== validMs >= TUNING.trackingResumeMs) problems.push(`step ${i}: valid time ${validMs}, hold ends ${ends}`);
            if (ends && result.overlayVisible) problems.push(`step ${i}: the overlay stays after the hold`);
          }
          if (!result.holdActive) validMs = 0;
          holdBefore = result.holdActive;
        });
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });
});
