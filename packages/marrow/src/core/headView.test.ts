import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { NeutralHead } from './calibration';
import type { Landmark, PoseLandmarks, Vec2 } from './frame';
import { createHeadView, headDistance, headRaw, stepHeadView, type HeadViewInput, type HeadViewState } from './headView';
import * as core from './index';
import { ASPECT_MAX, ASPECT_MIN, genHeadFrames, genSpread, headCaseLandmarks } from './testgen';
import { TUNING, type Tuning } from './tuning';

// Every threshold comes from TUNING or from the tuning in the input. The scripts step the
// presence clock by STEP, the largest delta the Clocks return, and the rest are named
// test parameters.

/** The presence delta of each scripted step: the largest the Clocks return (maxClockStepMs). */
const STEP = TUNING.maxClockStepMs;
const HALF = 1 / 2;
/** The neutral shoulder width of the examples, in aspect-corrected units. A test parameter. */
const WIDTH = 0.2;
/** The frame aspect of the examples. A test parameter. */
const ASPECT = 4 / 3;
/** The play aspect of the simulated-input examples. A test parameter. */
const PLAY_ASPECT = 16 / 9;
/** An absolute tolerance for comparisons of two ways of computing the same real number. A test parameter. */
const TOLERANCE = 1e-12;
/** Off the middle of the frame on both axes, so that mirroring the neutral nose as well as the nose matters. A test parameter. */
const NEUTRAL: NeutralHead = { nose: { x: 0.4, y: 0.45 }, shoulderWidth: WIDTH };
/** A head offset far beyond the clamp on both axes, the second one negative: raw is (1, -1). */
const FAR: Vec2 = { x: 2 * TUNING.headClamp, y: -2 * TUNING.headClamp };
/** The offset halfway between the dead zone and the clamp: raw is 0.5. */
const MIDDLE_OFFSET = (TUNING.headDeadZone + TUNING.headClamp) / 2;

/** The number of whole steps in a duration from TUNING, checking that it is whole. */
function stepsIn(durationMs: number): number {
  const steps = durationMs / STEP;
  expect(Number.isInteger(steps), `${durationMs} ms is a whole number of steps of ${STEP} ms`).toBe(true);
  return steps;
}

const lm = (x: number, y: number, valid = true): Landmark => ({ pos: { x, y }, valid });

/** Landmarks with the nose at the offset d from NEUTRAL (the inverse of the head's distance), and fixed shoulders and wrists. */
function landmarksFor(d: Vec2, noseValid = true, aspect = ASPECT): PoseLandmarks {
  return {
    nose: lm(NEUTRAL.nose.x - (d.x * WIDTH) / aspect, NEUTRAL.nose.y + d.y * WIDTH, noseValid),
    leftShoulder: lm(0.7, 0.8),
    rightShoulder: lm(0.3, 0.8),
    leftWrist: lm(HALF, HALF),
    rightWrist: lm(HALF, HALF),
  };
}

interface CameraOptions {
  readonly noseValid?: boolean;
  readonly aspect?: number;
  readonly skip?: boolean;
  readonly neutral?: NeutralHead | null;
  readonly tuning?: Tuning;
  readonly landmarks?: PoseLandmarks;
}

function camera(d: Vec2, options: CameraOptions = {}): HeadViewInput {
  const aspect = options.aspect ?? ASPECT;
  return {
    mode: 'camera',
    tuning: options.tuning ?? TUNING,
    landmarks: options.landmarks ?? landmarksFor(d, options.noseValid ?? true, aspect),
    frameAspect: aspect,
    neutral: options.neutral === undefined ? NEUTRAL : options.neutral,
    skip: options.skip ?? false,
  };
}

/** A camera-mode step with the nose lost. */
const lost = (options: CameraOptions = {}): HeadViewInput => camera({ x: 0, y: 0 }, { ...options, noseValid: false });

function simulated(pos: Vec2, valid = true, landmarks?: PoseLandmarks, tuning: Tuning = TUNING): HeadViewInput {
  return {
    mode: 'simulated',
    tuning,
    landmarks: landmarks ?? landmarksFor({ x: 0, y: 0 }),
    frameAspect: ASPECT,
    neutral: NEUTRAL,
    skip: false,
    pointer: { valid, pos },
    playAspect: PLAY_ASPECT,
  };
}

