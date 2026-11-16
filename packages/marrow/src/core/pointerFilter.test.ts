import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Landmark, Vec2, WristId } from './frame';
import { createOneEuro, oneEuroStep, type OneEuroConfig } from './oneEuro';
import {
  createPointerFilter,
  resetPointerFilter,
  stepPointerFilter,
  type FilteredPointer,
  type FilteredPointers,
  type PointerFilterState,
  type PointerSample,
} from './pointerFilter';
import { genDt, genPointerPath, type PointerPathStep } from './testgen';
import { TUNING, type Tuning } from './tuning';

// The One Euro parameters and every delta come from TUNING. The positions are test
// inputs. oneEuro.ts, tested on its own against the textbook filter, is the oracle
// for each axis (design section 6).

const MAX = TUNING.maxClockStepMs;
const ONE_EURO_KEYS = ['oneEuroMinCutoffHz', 'oneEuroBeta', 'oneEuroDCutoffHz'] as const;

/** A frame: the wrist samples and the presence time since the previous frame. */
interface Frame {
  readonly sample: PointerSample;
  readonly dtMs: number;
}

const valid = (x: number, y: number): Landmark => ({ valid: true, pos: { x, y } });
/** Invalid samples, one with a position inside the frame and one with NaN. */
const INVALID_INSIDE: Landmark = { valid: false, pos: { x: 0.5, y: 0.5 } };
const INVALID_NAN: Landmark = { valid: false, pos: { x: NaN, y: NaN } };

/** A sample for one wrist only. */
const only = (wrist: WristId, landmark: Landmark): PointerSample =>
  wrist === 'left' ? { left: landmark } : { right: landmark };
const other = (wrist: WristId): WristId => (wrist === 'left' ? 'right' : 'left');

/** A moving path with jumps across the frame, and the delta before each sample. */
const PATH: readonly { pos: Vec2; dtMs: number }[] = [
  { pos: { x: 0.2, y: 0.3 }, dtMs: MAX },
  { pos: { x: 0.8, y: 0.25 }, dtMs: MAX / 2 },
  { pos: { x: 0.75, y: 0.9 }, dtMs: MAX / 4 },
  { pos: { x: 0.1, y: 0.6 }, dtMs: MAX },
  { pos: { x: 0.15, y: 0.55 }, dtMs: MAX / 2 },
  { pos: { x: 1, y: 0 }, dtMs: MAX / 5 },
];

/** Steps the filter over frames; returns the pointers of every frame and the final state. */
function run(frames: readonly Frame[], start: PointerFilterState) {
  let state = start;
  const pointers: FilteredPointers[] = frames.map(({ sample, dtMs }) => {
    const result = stepPointerFilter(state, sample, dtMs);
    state = result.state;
    return result.pointers;
  });
  return { pointers, state };
}

/** PATH as frames of one wrist. */
const pathFrames = (wrist: WristId, path = PATH): Frame[] =>
  path.map(({ pos, dtMs }) => ({ sample: only(wrist, valid(pos.x, pos.y)), dtMs }));

/** The One Euro parameters a tuning object asks for. */
const cfgOf = (t: Tuning): OneEuroConfig => ({
  minCutoffHz: t.oneEuroMinCutoffHz,
  beta: t.oneEuroBeta,
  dCutoffHz: t.oneEuroDCutoffHz,
});

/** The oracle: one One Euro filter on each axis of a path with no gap. */
function oracle(path: readonly { pos: Vec2; dtMs: number }[], cfg: OneEuroConfig): FilteredPointer[] {
  let x = createOneEuro(cfg);
  let y = createOneEuro(cfg);
  return path.map(({ pos, dtMs }) => {
    const nx = oneEuroStep(x, pos.x, dtMs);
    const ny = oneEuroStep(y, pos.y, dtMs);
    x = nx.state;
    y = ny.state;
    return { valid: true, pos: { x: nx.value, y: ny.value } };
  });
}

