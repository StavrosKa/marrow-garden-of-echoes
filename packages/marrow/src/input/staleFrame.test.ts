// Tests for the stale-frame helper (Req 4.8, design sections 9.7 and 10.2). Every
// number that is a limit comes from TUNING or from the tuning argument; the other
// numbers are positions and timestamps of the test frames.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TUNING, type PoseFrame, type PoseLandmarks } from '../core';
import { exposeFrame } from './staleFrame';

const NAMES = ['leftWrist', 'rightWrist', 'nose', 'leftShoulder', 'rightShoulder'] as const;
const STALE = TUNING.staleFrameMs;

function frame(t: number, valid = true, aspect = 1.5): PoseFrame {
  const lm = (x: number, y: number) => ({ pos: { x, y }, valid });
  return {
    t,
    aspect,
    landmarks: {
      leftWrist: lm(0.7, 0.6),
      rightWrist: lm(0.3, 0.6),
      nose: lm(0.5, 0.3),
      leftShoulder: lm(0.6, 0.5),
      rightShoulder: lm(0.4, 0.5),
    },
  };
}

function allInvalid(f: PoseFrame): boolean {
  return NAMES.every((name) => !f.landmarks[name].valid);
}
function allValid(f: PoseFrame): boolean {
  return NAMES.every((name) => f.landmarks[name].valid);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the stale-frame helper (Req 4.8)', () => {
  // Valid results, then a stall past staleFrameMs gives exactly one new all-invalid frame, then a fresh result gives another new frame with validity restored.
  it('stale_frame_emits_new_invalid_frame', () => {
    // Scripted: the elapsed time is since the last result.
    const first = frame(1000);
    const second = frame(1050);
    let exposed: PoseFrame | null = null;

    // Two results arrive: each is exposed as it is.
    exposed = exposeFrame(exposed, first, 0, TUNING);
    expect(exposed).toBe(first);
    exposed = exposeFrame(exposed, second, 50, TUNING);
    expect(exposed).toBe(second);

    // No result for a while, up to and including staleFrameMs: the frame stays.
    for (const elapsed of [1, Math.floor(STALE / 2), STALE - 1, STALE]) {
      expect(exposeFrame(exposed, null, elapsed, TUNING)).toBe(second);
    }

    // One millisecond more: a new, different object, every landmark invalid.
    const stale = exposeFrame(exposed, null, STALE + 1, TUNING) as PoseFrame;
    expect(stale).not.toBe(second);
    expect(allInvalid(stale)).toBe(true);
    exposed = stale;

    // It is exposed once: later calls of the same stall return that same object.
    const stalls: PoseFrame[] = [];
    for (const elapsed of [STALE + 2, STALE * 2, STALE * 10]) {
      stalls.push(exposeFrame(exposed, null, elapsed, TUNING) as PoseFrame);
    }
    for (const s of stalls) expect(s).toBe(stale);

    // A fresh result: another new frame, validity restored.
    const fresh = frame(second.t + STALE * 3);
    const back = exposeFrame(exposed, fresh, STALE * 3, TUNING) as PoseFrame;
    expect(back).toBe(fresh);
    expect(back).not.toBe(stale);
    expect(back).not.toBe(second);
    expect(allValid(back)).toBe(true);
  });

  it('a second stall gives a second new all-invalid frame, a different object from the first', () => {
    const a = frame(0);
    const firstStall = exposeFrame(a, null, STALE + 1, TUNING) as PoseFrame;
    const b = frame(5000);
    const resumed = exposeFrame(firstStall, b, 0, TUNING) as PoseFrame;
    const secondStall = exposeFrame(resumed, null, STALE + 1, TUNING) as PoseFrame;
    expect(secondStall).not.toBe(firstStall);
    expect(secondStall).not.toBe(resumed);
    expect(allInvalid(secondStall)).toBe(true);
    expect(exposeFrame(secondStall, null, STALE * 5, TUNING)).toBe(secondStall);
  });
});

describe('the boundary', () => {
  it('a result exactly staleFrameMs old is not stale, one millisecond more is', () => {
    const f = frame(100);
    expect(exposeFrame(f, null, STALE, TUNING)).toBe(f);
    const stale = exposeFrame(f, null, STALE + 1, TUNING) as PoseFrame;
    expect(stale).not.toBe(f);
    expect(allInvalid(stale)).toBe(true);
  });

  it('a fraction of a millisecond past the limit is stale, and just under it is not', () => {
    const f = frame(100);
    expect(exposeFrame(f, null, STALE - 1e-9, TUNING)).toBe(f);
    expect(exposeFrame(f, null, STALE + 1e-9, TUNING)).not.toBe(f);
  });

  it('is stale exactly when the elapsed time is above staleFrameMs, over a sweep', () => {
    const f = frame(0);
    for (let elapsed = 0; elapsed <= STALE * 3; elapsed += 7) {
      const out = exposeFrame(f, null, elapsed, TUNING);
      expect(out === f, `elapsed ${elapsed}`).toBe(!(elapsed > STALE));
    }
  });

  it('reads the limit from the tuning argument', () => {
    const limit = STALE * 2;
    const tuning = { staleFrameMs: limit };
    const f = frame(0);
    expect(exposeFrame(f, null, STALE + 1, tuning)).toBe(f);
    expect(exposeFrame(f, null, limit, tuning)).toBe(f);
    expect(exposeFrame(f, null, limit + 1, tuning)).not.toBe(f);
    const small = { staleFrameMs: Math.floor(STALE / 5) };
    expect(exposeFrame(f, null, small.staleFrameMs, small)).toBe(f);
    expect(exposeFrame(f, null, small.staleFrameMs + 1, small)).not.toBe(f);
  });

  it('a non-finite elapsed time: NaN is not stale, infinity is', () => {
    const f = frame(0);
    expect(exposeFrame(f, null, Number.NaN, TUNING)).toBe(f);
    expect(exposeFrame(f, null, Number.POSITIVE_INFINITY, TUNING)).not.toBe(f);
  });

  it('a negative elapsed time is not stale', () => {
    const f = frame(0);
    expect(exposeFrame(f, null, -STALE * 2, TUNING)).toBe(f);
  });
});