/** Steps from a state with the same input and delta, returning the final state and every offset. */
function run(start: HeadViewState, input: HeadViewInput, count: number, dtMs = STEP) {
  let state = start;
  const offsets: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const step = stepHeadView(state, input, dtMs);
    state = step.state;
    offsets.push(step.offset);
  }
  return { state, offsets };
}

/** A state with a nonzero output on both axes, the second one negative, reached by smoothing towards FAR. */
function warmed(): HeadViewState {
  const { state } = run(createHeadView(), camera(FAR), 6);
  expect(state.out.x).toBeGreaterThan(0);
  expect(state.out.y).toBeLessThan(0);
  return state;
}

describe('headRaw (Req 9.3, 9.5)', () => {
  const { headDeadZone: dz, headClamp: clampAt } = TUNING;

  it('is 0 up to and including the dead zone, never -0', () => {
    for (const d of [0, -0, dz / 2, -dz / 2, dz, -dz, NaN]) expect(Object.is(headRaw(d, TUNING), 0)).toBe(true);
  });

  it('is exactly +1 and -1 from the clamp on, and rises linearly in between', () => {
    for (const d of [clampAt, 2 * clampAt, Infinity]) {
      expect(headRaw(d, TUNING)).toBe(1);
      expect(headRaw(-d, TUNING)).toBe(-1);
    }
    expect(headRaw(MIDDLE_OFFSET, TUNING)).toBeCloseTo(0.5, 12);
    expect(headRaw(-MIDDLE_OFFSET, TUNING)).toBeCloseTo(-0.5, 12);
    const next = dz + (clampAt - dz) / 4;
    expect(headRaw(next, TUNING)).toBeCloseTo(0.25, 12);
  });

  it('reads the dead zone and the clamp from the tuning argument', () => {
    const wider: Tuning = { ...TUNING, headDeadZone: dz * 2 };
    expect(headRaw(dz * 1.5, TUNING)).toBeGreaterThan(0);
    expect(headRaw(dz * 1.5, wider)).toBe(0);
    const further: Tuning = { ...TUNING, headClamp: clampAt * 2 };
    expect(headRaw(clampAt, TUNING)).toBe(1);
    expect(headRaw(clampAt, further)).toBeLessThan(1);
  });
});

describe('headDistance (Req 9.2, design section 13 question 4)', () => {
  it('mirrors x once, so a head moving to the right of the screen gives d.x > 0, and lets y grow downwards', () => {
    const shift = 0.05;
    // In the unmirrored camera image a head moving to the screen's right has a smaller x.
    const right = headDistance({ x: NEUTRAL.nose.x - shift, y: NEUTRAL.nose.y }, NEUTRAL, ASPECT);
    expect(right.x).toBeGreaterThan(0);
    expect(right.y).toBe(0);
    const left = headDistance({ x: NEUTRAL.nose.x + shift, y: NEUTRAL.nose.y }, NEUTRAL, ASPECT);
    expect(left.x).toBe(-right.x);
    const down = headDistance({ x: NEUTRAL.nose.x, y: NEUTRAL.nose.y + shift }, NEUTRAL, ASPECT);
    expect(down.y).toBeGreaterThan(0);
    expect(down.x).toBe(0);
  });

  it('corrects x for the aspect and divides both axes by the neutral shoulder width, y without the aspect', () => {
    const shift = 0.05;
    const p: Vec2 = { x: NEUTRAL.nose.x - shift, y: NEUTRAL.nose.y + shift };
    const d = headDistance(p, NEUTRAL, ASPECT);
    expect(d.x).toBeCloseTo((shift * ASPECT) / WIDTH, 12);
    expect(d.y).toBeCloseTo(shift / WIDTH, 12);
    const wide: NeutralHead = { ...NEUTRAL, shoulderWidth: 2 * WIDTH };
    expect(headDistance(p, wide, ASPECT).x).toBeCloseTo(d.x / 2, 12);
    expect(headDistance(p, wide, 2 * ASPECT).x).toBeCloseTo(d.x, 12);
  });
});