describe('stepPointerFilter', () => {
  it('outputs the first valid sample of a new filter unchanged, whatever the delta', () => {
    for (const dtMs of [0, Number.MIN_VALUE, MAX]) {
      const { pointers } = stepPointerFilter(createPointerFilter(TUNING), { right: valid(0.3, 0.7) }, dtMs);
      expect(pointers).toEqual({ right: { valid: true, pos: { x: 0.3, y: 0.7 } } });
    }
  });

  it('runs one One Euro filter on each axis with the parameters of TUNING (Req 8.1)', () => {
    const { pointers } = run(pathFrames('right'), createPointerFilter(TUNING));
    expect(pointers.map((p) => p.right)).toEqual(oracle(PATH, cfgOf(TUNING)));
  });

  for (const key of ONE_EURO_KEYS) {
    it(`takes ${key} from the tuning argument`, () => {
      // Adding oneEuroMinCutoffHz, whose range starts above 0, changes every key, even
      // a beta of 0, which validateTuning allows. Doubling would leave 0 at 0.
      const changed: Tuning = { ...TUNING, [key]: TUNING[key] + TUNING.oneEuroMinCutoffHz };
      const expected = oracle(PATH, cfgOf(changed));
      // The change is visible on this path, so a value not read from the argument shows.
      expect(expected).not.toEqual(oracle(PATH, cfgOf(TUNING)));
      const { pointers } = run(pathFrames('right'), createPointerFilter(changed));
      expect(pointers.map((p) => p.right)).toEqual(expected);
    });
  }

  it('a delta of 0 leaves every valid pointer where it was', () => {
    const { pointers, state } = run(pathFrames('right', PATH.slice(0, 3)), createPointerFilter(TUNING));
    const last = pointers[2]?.right;
    const { pointers: after } = stepPointerFilter(state, { right: valid(0.05, 0.05) }, 0);
    expect(after.right).toEqual(last);
  });

  it('gives a finite position for the smallest positive delta and for maxClockStepMs', () => {
    const { state } = run(pathFrames('right', PATH.slice(0, 3)), createPointerFilter(TUNING));
    for (const dtMs of [Number.MIN_VALUE, MAX]) {
      const { pointers } = stepPointerFilter(state, { right: valid(0.05, 0.95) }, dtMs);
      const pointer = pointers.right;
      expect(pointer?.valid).toBe(true);
      if (pointer?.valid !== true) return;
      expect(Number.isFinite(pointer.pos.x) && Number.isFinite(pointer.pos.y)).toBe(true);
    }
  });

  it('outputs the first valid sample after an invalid one unchanged, then goes on like a new filter (Req 8.3)', () => {
    for (const gapDt of [0, MAX]) {
      const before = run(pathFrames('right', PATH.slice(0, 4)), createPointerFilter(TUNING)).state;
      const gap = stepPointerFilter(before, { right: INVALID_INSIDE }, gapDt).state;
      const back = stepPointerFilter(gap, { right: valid(0.9, 0.1) }, gapDt);
      expect(back.pointers.right).toEqual({ valid: true, pos: { x: 0.9, y: 0.1 } });

      const rest = pathFrames('right', PATH.slice(4));
      const fresh = stepPointerFilter(createPointerFilter(TUNING), { right: valid(0.9, 0.1) }, gapDt).state;
      expect(run(rest, back.state).pointers).toEqual(run(rest, fresh).pointers);
    }
  });

  it('a wrist missing from a sample also starts afresh when it comes back', () => {
    const before = run(pathFrames('left', PATH.slice(0, 4)), createPointerFilter(TUNING)).state;
    const { state, pointers } = stepPointerFilter(before, {}, MAX);
    expect(pointers).toEqual({});
    const back = stepPointerFilter(state, { left: valid(0.9, 0.1) }, MAX);
    expect(back.pointers).toEqual({ left: { valid: true, pos: { x: 0.9, y: 0.1 } } });
  });

  it('an invalid wrist gives an invalid pointer with no position field at all (Req 8.7)', () => {
    const fresh = stepPointerFilter(createPointerFilter(TUNING), { right: INVALID_INSIDE }, MAX);
    const before = run(pathFrames('right', PATH.slice(0, 4)), createPointerFilter(TUNING)).state;
    const afterValid = stepPointerFilter(before, { right: INVALID_NAN }, MAX);
    for (const { pointers } of [fresh, afterValid]) {
      expect(pointers.right).toStrictEqual({ valid: false });
      expect(Object.keys(pointers.right ?? {})).toEqual(['valid']);
    }
  });

  it('keeps nothing of an invalid wrist in its state, so no logic can read the last filtered position (Req 8.7)', () => {
    const before = run(pathFrames('right', PATH.slice(0, 4)), createPointerFilter(TUNING)).state;
    const { state } = stepPointerFilter(before, { right: INVALID_INSIDE }, MAX);
    const fresh = stepPointerFilter(createPointerFilter(TUNING), { right: INVALID_INSIDE }, MAX).state;
    expect(state).toStrictEqual(fresh);
  });

  // Checked by the type checker (npm run typecheck). At runtime this test does nothing.
  it('the invalid pointer type has no position (Req 8.7)', () => {
    expectTypeOf<Extract<FilteredPointer, { valid: false }>>().toEqualTypeOf<{ readonly valid: false }>();
  });

  for (const wrist of ['left', 'right'] as const) {
    it(`each wrist has its own filter: a jump or a gap on the ${other(wrist)} wrist leaves the ${wrist} pointer unchanged`, () => {
      const steady = valid(0.5, 0.5);
      const jumps = (i: number): Landmark => (i < 3 ? steady : valid(i % 2 === 0 ? 0 : 1, 1));
      const gaps = (i: number): Landmark => (i === 2 || i === 3 ? INVALID_NAN : steady);
      const frames = (side: (i: number) => Landmark): Frame[] =>
        PATH.map(({ pos, dtMs }, i) => ({
          sample: { [wrist]: valid(pos.x, pos.y), [other(wrist)]: side(i) } as PointerSample,
          dtMs,
        }));
      const outputs = (side: (i: number) => Landmark) =>
        run(frames(side), createPointerFilter(TUNING)).pointers;

      const base = outputs(() => steady);
      expect(base.map((p) => p[wrist])).toEqual(oracle(PATH, cfgOf(TUNING)));
      for (const side of [jumps, gaps]) {
        const changed = outputs(side);
        // The other wrist's own pointer does change...
        expect(changed.map((p) => p[other(wrist)])).not.toEqual(base.map((p) => p[other(wrist)]));
        // ...and this wrist's pointer does not.
        expect(changed.map((p) => p[wrist])).toEqual(base.map((p) => p[wrist]));
      }
    });
  }
});