describe('the stale frame', () => {
  it('has every landmark invalid, the aspect of the frame, and no object shared with it', () => {
    const f = frame(40, true, 1.777);
    const stale = exposeFrame(f, null, STALE + 1, TUNING) as PoseFrame;
    expect(allInvalid(stale)).toBe(true);
    expect(stale.aspect).toBe(1.777);
    expect(stale.landmarks).not.toBe(f.landmarks);
    for (const name of NAMES) {
      expect(stale.landmarks[name]).not.toBe(f.landmarks[name]);
      expect(stale.landmarks[name].pos).not.toBe(f.landmarks[name].pos);
    }
  });

  it('is at the time of the stall: the last result time plus the elapsed time', () => {
    const f = frame(1234);
    const stale = exposeFrame(f, null, STALE + 17, TUNING) as PoseFrame;
    expect(stale.t).toBe(1234 + STALE + 17);
  });

  it('keeps finite positions for every landmark, which are not to be read', () => {
    const stale = exposeFrame(frame(0), null, STALE + 1, TUNING) as PoseFrame;
    for (const name of NAMES) {
      expect(Number.isFinite(stale.landmarks[name].pos.x)).toBe(true);
      expect(Number.isFinite(stale.landmarks[name].pos.y)).toBe(true);
    }
  });

  it('a frame with some landmarks valid, and some not, becomes all invalid', () => {
    const mixed: PoseFrame = {
      ...frame(0),
      landmarks: {
        ...frame(0).landmarks,
        leftWrist: { pos: { x: 0, y: 0 }, valid: false },
        nose: { pos: { x: 0.5, y: 0.2 }, valid: true },
      } satisfies PoseLandmarks,
    };
    const stale = exposeFrame(mixed, null, STALE + 1, TUNING) as PoseFrame;
    expect(stale).not.toBe(mixed);
    expect(allInvalid(stale)).toBe(true);
  });
});

describe('a frame with only one valid landmark', () => {
  for (const only of NAMES) {
    it(`still goes stale when only ${only} is valid`, () => {
      const base = frame(0, false);
      const f: PoseFrame = {
        ...base,
        landmarks: { ...base.landmarks, [only]: { pos: { x: 0.5, y: 0.5 }, valid: true } },
      };
      const stale = exposeFrame(f, null, STALE + 1, TUNING) as PoseFrame;
      expect(stale).not.toBe(f);
      expect(allInvalid(stale)).toBe(true);
    });
  }
});

describe('results and the first frame', () => {
  it('a result is exposed as it is, also when it is all invalid, and also after a long wait', () => {
    const prev = frame(0);
    const invalidResult = frame(10, false);
    expect(exposeFrame(prev, invalidResult, 0, TUNING)).toBe(invalidResult);
    const late = frame(STALE * 9);
    expect(exposeFrame(prev, late, STALE * 9, TUNING)).toBe(late);
    expect(exposeFrame(null, late, STALE * 9, TUNING)).toBe(late);
  });

  it('nothing before the first result, however long it takes', () => {
    for (const elapsed of [0, STALE, STALE + 1, STALE * 100]) {
      expect(exposeFrame(null, null, elapsed, TUNING)).toBeNull();
    }
  });

  it('a stall after a result that was all invalid already exposes that frame again (decision)', () => {
    // Every landmark is already invalid in it, so the pointer is invalid and a hold can
    // begin; the helper has no way to tell this frame from a stale one.
    const invalidResult = frame(10, false);
    expect(exposeFrame(invalidResult, null, STALE * 5, TUNING)).toBe(invalidResult);
  });
});

describe('purity', () => {
  it('changes none of its arguments', () => {
    const prev = deepFreeze(frame(10));
    const tuning = deepFreeze({ staleFrameMs: STALE });
    const before = JSON.stringify(prev);
    expect(() => exposeFrame(prev, null, STALE + 1, tuning)).not.toThrow();
    expect(() => exposeFrame(prev, null, 0, tuning)).not.toThrow();
    expect(JSON.stringify(prev)).toBe(before);
    expect(allValid(prev)).toBe(true);
  });

  it('gives equal frames, as new objects, for equal arguments', () => {
    const prev = frame(10);
    const a = exposeFrame(prev, null, STALE + 1, TUNING) as PoseFrame;
    const b = exposeFrame(prev, null, STALE + 1, TUNING) as PoseFrame;
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('reads no clock', () => {
    const now = vi.spyOn(Date, 'now');
    const perf = vi.spyOn(performance, 'now');
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const prev = frame(10);
    exposeFrame(prev, null, STALE + 1, TUNING);
    exposeFrame(prev, frame(20), 0, TUNING);
    exposeFrame(prev, null, 0, TUNING);
    expect(now).not.toHaveBeenCalled();
    expect(perf).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
  });
});
