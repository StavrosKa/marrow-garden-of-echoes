// The neutral head of camera mode (Req 14.3, 14.4; design 8.1).
import type { Landmark, PoseLandmarks, Vec2 } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { createNeutral, recordNeutral, requestSetCentre } from './cameraNeutral';

const ZERO = 0;
const HALF = 0.5;
const ASPECT = 16 / 9;
const SPREAD = 0.25;

function landmark(x: number, y: number, valid: boolean): Landmark {
  return { pos: { x, y }, valid };
}

function frame(nose: Vec2, noseValid: boolean, leftValid: boolean, rightValid: boolean): PoseLandmarks {
  return {
    leftWrist: landmark(ZERO, ZERO, false),
    rightWrist: landmark(ZERO, ZERO, false),
    nose: landmark(nose.x, nose.y, noseValid),
    leftShoulder: landmark(HALF + SPREAD, HALF, leftValid),
    rightShoulder: landmark(HALF - SPREAD, HALF, rightValid),
  };
}

describe('neutral head', () => {
  it('neutral head needs nose and both shoulders', () => {
    const nose = { x: HALF, y: HALF };
    let state = createNeutral();
    // Each missing landmark records nothing: the nose, the left shoulder and the right shoulder.
    state = recordNeutral(state, frame(nose, false, true, true), ASPECT);
    expect(state.neutral).toBeNull();
    state = recordNeutral(state, frame(nose, true, false, true), ASPECT);
    expect(state.neutral).toBeNull();
    state = recordNeutral(state, frame(nose, true, true, false), ASPECT);
    expect(state.neutral).toBeNull();
    // With all three valid, the frame records the nose and the shoulder width in aspect-corrected units.
    state = recordNeutral(state, frame(nose, true, true, true), ASPECT);
    expect(state.neutral?.nose).toEqual(nose);
    expect(state.neutral?.shoulderWidth).toBeCloseTo(Math.hypot(SPREAD * 2 * ASPECT, 0), 12);
  });

  it('a later frame does not change the neutral head until Set centre', () => {
    const first = recordNeutral(createNeutral(), frame({ x: HALF, y: HALF }, true, true, true), ASPECT);
    const moved = recordNeutral(first, frame({ x: HALF + SPREAD, y: HALF }, true, true, true), ASPECT);
    expect(moved).toBe(first);
    // Set centre: the next frame that qualifies records the head again, and a frame that does not qualify waits.
    const pending = requestSetCentre(first);
    const notQualifying = recordNeutral(pending, frame({ x: HALF + SPREAD, y: HALF }, false, true, true), ASPECT);
    expect(notQualifying.pending).toBe(true);
    const recorded = recordNeutral(pending, frame({ x: HALF + SPREAD, y: HALF }, true, true, true), ASPECT);
    expect(recorded.neutral?.nose).toEqual({ x: HALF + SPREAD, y: HALF });
    expect(recorded.pending).toBe(false);
  });

  it('shoulders with no width record nothing', () => {
    const same = frame({ x: HALF, y: HALF }, true, true, true);
    const flat: PoseLandmarks = { ...same, leftShoulder: landmark(HALF, HALF, true), rightShoulder: landmark(HALF, HALF, true) };
    expect(recordNeutral(createNeutral(), flat, ASPECT).neutral).toBeNull();
  });
});
