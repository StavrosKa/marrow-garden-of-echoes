// The seeded choices and the pose frames of a synthetic player (garden-level design 2.5; requirement 19.1, 19.6).
// Both functions take the generator as a value and return the next one, so the same seed gives the same choices and
// the same frames. Neither reads a clock or Math.random. Each call makes a fixed number of draws.
import type { Mark } from '../challenges/attention';
import { nextUnit, type Rng } from '../challenges/rng';
import type { PoseFrame, Vec2 } from '../core';
import type { SimProfile } from './tuning';

/** The resting place of the right wrist, away from every slot of the stage. */
const REST: Vec2 = { x: 0.9, y: 0.9 };
/** The resting place of the left wrist. It is valid unless the profile is one-hand. */
const REST_LEFT: Vec2 = { x: 0.1, y: 0.9 };
/** The still head: a nose and two shoulders at fixed camera positions. */
const NOSE: Vec2 = { x: 0.5, y: 0.4 };
const LEFT_SHOULDER: Vec2 = { x: 0.4, y: 0.6 };
const RIGHT_SHOULDER: Vec2 = { x: 0.6, y: 0.6 };

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function atUnit(point: Vec2): Vec2 {
  return { x: clampUnit(point.x), y: clampUnit(point.y) };
}

/**
 * The choice for one presentation (requirement 19.6). One draw: the answer is wrong when the draw is below the
 * profile's rate, so rate 0 is never wrong and rate 1 is always wrong. A wrong select is no dwell (the select window
 * ends). A wrong pass is a dwell (a dwell on a let-pass stimulus).
 */
export function chooseFor(
  profile: SimProfile,
  rng: Rng,
  mark: Mark,
): { readonly dwell: boolean; readonly wrong: boolean; readonly rng: Rng } {
  const draw = nextUnit(rng);
  const wrong = draw.value < profile.wrongAnswerRate;
  const dwell = (mark === 'select') !== wrong;
  return { dwell, wrong, rng: draw.rng };
}

/**
 * The pose frames for the span, one per frame interval of the profile (requirement 19.1). The right wrist is at
 * `slotCamera` plus jitter when `dwell` is true and `slotCamera` is given, and at the resting place otherwise. The
 * left wrist rests unless the profile is one-hand. The right wrist is invalid during the profile's tracking gaps.
 * The head is still and valid. Each frame draws three numbers, so the draws depend on the span only.
 */
export function framesFor(
  profile: SimProfile,
  rng: Rng,
  slotCamera: Vec2 | null,
  dwell: boolean,
  aspect: number,
  span: { readonly startMs: number; readonly endMs: number },
): { readonly frames: readonly PoseFrame[]; readonly rng: Rng } {
  const interval = profile.frameIntervalMs;
  const length = span.endMs - span.startMs;
  const frames: PoseFrame[] = [];
  let current = rng;
  for (let k = 0; k * interval < length; k++) {
    const x = nextUnit(current);
    const y = nextUnit(x.rng);
    const z = nextUnit(y.rng);
    current = z.rng;
    const t = span.startMs + k * interval;
    const base = dwell && slotCamera !== null ? slotCamera : REST;
    const jitter = profile.jitterShare;
    const wrist = atUnit({ x: base.x + (x.value * 2 - 1) * jitter, y: base.y + (y.value * 2 - 1) * jitter });
    const gap = profile.trackingGap;
    const gapped = gap !== null && t % gap.everyMs < gap.lengthMs;
    const leftValid = !profile.oneHand;
    const leftPos = atUnit({ x: REST_LEFT.x + (z.value * 2 - 1) * jitter, y: REST_LEFT.y });
    frames.push({
      t,
      aspect,
      landmarks: {
        leftWrist: { pos: leftPos, valid: leftValid },
        rightWrist: { pos: wrist, valid: !gapped },
        nose: { pos: NOSE, valid: true },
        leftShoulder: { pos: LEFT_SHOULDER, valid: true },
        rightShoulder: { pos: RIGHT_SHOULDER, valid: true },
      },
    });
  }
  return { frames, rng: current };
}
