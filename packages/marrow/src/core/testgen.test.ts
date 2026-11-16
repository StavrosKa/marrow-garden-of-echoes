import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Vec2 } from './frame';
import {
  ASPECT_MAX,
  ASPECT_MIN,
  GAP_MAX_MS,
  OUTSIDE_MARGIN,
  genClockFlags,
  genDt,
  genDtClamped,
  genMappingParams,
  genPointerPath,
  genVec2Camera,
  genVec2Screen,
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

  it('genMappingParams stays in range and reaches A > a, A < a, A = a, both gain ends and the play-area edges for c', () => {
    const params = fc.sample(genMappingParams(), SAMPLE);
    const { reachGainMin, reachGainMax } = TUNING;
    const isAspect = (v: number): boolean => v >= ASPECT_MIN && v <= ASPECT_MAX;

    expect(
      params.filter(
        (p) =>
          !(
            isAspect(p.playAspect) &&
            isAspect(p.frameAspect) &&
            p.gain >= reachGainMin &&
            p.gain <= reachGainMax &&
            p.centre.x >= 0 &&
            p.centre.x <= p.playAspect &&
            p.centre.y >= 0 &&
            p.centre.y <= 1
          ),
      ),
    ).toEqual([]);
    expect({
      playWider: params.some((p) => p.playAspect > p.frameAspect),
      playNarrower: params.some((p) => p.playAspect < p.frameAspect),
      sameAspect: params.some((p) => p.playAspect === p.frameAspect),
      playAspectMin: params.some((p) => p.playAspect === ASPECT_MIN),
      playAspectMax: params.some((p) => p.playAspect === ASPECT_MAX),
      frameAspectMin: params.some((p) => p.frameAspect === ASPECT_MIN),
      frameAspectMax: params.some((p) => p.frameAspect === ASPECT_MAX),
      gainMin: params.some((p) => p.gain === reachGainMin),
      gainMax: params.some((p) => p.gain === reachGainMax),
      gainBetween: params.some((p) => p.gain > reachGainMin && p.gain < reachGainMax),
      centreLeft: params.some((p) => p.centre.x === 0),
      centreRight: params.some((p) => p.centre.x === p.playAspect),
      centreTop: params.some((p) => p.centre.y === 0),
      centreBottom: params.some((p) => p.centre.y === 1),
      centreInside: params.some(
        (p) => p.centre.x > 0 && p.centre.x < p.playAspect && p.centre.y > 0 && p.centre.y < 1,
      ),
    }).toEqual({
      playWider: true,
      playNarrower: true,
      sameAspect: true,
      playAspectMin: true,
      playAspectMax: true,
      frameAspectMin: true,
      frameAspectMax: true,
      gainMin: true,
      gainMax: true,
      gainBetween: true,
      centreLeft: true,
      centreRight: true,
      centreTop: true,
      centreBottom: true,
      centreInside: true,
    });
  });

  it('genVec2Camera stays within OUTSIDE_MARGIN of the frame and reaches in-frame and out-of-frame points and the edges 0 and 1', () => {
    const points = fc.sample(genVec2Camera(), SAMPLE);
    const inUnit = (v: number): boolean => v >= 0 && v <= 1;
    const inBound = (v: number): boolean => v >= -OUTSIDE_MARGIN && v <= 1 + OUTSIDE_MARGIN;
    const inFrame = (p: Vec2): boolean => inUnit(p.x) && inUnit(p.y);

    expect(points.filter((p) => !(inBound(p.x) && inBound(p.y)))).toEqual([]);
    expect({
      inFrame: points.some(inFrame),
      outOfFrame: points.some((p) => !inFrame(p)),
      outsideOnXOnly: points.some((p) => !inUnit(p.x) && inUnit(p.y)),
      outsideOnYOnly: points.some((p) => inUnit(p.x) && !inUnit(p.y)),
      xZero: points.some((p) => p.x === 0),
      xOne: points.some((p) => p.x === 1),
      yZero: points.some((p) => p.y === 0),
      yOne: points.some((p) => p.y === 1),
    }).toEqual({
      inFrame: true,
      outOfFrame: true,
      outsideOnXOnly: true,
      outsideOnYOnly: true,
      xZero: true,
      xOne: true,
      yZero: true,
      yOne: true,
    });
  });

  it('genVec2Screen stays within OUTSIDE_MARGIN of the play area and reaches points inside and outside it and its edges', () => {
    const samples = fc.sample(
      genMappingParams().chain(({ playAspect }) =>
        genVec2Screen(playAspect).map((s) => ({ A: playAspect, s })),
      ),
      SAMPLE,
    );
    const inArea = ({ A, s }: { A: number; s: Vec2 }): boolean =>
      s.x >= 0 && s.x <= A && s.y >= 0 && s.y <= 1;
    const inBound = ({ A, s }: { A: number; s: Vec2 }): boolean =>
      s.x >= -OUTSIDE_MARGIN &&
      s.x <= A + OUTSIDE_MARGIN &&
      s.y >= -OUTSIDE_MARGIN &&
      s.y <= 1 + OUTSIDE_MARGIN;

    expect(samples.filter((sample) => !inBound(sample))).toEqual([]);
    expect({
      inside: samples.some(inArea),
      outside: samples.some((sample) => !inArea(sample)),
      left: samples.some(({ s }) => s.x === 0),
      right: samples.some(({ A, s }) => s.x === A),
      top: samples.some(({ s }) => s.y === 0),
      bottom: samples.some(({ s }) => s.y === 1),
    }).toEqual({ inside: true, outside: true, left: true, right: true, top: true, bottom: true });
  });
});