describe('stepHeadView, camera mode, nose valid (Req 9.2-9.4)', () => {
  it('starts at (0, 0) and smooths towards raw with the weight 1 - exp(-dt / headSmoothingTauMs)', () => {
    expect(createHeadView().out).toEqual({ x: 0, y: 0 });
    const d: Vec2 = { x: MIDDLE_OFFSET, y: -MIDDLE_OFFSET };
    const raw = { x: headRaw(d.x, TUNING), y: headRaw(d.y, TUNING) };
    let want = { x: 0, y: 0 };
    let state = createHeadView();
    for (const dt of [STEP, STEP / 2, STEP, 7]) {
      const weight = 1 - Math.exp(-dt / TUNING.headSmoothingTauMs);
      want = { x: want.x + (raw.x - want.x) * weight, y: want.y + (raw.y - want.y) * weight };
      const step = stepHeadView(state, camera(d), dt);
      state = step.state;
      expect(step.offset.x).toBeCloseTo(want.x, 12);
      expect(step.offset.y).toBeCloseTo(want.y, 12);
      expect(step.state.out).toBe(step.offset);
    }
  });

  it('reads the smoothing time constant, the dead zone and the clamp from the tuning in the input', () => {
    const d: Vec2 = { x: MIDDLE_OFFSET, y: 0 };
    const slower: Tuning = { ...TUNING, headSmoothingTauMs: TUNING.headSmoothingTauMs * 2 };
    const a = stepHeadView(createHeadView(), camera(d), STEP).offset.x;
    const b = stepHeadView(createHeadView(), camera(d, { tuning: slower }), STEP).offset.x;
    expect(b).toBeLessThan(a);
    const wider: Tuning = { ...TUNING, headDeadZone: TUNING.headDeadZone * 3 };
    expect(stepHeadView(createHeadView(), camera({ x: 2 * TUNING.headDeadZone, y: 0 }, { tuning: wider }), STEP).offset.x).toBe(0);
  });

  it('a delta of 0 changes nothing, and a delta larger than maxClockStepMs is used as given (not clamped again)', () => {
    const state = warmed();
    const zero = stepHeadView(state, camera({ x: 0, y: 0 }), 0);
    expect(zero.offset).toStrictEqual(state.out);
    expect(zero.state).toStrictEqual(state);
    const far = stepHeadView(createHeadView(), camera(FAR), 100 * STEP);
    expect(far.offset).toStrictEqual({ x: 1, y: -1 });
    // And one delta of headEaseToCentreMs, five times maxClockStepMs, ends a ramp in one step.
    const ended = stepHeadView(state, lost(), TUNING.headEaseToCentreMs);
    expect(ended.offset).toStrictEqual({ x: 0, y: 0 });
  });

  it('skip, or no neutral data, gives exactly (0, 0) and forgets the output', () => {
    const state = warmed();
    for (const options of [{ skip: true }, { neutral: null }]) {
      const step = stepHeadView(state, camera(FAR, options), STEP);
      expect(step.offset).toStrictEqual({ x: 0, y: 0 });
      expect(step.state).toStrictEqual(createHeadView());
      // The next step without skip starts smoothing from 0, not from the old output.
      const after = stepHeadView(step.state, camera(FAR), STEP);
      expect(after.offset).toStrictEqual(stepHeadView(createHeadView(), camera(FAR), STEP).offset);
    }
    // A lost nose under skip is still (0, 0).
    expect(stepHeadView(state, lost({ skip: true }), STEP).offset).toStrictEqual({ x: 0, y: 0 });
  });

  it('never reads the shoulders: moving, invalidating or corrupting them changes no output and no state (Req 9.1, 9.10)', () => {
    const base = camera({ x: MIDDLE_OFFSET, y: -MIDDLE_OFFSET });
    const shoulders: [Landmark, Landmark][] = [
      [lm(0.1, 0.1), lm(0.9, 0.9)],
      [lm(0.7, 0.8, false), lm(0.3, 0.8, false)],
      [lm(NaN, NaN), lm(Infinity, -Infinity)],
      [lm(0.5, 0.5), lm(0.5, 0.5)],
    ];
    const reference = run(warmed(), base, 3);
    for (const [leftShoulder, rightShoulder] of shoulders) {
      const landmarks: PoseLandmarks = { ...landmarksFor({ x: MIDDLE_OFFSET, y: -MIDDLE_OFFSET }), leftShoulder, rightShoulder };
      const changed = run(warmed(), camera({ x: 0, y: 0 }, { landmarks }), 3);
      expect(changed.offsets).toStrictEqual(reference.offsets);
      expect(changed.state).toStrictEqual(reference.state);
    }
  });
});