describe('resetPointerFilter', () => {
  it('makes the next valid sample of each wrist come out unchanged, then the filter goes on like a new one (Req 8.4)', () => {
    const both = (pos: Vec2): PointerSample => ({ left: valid(pos.y, pos.x), right: valid(pos.x, pos.y) });
    const frames: Frame[] = PATH.map(({ pos, dtMs }) => ({ sample: both(pos), dtMs }));
    const before = run(frames.slice(0, 4), createPointerFilter(TUNING)).state;
    const reset = resetPointerFilter(before);

    const resume = { sample: { left: valid(0.95, 0.05), right: valid(0.05, 0.95) }, dtMs: MAX };
    const first = stepPointerFilter(reset, resume.sample, resume.dtMs);
    expect(first.pointers).toEqual({
      left: { valid: true, pos: { x: 0.95, y: 0.05 } },
      right: { valid: true, pos: { x: 0.05, y: 0.95 } },
    });
    const rest = frames.slice(4);
    const fresh = stepPointerFilter(createPointerFilter(TUNING), resume.sample, resume.dtMs).state;
    expect(run(rest, first.state).pointers).toEqual(run(rest, fresh).pointers);
  });

  it('keeps the parameters the filter was created with', () => {
    const changed: Tuning = { ...TUNING, oneEuroMinCutoffHz: 2 * TUNING.oneEuroMinCutoffHz };
    const before = run(pathFrames('right'), createPointerFilter(changed)).state;
    const { pointers } = run(pathFrames('right'), resetPointerFilter(before));
    expect(pointers.map((p) => p.right)).toEqual(oracle(PATH, cfgOf(changed)));
  });
});

/** The right wrist's pointer after each step of a path. */
function rightPointers(path: readonly PointerPathStep[]): (FilteredPointer | undefined)[] {
  return run(
    path.map((step) => ({ sample: { right: step }, dtMs: step.dtMs })),
    createPointerFilter(TUNING),
  ).pointers.map((p) => p.right);
}

// Req 8.5: for all sample sequences that contain an invalid sample, the outputs from
// that sample on are the same for any two sequences that differ only before it.
it('filter_gap_independence', () => {
  fc.assert(
    fc.property(genPointerPath(), genPointerPath(), fc.nat(), (path, otherPrefix, pick) => {
      const gaps = path.flatMap((step, i) => (step.valid ? [] : [i]));
      fc.pre(gaps.length > 0);
      const at = gaps[pick % gaps.length] ?? 0;
      const fromGap = path.slice(at);
      const original = rightPointers(path).slice(at);
      const swapped = rightPointers([...otherPrefix, ...fromGap]).slice(otherPrefix.length);
      expect(swapped).toEqual(original);
    }),
  );
});

// Req 8.6: for all sample sequences, every output is finite. A valid sample gives a
// valid pointer with x and y in 0..1, and an invalid one an invalid pointer. Two
// properties: the path's own deltas (0..maxClockStepMs, 0 common), and the same path
// with each delta drawn from genDt instead (design section 10.2). The delta is the
// presence time since the previous consumed frame, so it can be longer than
// maxClockStepMs; genDt also gives 0, negative and non-finite deltas.
it('filter_finite_outputs', () => {
  const check = (path: readonly PointerPathStep[]): void => {
    rightPointers(path).forEach((pointer, i) => {
      expect(pointer?.valid).toBe(path[i]?.valid);
      if (pointer?.valid === true) {
        expect(Number.isFinite(pointer.pos.x) && Number.isFinite(pointer.pos.y)).toBe(true);
        expect(pointer.pos.x).toBeGreaterThanOrEqual(0);
        expect(pointer.pos.x).toBeLessThanOrEqual(1);
        expect(pointer.pos.y).toBeGreaterThanOrEqual(0);
        expect(pointer.pos.y).toBeLessThanOrEqual(1);
      }
    });
  };

  // The path's own deltas.
  fc.assert(fc.property(genPointerPath(), check));

  // The same path, each step's delta drawn from genDt.
  const withGenDt = genPointerPath().chain((path) =>
    fc.tuple(...path.map((step) => genDt().map((dtMs) => ({ ...step, dtMs })))),
  );
  fc.assert(fc.property(withGenDt, check));
});
