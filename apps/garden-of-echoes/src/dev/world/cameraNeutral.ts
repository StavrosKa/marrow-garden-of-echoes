// The neutral head of camera mode (Req 14.3, 14.4; design 8.1). It is recorded only from a frame in
// which the nose and both shoulders are valid, because the shoulder width is needed. "Set centre"
// records it again from the next frame that qualifies.
import type { NeutralHead, PoseLandmarks } from 'marrow/core';

const ZERO = 0;

export interface NeutralState {
  /** The recorded neutral head, or null while no qualifying frame has arrived. */
  readonly neutral: NeutralHead | null;
  /** True after "Set centre", until the next qualifying frame records the head again. */
  readonly pending: boolean;
}

export function createNeutral(): NeutralState {
  return { neutral: null, pending: false };
}

/**
 * One frame's neutral-head rule. A frame records the head when none is recorded yet or when "Set
 * centre" is pending, and only if the nose and both shoulders are valid and the shoulders have a width.
 */
export function recordNeutral(state: NeutralState, landmarks: PoseLandmarks, frameAspect: number): NeutralState {
  if (state.neutral !== null && !state.pending) return state;
  const { nose, leftShoulder, rightShoulder } = landmarks;
  if (!nose.valid || !leftShoulder.valid || !rightShoulder.valid) return state;
  const shoulderWidth = Math.hypot(
    (leftShoulder.pos.x - rightShoulder.pos.x) * frameAspect,
    leftShoulder.pos.y - rightShoulder.pos.y,
  );
  if (!(shoulderWidth > ZERO)) return state;
  return {
    neutral: { nose: { x: nose.pos.x, y: nose.pos.y }, shoulderWidth },
    pending: false,
  };
}

/** "Set centre" (Req 14.4): the next qualifying frame records the neutral head again. */
export function requestSetCentre(state: NeutralState): NeutralState {
  return { ...state, pending: true };
}
