// The frame driver (design section 3, Req 2.7, 8.2, 8.4, 6.3, 16.5, 18, 9.6, 17). The numbers come from TUNING
// or from fixtures that the tests state. The mutation check of 17.5 targets `driver_ignores_frame_timestamps`.
import { describe, expect, it } from 'vitest';
import {
  makeMapping,
  TUNING,
  type Demand,
  type HitArea,
  type PoseFrame,
  type PoseLandmarks,
  type Vec2,
} from 'marrow/core';
import {
  createDriver,
  startFrameLoop,
  stepFrameDriver,
  type DriverConfig,
  type DriverInput,
  type DriverState,
  type DriverStep,
  type FrameReading,
} from './frameDriver';

const PLAY_ASPECT = 1.6;
const FRAME_ASPECT = 4 / 3;
/** One tick's raw delta: the Clocks clamp to this value, so every tick counts the full step. */
const DT = TUNING.maxClockStepMs;
const DEMAND: Demand = { slots: [], n: 1, r: TUNING.hitRadius, m: 0 };
const CENTRE: Vec2 = { x: 0.5, y: 0.5 };
/** The nose at rest, which the calm hold records as the neutral head (Req 12.4). */
const NOSE_REST: Vec2 = { x: 0.5, y: 0.3 };

/** A pose for the test: each wrist and the nose is a position, or null for invalid. Shoulders are always valid. */
interface Pose {
  readonly right?: Vec2 | null;
  readonly left?: Vec2 | null;
  readonly nose?: Vec2 | null;
}

function poseOf({ right = CENTRE, left = null, nose = NOSE_REST }: Pose = {}): PoseLandmarks {
  const at = (pos: Vec2 | null) => (pos === null ? { pos: { x: 0, y: 0 }, valid: false } : { pos, valid: true });
  return {
    leftWrist: at(left),
    rightWrist: at(right),
    nose: at(nose),
    leftShoulder: at({ x: 0.65, y: 0.5 }),
    rightShoulder: at({ x: 0.35, y: 0.5 }),
  };
}

/** A new frame object each call, so each call is a new frame by reference. */
function frameOf(t: number, pose: Pose = {}): PoseFrame {
  return { t, aspect: FRAME_ASPECT, landmarks: poseOf(pose) };
}

function cameraConfig(overrides: Partial<DriverConfig> = {}): DriverConfig {
  return {
    mode: 'camera',
    activeWrists: ['right'],
    playAspect: PLAY_ASPECT,
    frameAspect: FRAME_ASPECT,
    demand: DEMAND,
    tuning: TUNING,
    ...overrides,
  };
}

function simulatedConfig(): DriverConfig {
  return {
    mode: 'simulated',
    activeWrists: ['right'],
    playAspect: PLAY_ASPECT,
    frameAspect: PLAY_ASPECT,
    demand: DEMAND,
    tuning: TUNING,
  };
}

/** One tick with a full step and the given frame. */
function tick(state: DriverState, frame: PoseFrame | null, extra: Partial<DriverInput> = {}): DriverStep {
  return stepFrameDriver(state, { rawDtMs: DT, paused: false, hidden: false, frame, drawAtMs: 0, hitAreas: [], ...extra });
}

/**
 * A camera driver that finished painting at the cap and then the calm hold, so its calibration holds the neutral
 * head. The right wrist is valid throughout, so painting time counts on every tick (Req 11.5, 12.2). "Use the whole
 * screen" is simulated-input only (Req 11.16), so the camera tests take this path.
 */
function calibratedWithHead(): DriverState {
  let state = createDriver(cameraConfig());
  const ticks = Math.ceil(TUNING.calibCapMs / DT) + Math.ceil(TUNING.calmHoldMs / DT) + 5;
  for (let i = 0; i < ticks && state.calibration.result === null; i++) {
    state = tick(state, frameOf(i * 16)).state;
  }
  expect(state.calibration.result?.head).not.toBeNull();
  return state;
}

/** Projects a step to the values the driver's caller can see, without the state. */
function observable(step: DriverStep) {
  return {
    pointers: step.pointers,
    headOffset: step.headOffset,
    presenceDt: step.presenceDt,
    sessionDt: step.sessionDt,
    holdActive: step.holdActive,
    overlayVisible: step.overlayVisible,
    oneWristHint: step.oneWristHint,
    newFrame: step.newFrame,
    frameDrawnAtMs: step.frameDrawnAtMs,
    dwellEvents: step.dwellEvents,
    calibrationCompleted: step.calibrationCompleted,
  };
}