describe('stepHeadView, the ramp to zero when the nose is lost (Req 9.6, 9.7, design section 9.6)', () => {
  const ease = TUNING.headEaseToCentreMs;

  it('at the moment of loss the output is the output before it', () => {
    const state = warmed();
    const step = stepHeadView(state, lost(), 0);
    expect(step.offset).toStrictEqual(state.out);
    expect(step.state.ease).toEqual({ from: state.out, elapsedMs: 0 });
  });

  it('in the middle of the ramp the output is out0 * (1 - e / headEaseToCentreMs): half of out0 at half the ease time', () => {
    const state = warmed();
    const half = stepHeadView(state, lost(), ease / 2);
    expect(half.offset).toStrictEqual({ x: state.out.x * (1 / 2), y: state.out.y * (1 / 2) });
    // The same in steps: the ramp starts from the output at the loss, not from the previous step's output.
    const steps = stepsIn(ease);
    const played = run(state, lost(), steps);
    played.offsets.forEach((offset, i) => {
      const left = (steps - 1 - i) / steps;
      if (i < steps - 1) {
        expect(offset.x).toBeCloseTo(state.out.x * left, 12);
        expect(offset.y).toBeCloseTo(state.out.y * left, 12);
        expect(Math.abs(offset.x)).toBeLessThan(Math.abs(i === 0 ? state.out.x : (played.offsets[i - 1]?.x ?? Infinity)));
      }
    });
  });

  it('is exactly (0, 0) from headEaseToCentreMs on, not -0, and stays there while the nose is lost', () => {
    const state = warmed();
    const steps = stepsIn(ease);
    const played = run(state, lost(), steps + 10);
    const before = played.offsets[steps - 2];
    expect(Math.abs(before?.x ?? 0)).toBeGreaterThan(0);
    expect(Math.abs(before?.y ?? 0)).toBeGreaterThan(0);
    for (const offset of played.offsets.slice(steps - 1)) {
      expect(Object.is(offset.x, 0)).toBe(true);
      expect(Object.is(offset.y, 0)).toBe(true);
    }
    // One step of exactly headEaseToCentreMs also ends it, and so does a longer one.
    expect(stepHeadView(state, lost(), ease).offset).toStrictEqual({ x: 0, y: 0 });
    expect(stepHeadView(state, lost(), 3 * ease).offset).toStrictEqual({ x: 0, y: 0 });
  });

  it('reads headEaseToCentreMs from the tuning in the input', () => {
    const state = warmed();
    const longer: Tuning = { ...TUNING, headEaseToCentreMs: ease * 2 };
    expect(stepHeadView(state, lost({ tuning: longer }), ease).offset.x).toBeCloseTo(state.out.x / 2, 12);
  });

  it('a nose that returns in the middle of the ramp continues from the current output with no jump (Req 9.7)', () => {
    const state = warmed();
    const mid = stepHeadView(state, lost(), ease / 2);
    expect(mid.state.ease).not.toBeNull();
    // Back with a delta of 0: no change at all in the output.
    const back = stepHeadView(mid.state, camera(FAR), 0);
    expect(back.offset).toStrictEqual(mid.offset);
    expect(back.state.ease).toBeNull();
    // Back with a delta: the smoothing from the current output towards raw.
    const weight = 1 - Math.exp(-STEP / TUNING.headSmoothingTauMs);
    const next = stepHeadView(mid.state, camera(FAR), STEP);
    expect(next.offset.x).toBeCloseTo(mid.offset.x + (1 - mid.offset.x) * weight, 12);
    expect(next.offset.y).toBeCloseTo(mid.offset.y + (-1 - mid.offset.y) * weight, 12);
    // A second loss starts a new ramp from the output then, not from the first loss.
    const second = stepHeadView(next.state, lost(), ease / 2);
    expect(second.offset).toStrictEqual({ x: next.offset.x * (1 / 2), y: next.offset.y * (1 / 2) });
  });

  it('after a ramp that reached 0 a returning nose starts from 0', () => {
    const ended = stepHeadView(warmed(), lost(), ease);
    const back = stepHeadView(ended.state, camera(FAR), STEP);
    expect(back.offset).toStrictEqual(stepHeadView(createHeadView(), camera(FAR), STEP).offset);
  });
});

