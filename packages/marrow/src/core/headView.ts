// The head-view signal (Requirement 9, 6.7, 6.8, design sections 9.6 and 13 question 4): a
// two-axis offset in -1..1, in screen orientation, from the nose's distance to the neutral
// nose that calibration recorded. A pure reducer: stepHeadView(state, input, dtMs) ->
// { state, offset }, on the presence clock (Req 16.7).
//
// dtMs is the presence delta that presenceDelta of clocks.ts returns: it is already clamped
// to 0..maxClockStepMs, and a negative or non-finite one is 0 (Req 16.2). So it is used as
// given here, and not clamped a second time. A delta of 0 moves nothing: the smoothing
// weight is 1 - exp(-0) = 0, and the ramp's elapsed time does not advance.
//
// Camera mode, with the neutral head data (the NeutralHead of calibration.ts) and no skip:
//   d.x = ((1 - nose.x) - (1 - neutral.x)) * a / shoulderWidth      mirrored once, as in mapping.ts:
//                                                                   u = 1 - x, so a head moving to the
//                                                                   right of the screen gives d.x > 0
//   d.y = (nose.y - neutral.y) / shoulderWidth                      y grows downwards, not mirrored
//   raw = sign(d) * max(0, |d| - headDeadZone) / (headClamp - headDeadZone), clamped to -1..1
//   out += (raw - out) * (1 - exp(-dt / headSmoothingTauMs))        while the nose is valid
// The shoulders of the frame are never read: the width is the neutral one (Req 9.1, 9.10).
//
// When the nose is invalid the output follows a linear ramp to exactly 0 (design section
// 9.6): out = out0 * (1 - min(e / headEaseToCentreMs, 1)), where out0 is the output at the
// moment the nose was lost and e is the presence time since then. The step in which the nose
// is first invalid counts its dt in e, as a valid step counts its dt in the smoothing: the
// nose was lost for that step. From e >= headEaseToCentreMs the output is the literal
// (0, 0), not out0 * 0, so it is never -0. When the nose returns, the ramp is forgotten and
// the smoothing continues from the current output (Req 9.7).
//
// Skip, or no neutral data, gives (0, 0) in camera mode. Skip is honoured in camera mode
// only: in simulated-input mode the nose is a synthetic landmark that is always valid and
// the calm hold ends after 2 s (Req 12.10), so there is no skip offer to take.
//
// Simulated-input mode (Req 6.7, 6.8): x = simulatedHeadStrength * (s.x - A/2) / (A/2) and
// y = 0, from the pointer's screen position and the play aspect only, with no dead zone and
// no smoothing, and no camera landmark is read. An invalid pointer takes the same ramp.
import type { PoseLandmarks, Vec2 } from './frame';
import type { NeutralHead } from './calibration';
import type { Tuning } from './tuning';

/** The head offset's limit on each axis (Req 9.3, 9.9): -1..1. Geometry of the signal, not a tuning value. */
const OFFSET_LIMIT = 1;
/** Camera space spans 0..1 on x, so mirroring once maps x to MIRROR_SPAN - x, as in mapping.ts. */
const MIRROR_SPAN = 1;
/** The centre of the play area on x is half its width. Geometry, not a tuning value. */
const HALF = 0.5;
/** A head offset of exactly nothing. Written with literal zeros so that it is never -0. */
const CENTRE: Vec2 = Object.freeze({ x: 0, y: 0 });

/** The pointer in simulated-input mode: its screen position and whether it is valid (Req 6.2). */
export interface HeadViewPointer {
  readonly valid: boolean;
  readonly pos: Vec2;
}

interface HeadViewInputBase {
  /** The tuning values the signal reads: dead zone, clamp, smoothing, ease time and simulated strength. */
  readonly tuning: Tuning;
  /** The latest frame's landmarks. Only the nose is read, and only in camera mode; the shoulders and wrists never are. */
  readonly landmarks: PoseLandmarks;
  /** The frame aspect a, for aspect-corrected distances (glossary). */
  readonly frameAspect: number;
  /** The neutral head data from calibration, or null (skipped, or not yet calibrated). */
  readonly neutral: NeutralHead | null;
  /** Whether "Skip head view" is in effect for the session (Req 9.8). */
  readonly skip: boolean;
}