describe('the frame driver step', () => {
  it('driver_ignores_frame_timestamps: the same frames with scrambled t give the same outputs', () => {
    // Distinct frames by index, and a schedule that repeats some of them, as a camera does between inferences.
    const poses: Pose[] = [
      { right: { x: 0.2, y: 0.3 } },
      { right: { x: 0.4, y: 0.5 } },
      { right: null },
      { right: { x: 0.7, y: 0.2 } },
      { right: { x: 0.72, y: 0.22 }, nose: null },
      { right: { x: 0.5, y: 0.5 }, nose: { x: 0.56, y: 0.3 } },
      { right: { x: 0.52, y: 0.5 } },
      { right: { x: 0.3, y: 0.6 } },
    ];
    const schedule = [0, 0, 1, 2, 2, 3, 4, 4, 5, 6, 7, 7];
    const hit: HitArea = { targetId: 'a', activationId: 'a1', centre: { x: 0.9, y: 0.5 }, radius: TUNING.hitRadius };
    const flags = (i: number) => ({ paused: i === 5, hidden: i === 8 });

    const run = (timestampOf: (index: number) => number): ReturnType<typeof observable>[] => {
      const frames = poses.map((pose, index) => frameOf(timestampOf(index), pose));
      let state = calibratedWithHead();
      return schedule.map((pick, i) => {
        const step = stepFrameDriver(state, {
          rawDtMs: DT,
          ...flags(i),
          frame: frames[pick] ?? null,
          drawAtMs: 1000 + i * 16,
          hitAreas: [hit],
        });
        state = step.state;
        return observable(step);
      });
    };

    const ordered = run((index) => index * 16);
    // Scrambled values, values that repeat from one frame to the next, and one constant value.
    const scrambled = run((index) => (index * 7919 + 13) % 1009);
    const paired = run((index) => Math.floor(index / 2) * 37);
    const constant = run(() => 0);
    expect(scrambled).toEqual(ordered);
    expect(paired).toEqual(ordered);
    expect(constant).toEqual(ordered);
    // The check is not vacuous: frames were drawn, and the draw times come from the driver's clock.
    expect(ordered.some((o) => o.newFrame)).toBe(true);
    expect(ordered.some((o) => o.frameDrawnAtMs !== null && o.frameDrawnAtMs >= 1000)).toBe(true);
  });

  it('a wrist that turns invalid in this tick counts as invalid for tracking in the same tick', () => {
    let state = calibratedWithHead();
    state = tick(state, frameOf(0)).state;
    // The first invalid frame appears on tick 1. Lost time then reaches the hold threshold on the tick
    // that sees it, after floor(trackingHoldAfterMs / DT) + 1 invalid ticks (Req 18.3).
    const expectedTick = Math.floor(TUNING.trackingHoldAfterMs / DT) + 1;
    let firstHold = -1;
    for (let i = 1; i <= expectedTick + 2 && firstHold < 0; i++) {
      const step = tick(state, frameOf(i * 16, { right: null }));
      state = step.state;
      if (step.holdActive) firstHold = i;
    }
    expect(firstHold).toBe(expectedTick);
  });

  it('the session delta is 0 in the step a hold begins, and presence delta is not', () => {
    let state = calibratedWithHead();
    state = tick(state, frameOf(0)).state;
    const expectedTick = Math.floor(TUNING.trackingHoldAfterMs / DT) + 1;
    const steps: DriverStep[] = [];
    for (let i = 1; i <= expectedTick; i++) {
      const step = tick(state, frameOf(i * 16, { right: null }));
      state = step.state;
      steps.push(step);
    }
    const begin = steps.at(-1);
    expect(begin?.holdActive).toBe(true);
    expect(begin?.sessionDt).toBe(0);
    expect(begin?.presenceDt).toBe(DT);
    expect(steps.at(-2)?.holdActive).toBe(false);
    expect(steps.at(-2)?.sessionDt).toBe(DT);
  });

  it('the filter starts again after a pause, and frames seen while paused are not consumed', () => {
    let state = calibratedWithHead();
    const first = tick(state, frameOf(0, { right: { x: 0.2, y: 0.4 } }));
    state = first.state;
    const second = tick(state, frameOf(16, { right: { x: 0.6, y: 0.8 } }));
    state = second.state;
    const rawSecond = state.mapping.toScreen({ x: 0.6, y: 0.8 });
    // The filter smooths the second sample, so it differs from the raw position.
    expect(Math.abs(second.pointers[0]?.valid ? second.pointers[0].pos.x - rawSecond.x : 0)).toBeGreaterThan(1e-6);

    const paused = tick(state, frameOf(32, { right: { x: 0.9, y: 0.9 } }), { paused: true });
    state = paused.state;
    expect(paused.newFrame).toBe(false);
    expect(paused.pointers).toEqual(second.pointers);

    const resumedPos = { x: 0.3, y: 0.5 };
    const resumed = tick(state, frameOf(48, { right: resumedPos }));
    expect(resumed.newFrame).toBe(true);
    const expected = resumed.state.mapping.toScreen(resumedPos);
    const got = resumed.pointers[0];
    expect(got?.valid).toBe(true);
    if (got?.valid) {
      expect(got.pos.x).toBeCloseTo(expected.x, 9);
      expect(got.pos.y).toBeCloseTo(expected.y, 9);
    }
  });

  it('in simulated input the pointer is the pointer position, with no filter', () => {
    const screen: Vec2 = { x: 0.7 * PLAY_ASPECT, y: 0.4 };
    const base = makeMapping({ playAspect: PLAY_ASPECT, frameAspect: PLAY_ASPECT, gain: 1, centre: { x: PLAY_ASPECT / 2, y: 0.5 } });
    const camera = base.toCamera(screen);
    const step = tick(createDriver(simulatedConfig()), frameOf(0, { right: camera }));
    const got = step.pointers[0];
    expect(got?.valid).toBe(true);
    if (got?.valid) {
      expect(got.pos.x).toBeCloseTo(screen.x, 9);
      expect(got.pos.y).toBeCloseTo(screen.y, 9);
    }
  });

  it('changing the head offset leaves pointers and dwell unchanged', () => {
    const start = calibratedWithHead();
    const target = start.mapping.toScreen(CENTRE);
    const hit: HitArea = { targetId: 'a', activationId: 'a1', centre: target, radius: TUNING.hitRadius };
    const run = (nose: Vec2) => {
      let state = start;
      let last: DriverStep | null = null;
      for (let i = 0; i < 5; i++) {
        last = tick(state, frameOf(i * 16, { right: CENTRE, nose }), { hitAreas: [hit] });
        state = last.state;
      }
      return { last: last as DriverStep, state };
    };
    const still = run(NOSE_REST);
    const moved = run({ x: NOSE_REST.x + 0.12, y: NOSE_REST.y });
    expect(moved.last.headOffset.x).not.toBe(still.last.headOffset.x);
    expect(moved.last.pointers).toEqual(still.last.pointers);
    expect(moved.state.dwell).toEqual(still.state.dwell);
    expect(moved.state.dwell.targets.length).toBeGreaterThan(0);
  });
});

