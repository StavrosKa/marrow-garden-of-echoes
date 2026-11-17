import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGrid, isCellValid, markAllValid, validCells, type ComfortGrid } from './comfortGrid';
import type { Vec2 } from './frame';
import {
  ASPECT_MAX,
  ASPECT_MIN,
  DEMAND_N_MAX,
  DEMAND_SLOTS_MAX,
  GAP_MAX_MS,
  MARGIN_MAX,
  NEAR_END_SHARE,
  OUTSIDE_MARGIN,
  demote,
  genClockFlags,
  genDemand,
  genDt,
  genDtClamped,
  genGrid,
  genMappingParams,
  genPointerPath,
  genVec2Camera,
  genVec2Screen,
  promote,
  type PointerPathStep,
} from './testgen';
import { TUNING } from './tuning';

// A property test is only as strong as its generator, so these check that each
// generator reaches the cases it promises. The fixed seed makes the samples, and so
// these tests, the same on every run.
const SAMPLE = { numRuns: 1000, seed: 42 };
const MAX = TUNING.maxClockStepMs;
/** The quarters of a range that the genDemand check counts slot coordinates in. */
const QUARTERS = 4;
/**
 * The least share of slot coordinates genDemand must put in each quarter of an axis, so
 * that a return to fc.double's spread, which leaves the middle quarters almost empty,
 * fails the check. A test parameter.
 */
const MIN_QUARTER_SHARE = 0.1;

/** Whether cell (col, row) is valid at TUNING's threshold; false for a cell outside the grid. */
const validAt = (grid: ComfortGrid, col: number, row: number): boolean => isCellValid(grid, col, row, TUNING);

/**
 * The number of separate valid regions: groups of valid cells joined along a side or at
 * a corner. Two regions counted apart do not touch, not even at a corner.
 */
function regionCount(grid: ComfortGrid): number {
  const seen = new Set<number>();
  let regions = 0;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (!validAt(grid, col, row) || seen.has(row * grid.cols + col)) continue;
      regions += 1;
      seen.add(row * grid.cols + col);
      const stack = [{ col, row }];
      for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const c = cell.col + dc;
            const r = cell.row + dr;
            if (validAt(grid, c, r) && !seen.has(r * grid.cols + c)) {
              seen.add(r * grid.cols + c);
              stack.push({ col: c, row: r });
            }
          }
        }
      }
    }
  }
  return regions;
}

