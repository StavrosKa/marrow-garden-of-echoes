import fc from 'fast-check';
import { TUNING as MARROW_TUNING } from 'marrow/core';
import type { Vec2 } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { MS_PER_SECOND, createGlide, stepGlide, type GlideState } from './glide';
import { motionProfile } from './motion';
import {
  DISTANCE_FLOOR,
  PARITY_TOLERANCE,
  RENDER_HZ_FAST,
  RENDER_HZ_SLOW,
  fixedRenderFrames,
  genPoseSchedule,
  genRenderTimes,
  genSpread,
  targetAt,
  type PoseSchedule,
} from './testgen';
import { TUNING } from './tuning';

// Test values. ZERO and ONE are the structural numbers; the rest are parameters of these tests.
const ZERO = 0;
const ONE = 1;
/** Targets are drawn up to this many times the head square, so the clamp of Req 5.7 is exercised. */
const OVERDRIVE_MAX = 3;
/** Req 5.8 compares the common times k / 12 s: a 60 Hz frame 5k and a 144 Hz frame 12k. */
const COMMON_STEPS_PER_S = 12;
const COMMON_SECONDS = 3;
const SLOW_STEP = RENDER_HZ_SLOW / COMMON_STEPS_PER_S;
const FAST_STEP = RENDER_HZ_FAST / COMMON_STEPS_PER_S;
/** The frame delta used by the unit blocks that need a step the cap does not limit. */
const ONE_MS = 1;
/** The time the Reduced block runs for (3 s), and one second of Full before it. */
const ONE_SECOND_MS = MS_PER_SECOND;
const REDUCED_RUN_MS = COMMON_SECONDS * MS_PER_SECOND;

function clampUnit(value: number): number {
  return Math.min(ONE, Math.max(-ONE, value));
}

/** The glide output after each frame of a render run, starting at the rest state. */
function runFrames(frames: readonly number[], schedule: PoseSchedule): GlideState[] {
  let state = createGlide();
  const states: GlideState[] = [state];
  let t = ZERO;
  for (const dt of frames) {
    t += dt;
    state = stepGlide(state, targetAt(schedule, t), dt);
    states.push(state);
  }
  return states;
}

describe('glide per-frame limits at 7 pose frames per second', () => {
  it('glide per-frame limits at 7 pose frames per second', () => {
    const case_ = fc.tuple(fc.boolean(), genRenderTimes(), genSpread(ONE, OVERDRIVE_MAX)).chain(([jittered, frames, scale]) =>
      genPoseSchedule(jittered).map((schedule) => ({
        frames,
        schedule: { starts: schedule.starts, targets: schedule.targets.map((t) => ({ x: t.x * scale, y: t.y * scale })) },
      })),
    );
    fc.assert(
      fc.property(case_, ({ frames, schedule }) => {
        let state = createGlide();
        let t = ZERO;
        for (const dt of frames) {
          t += dt;
          const target = targetAt(schedule, t);
          const clamped: Vec2 = { x: clampUnit(target.x), y: clampUnit(target.y) };
          const before = state.out;
          const next = stepGlide(state, target, dt);
          for (const axis of ['x', 'y'] as const) {
            const from = before[axis];
            const to = next.out[axis];
            // Req 5.7: inside -1..1, and between the previous output and the (clamped) target.
            expect(to).toBeGreaterThanOrEqual(-ONE);
            expect(to).toBeLessThanOrEqual(ONE);
            expect(to).toBeGreaterThanOrEqual(Math.min(from, clamped[axis]));
            expect(to).toBeLessThanOrEqual(Math.max(from, clamped[axis]));
            // Req 5.10: one frame moves an axis at most cap * dt / 1000.
            expect(Math.abs(to - from)).toBeLessThanOrEqual((TUNING.glideCapPerS * dt) / MS_PER_SECOND + DISTANCE_FLOOR);
          }
          // Req 5.9: while the distance is above glideEpsilon and the frame is at least 1 ms, the output changes.
          const distance = Math.hypot(clamped.x - before.x, clamped.y - before.y);
          if (distance > TUNING.glideEpsilon && dt >= ONE) {
            expect(next.out.x !== before.x || next.out.y !== before.y).toBe(true);
          }
          state = next;
        }
      }),
    );
  });

  it('glide per-frame limits at 7 pose frames per second: parity at 60 Hz and 144 Hz within PARITY_TOLERANCE (5.8)', () => {
    fc.assert(
      fc.property(fc.boolean().chain((jittered) => genPoseSchedule(jittered)), (schedule) => {
        const slow = runFrames(fixedRenderFrames(RENDER_HZ_SLOW), schedule);
        const fast = runFrames(fixedRenderFrames(RENDER_HZ_FAST), schedule);
        for (let k = ZERO; k <= COMMON_STEPS_PER_S * COMMON_SECONDS; k++) {
          const a = slow[k * SLOW_STEP]!.out;
          const b = fast[k * FAST_STEP]!.out;
          expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(PARITY_TOLERANCE);
          expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(PARITY_TOLERANCE);
        }
      }),
    );
  });
});