describe('stepHeadView, simulated-input mode (Req 6.7, 6.8)', () => {
  const strength = TUNING.simulatedHeadStrength;
  const half = PLAY_ASPECT / 2;

  it('is simulatedHeadStrength * (s.x - A/2) / (A/2) on x and 0 on y, with no dead zone and no smoothing', () => {
    for (const x of [0, PLAY_ASPECT / 8, half - 1e-3, half, half + 1e-3, PLAY_ASPECT]) {
      for (const dt of [0, STEP, 7 * STEP]) {
        const step = stepHeadView(createHeadView(), simulated({ x, y: 0.3 }), dt);
        expect(step.offset.x).toBeCloseTo((strength * (x - half)) / half, 12);
        expect(step.offset.y).toBe(0);
      }
    }
    expect(stepHeadView(createHeadView(), simulated({ x: 0, y: 0 }), STEP).offset.x).toBeCloseTo(-strength, 12);
    expect(stepHeadView(createHeadView(), simulated({ x: PLAY_ASPECT, y: 0 }), STEP).offset.x).toBeCloseTo(strength, 12);
    // Not smoothed: the output follows the pointer at once, whatever the output was.
    const far = stepHeadView(createHeadView(), simulated({ x: PLAY_ASPECT, y: 0.5 }), STEP).state;
    expect(stepHeadView(far, simulated({ x: half, y: 0.5 }), STEP).offset.x).toBe(0);
    // No dead zone: a small distance from the centre gives a nonzero offset.
    expect(stepHeadView(createHeadView(), simulated({ x: half + 1e-3, y: 0.5 }), STEP).offset.x).toBeGreaterThan(0);
  });

  it('reads simulatedHeadStrength from the tuning in the input', () => {
    const doubled: Tuning = { ...TUNING, simulatedHeadStrength: strength / 2 };
    const a = stepHeadView(createHeadView(), simulated({ x: PLAY_ASPECT, y: 0 }), STEP).offset.x;
    const b = stepHeadView(createHeadView(), simulated({ x: PLAY_ASPECT, y: 0 }, true, undefined, doubled), STEP).offset.x;
    expect(b).toBeCloseTo(a / 2, 12);
  });

  it('an invalid pointer takes the same ramp: the moment of loss, the middle, exactly headEaseToCentreMs, and a pointer that returns', () => {
    const ease = TUNING.headEaseToCentreMs;
    const state = stepHeadView(createHeadView(), simulated({ x: PLAY_ASPECT, y: 0 }), STEP).state;
    const out0 = state.out.x;
    expect(out0).toBeGreaterThan(0);
    const away = (dt: number, from: HeadViewState = state) => stepHeadView(from, simulated({ x: 0, y: 0 }, false), dt);
    expect(away(0).offset).toStrictEqual(state.out);
    expect(away(ease / 2).offset).toStrictEqual({ x: out0 * (1 / 2), y: 0 });
    expect(away(ease).offset).toStrictEqual({ x: 0, y: 0 });
    const steps = stepsIn(ease);
    const played = run(state, simulated({ x: 0, y: 0 }, false), steps);
    expect(Math.abs(played.offsets[steps - 2]?.x ?? 0)).toBeGreaterThan(0);
    expect(Object.is(played.offsets[steps - 1]?.x, 0)).toBe(true);
    // A pointer that returns in the middle is not smoothed: the formula at once.
    const mid = away(ease / 2);
    const back = stepHeadView(mid.state, simulated({ x: PLAY_ASPECT, y: 0 }), STEP);
    expect(back.offset.x).toBeCloseTo(strength, 12);
    expect(back.state.ease).toBeNull();
  });
});

