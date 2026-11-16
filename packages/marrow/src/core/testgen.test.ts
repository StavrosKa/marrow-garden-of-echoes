import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GAP_MAX_MS,
  genClockFlags,
  genDt,
  genDtClamped,
  genPointerPath,
  type PointerPathStep,
} from './testgen';
import { TUNING } from './tuning';

// A property test is only as strong as its generator, so these check that each
// generator reaches the cases it promises. The fixed seed makes the samples, and so
// these tests, the same on every run.
const SAMPLE = { numRuns: 1000, seed: 42 };
const MAX = TUNING.maxClockStepMs;

describe('testgen', () => {
  it('genDt reaches 0, negative, non-finite, in-range and above-range deltas', () => {
    const values = fc.sample(genDt(), SAMPLE);
    expect({
      zero: values.some((v) => Object.is(v, 0)),
      negative: values.some((v) => Number.isFinite(v) && v < 0),
      nan: values.some((v) => Number.isNaN(v)),
      infinity: values.includes(Infinity),
      minusInfinity: values.includes(-Infinity),
      inRange: values.some((v) => v > 0 && v < MAX),
      aboveRange: values.some((v) => Number.isFinite(v) && v > MAX),
    }).toEqual({
      zero: true,
      negative: true,
      nan: true,
      infinity: true,
      minusInfinity: true,
      inRange: true,
      aboveRange: true,
    });
  });

  it('genDtClamped stays in 0..maxClockStepMs and reaches both ends', () => {
    const values = fc.sample(genDtClamped(), SAMPLE);
    expect(values.filter((v) => !(v >= 0 && v <= MAX))).toEqual([]);
    expect({
      zero: values.some((v) => Object.is(v, 0)),
      max: values.includes(MAX),
      between: values.some((v) => v > 0 && v < MAX),
    }).toEqual({ zero: true, max: true, between: true });
  });

  it('genClockFlags reaches every combination of paused, hidden and holdActive', () => {
    const seen = new Set(
      fc.sample(genClockFlags(), SAMPLE).map((f) => `${f.paused} ${f.hidden} ${f.holdActive}`),
    );
    const all = [false, true].flatMap((p) =>
      [false, true].flatMap((h) => [false, true].map((k) => `${p} ${h} ${k}`)),
    );
    expect([...seen].sort()).toEqual(all.sort());
  });

  it('genPointerPath reaches gaps of 0 and GAP_MAX_MS, deltas of 0 and maxClockStepMs, and valid and invalid samples', () => {
    const paths = fc.sample(genPointerPath(), SAMPLE);
    const steps = paths.flat();
    const inFrame = (v: number): boolean => v >= 0 && v <= 1;

    // Every gap, with its duration: the sum of the deltas of a run of invalid samples.
    // Interior gaps have a valid sample on both sides; they are the ones that reset.
    const gaps = paths.flatMap((path) => {
      const found: { durationMs: number; interior: boolean }[] = [];
      let start = -1;
      path.forEach((step: PointerPathStep, i) => {
        if (!step.valid && start < 0) start = i;
        const ends = start >= 0 && (step.valid || i === path.length - 1);
        if (!ends) return;
        const run = path.slice(start, step.valid ? i : i + 1);
        found.push({
          durationMs: run.reduce((sum, s) => sum + s.dtMs, 0),
          interior: start > 0 && step.valid,
        });
        start = -1;
      });
      return found;
    });
    const interior = gaps.filter((g) => g.interior).map((g) => g.durationMs);

    expect(steps.filter((s) => !(s.dtMs >= 0 && s.dtMs <= MAX))).toEqual([]);
    expect(gaps.filter((g) => !(g.durationMs >= 0 && g.durationMs <= GAP_MAX_MS))).toEqual([]);
    expect(steps.filter((s) => s.valid && !(inFrame(s.pos.x) && inFrame(s.pos.y)))).toEqual([]);
    expect({
      zeroDelta: steps.some((s) => Object.is(s.dtMs, 0)),
      maxDelta: steps.some((s) => s.dtMs === MAX),
      valid: steps.some((s) => s.valid),
      invalid: steps.some((s) => !s.valid),
      invalidOutsideFrame: steps.some((s) => !s.valid && !(inFrame(s.pos.x) && inFrame(s.pos.y))),
      zeroGap: interior.includes(0),
      maxGap: interior.includes(GAP_MAX_MS),
    }).toEqual({
      zeroDelta: true,
      maxDelta: true,
      valid: true,
      invalid: true,
      invalidOutsideFrame: true,
      zeroGap: true,
      maxGap: true,
    });
  });
});