/** Whether some cell that is not valid has a valid cell on each of its four sides: a hole in a region. */
function hasHole(grid: ComfortGrid): boolean {
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (
        !validAt(grid, col, row) &&
        validAt(grid, col - 1, row) &&
        validAt(grid, col + 1, row) &&
        validAt(grid, col, row - 1) &&
        validAt(grid, col, row + 1)
      ) {
        return true;
      }
    }
  }
  return false;
}

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

  it('genGrid has the size of TUNING and reaches no valid cell, one, several separate regions, holes, short cells and valid cells on every edge', () => {
    const grids = fc.sample(genGrid(), SAMPLE);
    const { gridCols: cols, gridRows: rows, cellValidSamples: needed } = TUNING;
    const valid = grids.map((grid) => validCells(grid, TUNING));

    expect(
      grids.filter(
        (grid) =>
          !(
            grid.cols === cols &&
            grid.rows === rows &&
            grid.counts.length === cols * rows &&
            !grid.allValid &&
            grid.counts.every((count) => Number.isInteger(count) && count >= 0)
          ),
      ),
    ).toEqual([]);
    expect({
      noValidCell: valid.some((cells) => cells.length === 0),
      oneValidCell: valid.some((cells) => cells.length === 1),
      severalRegions: grids.some((grid) => regionCount(grid) >= 2),
      hole: grids.some(hasHole),
      shortCell: grids.some((grid) => grid.counts.some((count) => count > 0 && count < needed)),
      exactlyNeeded: grids.some((grid) => grid.counts.includes(needed)),
      aboveNeeded: grids.some((grid) => grid.counts.some((count) => count > needed)),
      firstColumn: valid.some((cells) => cells.some((cell) => cell.col === 0)),
      lastColumn: valid.some((cells) => cells.some((cell) => cell.col === cols - 1)),
      firstRow: valid.some((cells) => cells.some((cell) => cell.row === 0)),
      lastRow: valid.some((cells) => cells.some((cell) => cell.row === rows - 1)),
    }).toEqual({
      noValidCell: true,
      oneValidCell: true,
      severalRegions: true,
      hole: true,
      shortCell: true,
      exactlyNeeded: true,
      aboveNeeded: true,
      firstColumn: true,
      lastColumn: true,
      firstRow: true,
      lastRow: true,
    });
  });

  it('promote only adds samples, at least one, and reaches promotions that make a cell valid and ones that leave every cell as valid as it was', () => {
    const pairs = fc.sample(genGrid().chain((grid) => fc.tuple(fc.constant(grid), promote(grid))), SAMPLE);
    const total = (grid: ComfortGrid): number => grid.counts.reduce((sum, count) => sum + count, 0);
    const validCount = (grid: ComfortGrid): number => validCells(grid, TUNING).length;

    expect(
      pairs.filter(
        ([before, after]) =>
          !(
            after.cols === before.cols &&
            after.rows === before.rows &&
            after.allValid === before.allValid &&
            after.counts.length === before.counts.length &&
            after.counts.every((count, i) => count >= (before.counts[i] ?? Infinity)) &&
            total(after) > total(before)
          ),
      ),
    ).toEqual([]);
    expect({
      newValidCell: pairs.some(([before, after]) => validCount(after) > validCount(before)),
      sameValidCells: pairs.some(([before, after]) => validCount(after) === validCount(before)),
    }).toEqual({ newValidCell: true, sameValidCells: true });
  });

  it('demote leaves exactly one valid cell short of valid and every other count as it was, and returns a grid with no valid cell as it is', () => {
    const needed = TUNING.cellValidSamples;
    const pairs = fc.sample(genGrid().chain((grid) => fc.tuple(fc.constant(grid), demote(grid))), SAMPLE);
    const results = pairs.map(([before, after]) => {
      const changed = before.counts.flatMap((count, i) => (after.counts[i] === count ? [] : [i]));
      const at = changed[0];
      return {
        hadValid: validCells(before, TUNING).length > 0,
        same: after === before,
        sizeAndMark:
          after.cols === before.cols &&
          after.rows === before.rows &&
          after.allValid === before.allValid &&
          after.counts.length === before.counts.length,
        changed: changed.length,
        was: at === undefined ? undefined : before.counts[at],
        now: at === undefined ? undefined : after.counts[at],
        lostValid: validCells(before, TUNING).length - validCells(after, TUNING).length,
      };
    });

    expect(results.filter((r) => !r.hadValid && !r.same)).toEqual([]);
    expect(
      results.filter(
        (r) =>
          r.hadValid &&
          !(
            r.sizeAndMark &&
            r.changed === 1 &&
            r.was !== undefined &&
            r.was >= needed &&
            r.now !== undefined &&
            r.now >= 0 &&
            r.now < needed &&
            r.lostValid === 1
          ),
      ),
    ).toEqual([]);
    expect({
      noValidCell: results.some((r) => !r.hadValid),
      toZero: results.some((r) => r.hadValid && r.now === 0),
      toShort: results.some((r) => r.hadValid && r.now !== undefined && r.now > 0),
    }).toEqual({ noValidCell: true, toZero: true, toShort: true });
  });

  it('demote refuses a grid marked all-valid, on which no cell can stop being valid', () => {
    expect(() => demote(markAllValid(createGrid(TUNING)))).toThrow('all-valid');
  });

  it('genDemand stays in range and reaches, for the slots, both edges, near both edges and at least MIN_QUARTER_SHARE in each quarter of each axis; r and m at both ends and between; n of 1 and DEMAND_N_MAX; 1 and DEMAND_SLOTS_MAX slots; and n above the slot count', () => {
    const samples = fc.sample(
      genMappingParams().chain(({ playAspect }) =>
        genDemand(playAspect).map((demand) => ({ A: playAspect, demand })),
      ),
      SAMPLE,
    );
    const { hitRadiusMin, hitRadiusMax } = TUNING;
    // Each slot coordinate with the extent of its axis: 0..A for x, 0..1 for y.
    const xs = samples.flatMap(({ A, demand }) => demand.slots.map((s) => ({ v: s.x, extent: A })));
    const ys = samples.flatMap(({ demand }) => demand.slots.map((s) => ({ v: s.y, extent: 1 })));
    const quarterShares = (values: readonly { v: number; extent: number }[]): number[] => {
      const counts = [0, 0, 0, 0];
      for (const { v, extent } of values) {
        const quarter = Math.min(QUARTERS - 1, Math.floor((v / extent) * QUARTERS));
        counts[quarter] = (counts[quarter] ?? 0) + 1;
      }
      return counts.map((count) => count / values.length);
    };
    const near = (d: number, extent: number): boolean => d > 0 && d <= extent * NEAR_END_SHARE;
    const reaches = (values: readonly { v: number; extent: number }[]) => ({
      atStart: values.some(({ v }) => v === 0),
      atEnd: values.some(({ v, extent }) => v === extent),
      nearStart: values.some(({ v, extent }) => near(v, extent)),
      nearEnd: values.some(({ v, extent }) => near(extent - v, extent)),
    });
    const allTrue = { atStart: true, atEnd: true, nearStart: true, nearEnd: true };

    expect(
      samples.filter(
        ({ A, demand: { slots, n, r, m } }) =>
          !(
            slots.length >= 1 &&
            slots.length <= DEMAND_SLOTS_MAX &&
            slots.every((s) => s.x >= 0 && s.x <= A && s.y >= 0 && s.y <= 1) &&
            Number.isInteger(n) &&
            n >= 1 &&
            n <= DEMAND_N_MAX &&
            r >= hitRadiusMin &&
            r <= hitRadiusMax &&
            m >= 0 &&
            m <= MARGIN_MAX
          ),
      ),
    ).toEqual([]);
    for (const share of [...quarterShares(xs), ...quarterShares(ys)]) {
      expect(share).toBeGreaterThanOrEqual(MIN_QUARTER_SHARE);
    }
    expect({ x: reaches(xs), y: reaches(ys) }).toEqual({ x: allTrue, y: allTrue });
    const demands = samples.map((s) => s.demand);
    expect({
      rMin: demands.some((d) => d.r === hitRadiusMin),
      rMax: demands.some((d) => d.r === hitRadiusMax),
      rBetween: demands.some((d) => d.r > hitRadiusMin && d.r < hitRadiusMax),
      mZero: demands.some((d) => d.m === 0),
      mMax: demands.some((d) => d.m === MARGIN_MAX),
      mBetween: demands.some((d) => d.m > 0 && d.m < MARGIN_MAX),
      nOne: demands.some((d) => d.n === 1),
      nMax: demands.some((d) => d.n === DEMAND_N_MAX),
      oneSlot: demands.some((d) => d.slots.length === 1),
      mostSlots: demands.some((d) => d.slots.length === DEMAND_SLOTS_MAX),
      moreTargetsThanSlots: demands.some((d) => d.n > d.slots.length),
    }).toEqual({
      rMin: true,
      rMax: true,
      rBetween: true,
      mZero: true,
      mMax: true,
      mBetween: true,
      nOne: true,
      nMax: true,
      oneSlot: true,
      mostSlots: true,
      moreTargetsThanSlots: true,
    });
  });
});