// ---------------------------------------------------------------------------------
// The named properties of design section 10.2.

/** The Lipschitz constant of the raw offset: its largest slope, 1 / (headClamp - headDeadZone) (5 as shipped). */
const RAW_LIPSCHITZ = 1 / (TUNING.headClamp - TUNING.headDeadZone);

// headview_deadzone_clamp_lipschitz (Req 9.5). raw is piecewise linear in d: slope 0 up to the dead
// zone, then slope 1 / (headClamp - headDeadZone) up to the clamp, then slope 0 again. So for any
// d1 and d2 the change in raw is at most that largest slope times the change in d, and the constant
// comes from two TUNING values with no number of its own. The bound is checked with TOLERANCE added,
// for the last-bit rounding of (|d| - headDeadZone) / (headClamp - headDeadZone). The offsets are
// those of genHeadFrames, which draw around the dead zone and the clamp from both sides.
it('headview_deadzone_clamp_lipschitz', () => {
  fc.assert(
    fc.property(genHeadFrames(), ({ steps }) => {
      const ds = steps.flatMap((s) => [s.d.x, s.d.y]);
      for (const d of ds) {
        const raw = headRaw(d, TUNING);
        if (Math.abs(d) <= TUNING.headDeadZone) expect(Object.is(raw, 0), `raw(${d}) is 0 in the dead zone`).toBe(true);
        if (Math.abs(d) >= TUNING.headClamp) expect(raw, `raw(${d}) is sign(d) from the clamp`).toBe(Math.sign(d));
      }
      // Every pair, collected and checked once: an expect call per pair would be too slow.
      const broken: string[] = [];
      for (const d1 of ds) {
        for (const d2 of ds) {
          const change = Math.abs(headRaw(d1, TUNING) - headRaw(d2, TUNING));
          if (!(change <= RAW_LIPSCHITZ * Math.abs(d1 - d2) + TOLERANCE)) broken.push(`|raw(${d1}) - raw(${d2})| = ${change}`);
        }
      }
      expect(broken).toEqual([]);
    }),
    { numRuns: 200 },
  );
}, 60_000);

/** Runs a case's steps in camera mode with the given shoulders, returning every offset and the final state. */
function runCase(frames: Parameters<typeof headCaseLandmarks>[0], other: boolean, skip = false) {
  let state = createHeadView();
  const offsets: Vec2[] = [];
  const states: HeadViewState[] = [];
  for (const step of frames.steps) {
    const input: HeadViewInput = {
      mode: 'camera',
      tuning: TUNING,
      landmarks: headCaseLandmarks(frames, step, other),
      frameAspect: frames.frameAspect,
      neutral: frames.neutral,
      skip,
    };
    const result = stepHeadView(state, input, step.dtMs);
    state = result.state;
    offsets.push(result.offset);
    states.push(state);
  }
  return { offsets, states, state };
}

// headview_output_bounded (Req 9.9): the output stays in -1..1 on both axes, and is finite, for every frame sequence.
it('headview_output_bounded', () => {
  fc.assert(
    fc.property(genHeadFrames(), (frames) => {
      for (const skip of [false, true]) {
        for (const offset of runCase(frames, false, skip).offsets) {
          expect(Number.isFinite(offset.x) && Number.isFinite(offset.y), 'finite').toBe(true);
          expect(Math.abs(offset.x), `x ${offset.x}`).toBeLessThanOrEqual(1);
          expect(Math.abs(offset.y), `y ${offset.y}`).toBeLessThanOrEqual(1);
        }
      }
    }),
    { numRuns: 300 },
  );
});

// headview_ignores_shoulders (Req 9.10): once calibration has fixed the neutral data, two sequences
// that differ only in the shoulders give outputs and states that are identical (toStrictEqual: the
// same numbers, not numbers within a tolerance).
it('headview_ignores_shoulders', () => {
  fc.assert(
    fc.property(genHeadFrames(), (frames) => {
      const a = runCase(frames, false);
      const b = runCase(frames, true);
      expect(b.offsets).toStrictEqual(a.offsets);
      expect(b.states).toStrictEqual(a.states);
    }),
    { numRuns: 300 },
  );
});

