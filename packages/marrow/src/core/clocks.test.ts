import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { presenceDelta, sessionDelta, stepClocks } from './clocks';
import { genClockFlags, genDt } from './testgen';
import { TUNING } from './tuning';

// maxClockStepMs always comes from TUNING. The other numbers are 0, the nearest
// numbers past an edge and the non-finite values, tested on purpose.

/** The largest presence delta. */
const MAX = TUNING.maxClockStepMs;
/** Neither paused nor hidden. */
const RUNNING = { paused: false, hidden: false };

/** The nearest number above x, for a positive finite x: the next bit pattern up. */
function nextUp(x: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}

/** The nearest number above maxClockStepMs. */
const JUST_ABOVE_MAX = nextUp(MAX);

describe('presenceDelta (Req 16.2, 16.3)', () => {
  it('is 0 for a raw delta of exactly 0', () => {
    expect(presenceDelta(0, RUNNING, TUNING)).toBe(0);
  });

  it('keeps the smallest positive raw delta', () => {
    expect(presenceDelta(Number.MIN_VALUE, RUNNING, TUNING)).toBe(Number.MIN_VALUE);
  });

  it('keeps a raw delta of exactly maxClockStepMs', () => {
    expect(presenceDelta(MAX, RUNNING, TUNING)).toBe(MAX);
  });

  it('clamps the nearest number above maxClockStepMs to maxClockStepMs', () => {
    expect(JUST_ABOVE_MAX).toBeGreaterThan(MAX);
    expect(presenceDelta(JUST_ABOVE_MAX, RUNNING, TUNING)).toBe(MAX);
  });

  it('takes maxClockStepMs from the tuning argument', () => {
    const higher = { ...TUNING, maxClockStepMs: JUST_ABOVE_MAX };
    expect(presenceDelta(JUST_ABOVE_MAX, RUNNING, higher)).toBe(JUST_ABOVE_MAX);
  });

  it('treats a negative raw delta as 0', () => {
    expect(presenceDelta(-Number.MIN_VALUE, RUNNING, TUNING)).toBe(0);
    expect(presenceDelta(-MAX, RUNNING, TUNING)).toBe(0);
  });

  it('treats NaN as 0', () => {
    expect(presenceDelta(NaN, RUNNING, TUNING)).toBe(0);
  });

  it('treats Infinity as 0, not as maxClockStepMs', () => {
    expect(presenceDelta(Infinity, RUNNING, TUNING)).toBe(0);
  });

  it('treats -Infinity as 0', () => {
    expect(presenceDelta(-Infinity, RUNNING, TUNING)).toBe(0);
  });

  it('is 0 while paused', () => {
    expect(presenceDelta(MAX, { paused: true, hidden: false }, TUNING)).toBe(0);
  });

  it('is 0 while hidden', () => {
    expect(presenceDelta(MAX, { paused: false, hidden: true }, TUNING)).toBe(0);
  });

  it('is 0 while paused and hidden', () => {
    expect(presenceDelta(MAX, { paused: true, hidden: true }, TUNING)).toBe(0);
  });
});

describe('sessionDelta (Req 16.4, 16.5)', () => {
  it('is 0 during a tracking hold', () => {
    expect(sessionDelta(MAX, true)).toBe(0);
  });

  it('equals the presence delta without a hold', () => {
    expect(sessionDelta(MAX, false)).toBe(MAX);
    expect(sessionDelta(0, false)).toBe(0);
  });
});

describe('stepClocks (Req 16.1, 16.3, 16.4, 16.5)', () => {
  // A raw delta inside the range and one above it, with the delta each clamps to.
  const DELTAS = [
    { raw: MAX / 2, clamped: MAX / 2 },
    { raw: 2 * MAX, clamped: MAX },
  ];

  for (const paused of [false, true]) {
    for (const hidden of [false, true]) {
      for (const holdActive of [false, true]) {
        const suspended = paused || hidden;
        const rule = suspended
          ? 'presence 0 and session 0 (Req 16.3)'
          : holdActive
            ? 'presence clamped, session 0 (Req 16.5)'
            : 'presence and session clamped (Req 16.4)';
        it(`paused ${paused}, hidden ${hidden}, holdActive ${holdActive}: ${rule}`, () => {
          for (const { raw, clamped } of DELTAS) {
            const presenceDt = suspended ? 0 : clamped;
            const sessionDt = suspended || holdActive ? 0 : clamped;
            expect(stepClocks(raw, { paused, hidden, holdActive }, TUNING)).toEqual({
              presenceDt,
              sessionDt,
            });
          }
        });
      }
    }
  }
});

// Req 16.6: for all sequences of raw deltas and flags, presence is in
// 0..maxClockStepMs and session is in 0..presence.
it('clocks_delta_bounds', () => {
  fc.assert(
    fc.property(fc.array(fc.tuple(genDt(), genClockFlags())), (steps) => {
      for (const [raw, flags] of steps) {
        const { presenceDt, sessionDt } = stepClocks(raw, flags, TUNING);
        expect(presenceDt).toBeGreaterThanOrEqual(0);
        expect(presenceDt).toBeLessThanOrEqual(MAX);
        expect(sessionDt).toBeGreaterThanOrEqual(0);
        expect(sessionDt).toBeLessThanOrEqual(presenceDt);
      }
    }),
  );
});