describe('glide unit rules', () => {
  it('glide unit rules: one step moves each axis by (target - out) * (1 - exp(-dt / tau)) when the cap does not bind (5.3)', () => {
    const target = { x: TUNING.glideEpsilon, y: -TUNING.glideEpsilon };
    const dt = TUNING.glideTauMs;
    const next = stepGlide(createGlide(), target, dt);
    const weight = 1 - Math.exp(-dt / TUNING.glideTauMs);
    expect(next.out.x).toBeCloseTo(target.x * weight, 12);
    expect(next.out.y).toBeCloseTo(target.y * weight, 12);
  });

  it('glide unit rules: the cap limits the move to glideCapPerS * dt / 1000 when it binds (5.3)', () => {
    // At one millisecond the exponential move is larger than the cap, so the cap decides.
    const next = stepGlide(createGlide(), { x: ONE, y: -ONE }, ONE_MS);
    expect(next.out.x).toBeCloseTo((TUNING.glideCapPerS * ONE_MS) / MS_PER_SECOND, 12);
    expect(next.out.y).toBeCloseTo(-(TUNING.glideCapPerS * ONE_MS) / MS_PER_SECOND, 12);
  });

  it('glide unit rules: a delta of 0, negative, NaN or infinite moves nothing (5.6)', () => {
    const state: GlideState = { out: { x: TUNING.glideEpsilon, y: -TUNING.glideEpsilon } };
    for (const dt of [ZERO, -ONE, Number.NaN, Number.POSITIVE_INFINITY]) {
      const next = stepGlide(state, { x: ONE, y: -ONE }, dt);
      expect(Object.is(next.out.x, state.out.x) && Object.is(next.out.y, state.out.y)).toBe(true);
    }
  });

  it('glide unit rules: the target is clamped to -1..1 (5.7)', () => {
    const beyond = stepGlide(createGlide(), { x: TUNING.glideCapPerS, y: -TUNING.glideCapPerS }, TUNING.glideTauMs);
    const edge = stepGlide(createGlide(), { x: ONE, y: -ONE }, TUNING.glideTauMs);
    expect(beyond).toEqual(edge);
  });

  it('glide unit rules: the output follows a Head View ramp to 0 like any other target (5.4, 5.5)', () => {
    // The head rises to 1 over headEaseToCentreMs and eases back to 0 over the same time, as Marrow's Head View does.
    const ease = MARROW_TUNING.headEaseToCentreMs;
    const frames = fixedRenderFrames(RENDER_HZ_SLOW, ease * 2);
    let state = createGlide();
    let t = ZERO;
    let atPeak = createGlide();
    for (const dt of frames) {
      t += dt;
      const head = Math.max(ZERO, ONE - Math.abs(ONE - t / ease));
      state = stepGlide(state, { x: head, y: ZERO }, dt);
      if (t <= ease) atPeak = state;
    }
    // The output lags the head on the way down and ends below its peak, with no ease of its own.
    expect(state.out.x).toBeLessThan(atPeak.out.x);
    expect(state.out.x).toBeGreaterThan(ZERO);
  });

  it('glide unit rules: Reduced gives a target of (0, 0) that decays below glideEpsilon with no jump (8.7)', () => {
    const reduced = motionProfile('reduced').headMultiplier;
    // One second at Full holds the head at (1, -1), so the output is away from 0 when Reduced starts.
    let state = createGlide();
    for (const dt of fixedRenderFrames(RENDER_HZ_SLOW, ONE_SECOND_MS)) {
      state = stepGlide(state, { x: ONE, y: -ONE }, dt);
    }
    expect(Math.abs(state.out.x)).toBeGreaterThan(TUNING.glideEpsilon);
    for (const dt of fixedRenderFrames(RENDER_HZ_SLOW, REDUCED_RUN_MS)) {
      const before = state.out;
      state = stepGlide(state, { x: ONE * reduced, y: -ONE * reduced }, dt);
      // No jump: each axis moves at most the cap of this frame, and never away from 0.
      for (const axis of ['x', 'y'] as const) {
        expect(Math.abs(state.out[axis] - before[axis])).toBeLessThanOrEqual((TUNING.glideCapPerS * dt) / MS_PER_SECOND + DISTANCE_FLOOR);
        expect(Math.abs(state.out[axis])).toBeLessThanOrEqual(Math.abs(before[axis]));
      }
    }
    expect(Math.abs(state.out.x)).toBeLessThan(TUNING.glideEpsilon);
    expect(Math.abs(state.out.y)).toBeLessThan(TUNING.glideEpsilon);
  });
});