// Req 9.6: while the nose is lost |out| never increases and the direction never flips, and from
// headEaseToCentreMs of presence time after the loss it is exactly (0, 0).
it('headview_ramp_never_increases_and_ends_exactly_at_zero', () => {
  fc.assert(
    fc.property(genHeadFrames(), (frames) => {
      const { offsets } = runCase(frames, false);
      let lostMs = 0;
      let wasLost = false;
      frames.steps.forEach((step, i) => {
        const offset = offsets[i];
        const previous = offsets[i - 1] ?? { x: 0, y: 0 };
        if (offset === undefined) return;
        if (step.noseValid) {
          lostMs = 0;
          wasLost = false;
          return;
        }
        lostMs = wasLost ? lostMs + step.dtMs : step.dtMs;
        wasLost = true;
        for (const axis of ['x', 'y'] as const) {
          expect(Math.abs(offset[axis]), `|out.${axis}| at step ${i}`).toBeLessThanOrEqual(Math.abs(previous[axis]));
          expect(offset[axis] * previous[axis], `no sign flip on ${axis}`).toBeGreaterThanOrEqual(0);
          if (lostMs >= TUNING.headEaseToCentreMs) expect(Object.is(offset[axis], 0), `exactly 0 on ${axis} at step ${i}`).toBe(true);
        }
      });
    }),
    { numRuns: 300 },
  );
});

// Req 9.7: when the nose returns the output is continuous: with a delta of 0 it does not move at all.
it('headview_no_jump_when_the_nose_returns', () => {
  fc.assert(
    fc.property(genHeadFrames(), (frames) => {
      let state = createHeadView();
      for (const step of frames.steps) {
        const input: HeadViewInput = {
          mode: 'camera',
          tuning: TUNING,
          landmarks: headCaseLandmarks(frames, step, false),
          frameAspect: frames.frameAspect,
          neutral: frames.neutral,
          skip: false,
        };
        const next = stepHeadView(state, input, step.dtMs);
        if (step.dtMs === 0) expect(next.offset, 'a delta of 0 moves nothing').toStrictEqual(state.out);
        state = next.state;
      }
    }),
    { numRuns: 300 },
  );
});

// Req 6.7, 6.8: in simulated-input mode the output depends on the pointer, the play aspect, the
// tuning and the time only: not on any landmark, the frame aspect, the neutral data or the skip flag.
it('headview_simulated_ignores_every_landmark', () => {
  const pointer = fc.record(
    { valid: fc.boolean(), x: genSpread(0, PLAY_ASPECT), y: genSpread(0, 1), dtMs: genSpread(0, TUNING.maxClockStepMs) },
    { noNullPrototype: true },
  );
  fc.assert(
    fc.property(
      genHeadFrames(),
      fc.array(pointer, { minLength: 1, maxLength: 40 }),
      genSpread(ASPECT_MIN, ASPECT_MAX),
      fc.boolean(),
      (frames, pointers, aspect, skip) => {
        let reference = createHeadView();
        let varied = createHeadView();
        pointers.forEach((p, i) => {
          const step = frames.steps[i % frames.steps.length];
          if (step === undefined) return;
          const base = simulated({ x: p.x, y: p.y }, p.valid);
          // Same pointer, but every landmark of the frame, the aspect, the neutral data and skip changed.
          const landmarks = headCaseLandmarks(frames, step, i % 2 === 0);
          const other: HeadViewInput = {
            ...base,
            landmarks: { ...landmarks, rightWrist: lm(NaN, NaN, false), leftWrist: lm(0, 1, i % 3 === 0) },
            frameAspect: aspect,
            neutral: i % 2 === 0 ? null : frames.neutral,
            skip,
          };
          const a = stepHeadView(reference, base, p.dtMs);
          const b = stepHeadView(varied, other, p.dtMs);
          expect(b.offset).toStrictEqual(a.offset);
          expect(b.state).toStrictEqual(a.state);
          reference = a.state;
          varied = b.state;
        });
      },
    ),
    { numRuns: 200 },
  );
});

describe('marrow/core', () => {
  it('exports createHeadView and stepHeadView (design section 6)', () => {
    expect(core.createHeadView).toBe(createHeadView);
    expect(core.stepHeadView).toBe(stepHeadView);
  });
});