describe('the frame loop', () => {
  it('steps nothing while idle, and a replaced state starts with raw delta 0', () => {
    const callbacks: ((t: number) => void)[] = [];
    const seen: DriverStep[] = [];
    const reading: FrameReading = { paused: false, hidden: false, frame: null, hitAreas: [] };
    const loop = startFrameLoop({
      initial: null,
      read: () => reading,
      onStep: (step) => seen.push(step),
      requestFrame: (callback) => callbacks.push(callback),
      cancelFrame: () => undefined,
    });
    callbacks[0]?.(100);
    callbacks[1]?.(116);
    expect(seen).toHaveLength(0);
    expect(loop.state()).toBeNull();
    expect(loop.act({ kind: 'wholeScreen' })).toBe(false);
    loop.replace(createDriver(cameraConfig()));
    callbacks[2]?.(1000);
    callbacks[3]?.(1016);
    expect(seen.map((s) => s.presenceDt)).toEqual([0, 16]);
    loop.stop();
  });

  it('gives the first tick raw delta 0, passes the frame time as the draw time, and stops once', () => {
    const callbacks: ((t: number) => void)[] = [];
    const cancelled: number[] = [];
    let handle = 0;
    const seen: DriverStep[] = [];
    const reading: FrameReading = { paused: false, hidden: false, frame: null, hitAreas: [] };
    const loop = startFrameLoop({
      initial: createDriver(cameraConfig()),
      read: () => reading,
      onStep: (step) => seen.push(step),
      requestFrame: (callback) => {
        callbacks.push(callback);
        handle += 1;
        return handle;
      },
      cancelFrame: (h) => cancelled.push(h),
    });
    callbacks[0]?.(500);
    callbacks[1]?.(516);
    // The frame times are 16 ms apart, below the clamp, so the presence delta is 16.
    expect(seen.map((s) => s.presenceDt)).toEqual([0, 16]);
    loop.stop();
    loop.stop();
    expect(cancelled).toEqual([handle]);
    callbacks[2]?.(532);
    expect(seen).toHaveLength(2);
  });
});