/** One step's input. */
export type HeadViewInput =
  | (HeadViewInputBase & { readonly mode: 'camera' })
  | (HeadViewInputBase & {
      readonly mode: 'simulated';
      /** The pointer, in screen space (Req 6.7). */
      readonly pointer: HeadViewPointer;
      /** The play-area aspect A. */
      readonly playAspect: number;
    });

/** The ramp that is running while the nose, or the simulated pointer, is lost. */
interface Ease {
  /** The output at the moment of loss. */
  readonly from: Vec2;
  /** Presence time since then. */
  readonly elapsedMs: number;
}

export interface HeadViewState {
  /** The current output, in -1..1 on each axis. */
  readonly out: Vec2;
  /** The ramp to zero, or null while the signal is valid. */
  readonly ease: Ease | null;
}

/** The state of a head view that has seen no step: output (0, 0). */
export function createHeadView(): HeadViewState {
  return { out: CENTRE, ease: null };
}

/**
 * The raw offset on one axis from the normalised distance d (Req 9.3): 0 within the dead
 * zone, then rising linearly to exactly +-1 at headClamp and beyond. Its slope is
 * 1 / (headClamp - headDeadZone). NaN gives 0.
 */
export function headRaw(d: number, tuning: Tuning): number {
  const magnitude = Math.abs(d);
  if (!(magnitude > tuning.headDeadZone)) return 0;
  const scaled = Math.min((magnitude - tuning.headDeadZone) / (tuning.headClamp - tuning.headDeadZone), OFFSET_LIMIT);
  return d > 0 ? scaled : -scaled;
}

/** The normalised distance of the nose from the neutral one, per axis (Req 9.2). */
export function headDistance(nose: Vec2, neutral: NeutralHead, frameAspect: number): Vec2 {
  // The mirror, applied once to both noses as in mapping.ts: u = 1 - x.
  const u = MIRROR_SPAN - nose.x;
  const neutralU = MIRROR_SPAN - neutral.nose.x;
  return {
    x: ((u - neutralU) * frameAspect) / neutral.shoulderWidth,
    y: (nose.y - neutral.nose.y) / neutral.shoulderWidth,
  };
}

/** One step of the linear ramp to zero, from the state's ramp or a new one starting at the current output. */
function ramp(state: HeadViewState, dtMs: number, tuning: Tuning): { state: HeadViewState; offset: Vec2 } {
  const ease: Ease = state.ease ?? { from: state.out, elapsedMs: 0 };
  const elapsedMs = ease.elapsedMs + dtMs;
  const left = OFFSET_LIMIT - Math.min(elapsedMs / tuning.headEaseToCentreMs, OFFSET_LIMIT);
  const out: Vec2 = left === 0 ? CENTRE : { x: ease.from.x * left, y: ease.from.y * left };
  return { state: { out, ease: { from: ease.from, elapsedMs } }, offset: out };
}

/** One step of the exponential smoothing towards the raw offset, from the current output (Req 9.4, 9.7). */
function smooth(state: HeadViewState, raw: Vec2, dtMs: number, tuning: Tuning): { state: HeadViewState; offset: Vec2 } {
  const weight = 1 - Math.exp(-dtMs / tuning.headSmoothingTauMs);
  const out: Vec2 = {
    x: state.out.x + (raw.x - state.out.x) * weight,
    y: state.out.y + (raw.y - state.out.y) * weight,
  };
  return { state: { out, ease: null }, offset: out };
}

/**
 * One step of the head view with the presence delta dtMs. The state and the input are only
 * read. The offset is in -1..1 on both axes (Req 9.9).
 */
export function stepHeadView(
  state: HeadViewState,
  input: HeadViewInput,
  dtMs: number,
): { state: HeadViewState; offset: Vec2 } {
  const { tuning } = input;
  if (input.mode === 'simulated') {
    if (!input.pointer.valid) return ramp(state, dtMs, tuning);
    const half = input.playAspect * HALF;
    const x = (tuning.simulatedHeadStrength * (input.pointer.pos.x - half)) / half;
    const out: Vec2 = { x: Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, x)), y: 0 };
    return { state: { out, ease: null }, offset: out };
  }
  const { neutral } = input;
  if (input.skip || neutral === null) return { state: createHeadView(), offset: CENTRE };
  if (!input.landmarks.nose.valid) return ramp(state, dtMs, tuning);
  const d = headDistance(input.landmarks.nose.pos, neutral, input.frameAspect);
  return smooth(state, { x: headRaw(d.x, tuning), y: headRaw(d.y, tuning) }, dtMs, tuning);
}
