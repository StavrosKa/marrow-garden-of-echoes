// fast-check generators for the core property tests (design section 10.1). Test
// code only: reached by relative import, never exported from marrow/core. Generator
// ranges are test parameters, not tuning values (requirements Appendix B).
import fc from 'fast-check';
import type { ClockFlags } from './clocks';
import {
  addSample,
  cellRectCamera,
  createGrid,
  validCells,
  type CellIndex,
  type ComfortGrid,
} from './comfortGrid';
import type { Landmark, Vec2 } from './frame';
import { clamp } from './geometry';
import type { MappingParams } from './mapping';
import type { Demand } from './placement';
import { TUNING } from './tuning';

/**
 * Raw frame deltas for the clocks (Req 16.2, 16.6): exactly 0 and -0, NaN and both
 * infinities, numbers from -maxClockStepMs to three times maxClockStepMs, and any
 * other number.
 */
export function genDt(): fc.Arbitrary<number> {
  const max = TUNING.maxClockStepMs;
  return fc.oneof(
    fc.constantFrom(0, -0, NaN, Infinity, -Infinity),
    fc.double({ min: -max, max: 3 * max, noNaN: true }),
    fc.double(),
  );
}

/** Deltas the clocks can return, for the reducers: 0..maxClockStepMs, both ends included. */
export function genDtClamped(): fc.Arbitrary<number> {
  const max = TUNING.maxClockStepMs;
  return fc.oneof(fc.constantFrom(0, max), fc.double({ min: 0, max, noNaN: true }));
}

/** The flags of one clock step, in every combination of paused, hidden and holdActive. */
export function genClockFlags(): fc.Arbitrary<ClockFlags> {
  return fc.record({ paused: fc.boolean(), hidden: fc.boolean(), holdActive: fc.boolean() });
}

/** One consumed frame of one wrist: its sample and the presence time since the previous frame. */
export interface PointerPathStep extends Landmark {
  /** Presence time since the previous consumed frame, in milliseconds (Req 8.2). */
  readonly dtMs: number;
}

/** The longest gap genPointerPath makes, in milliseconds of presence time (design section 10.1). */
export const GAP_MAX_MS = 2000;

/** A camera-space coordinate, 0..1 with both edges: where a valid landmark lies (Req 2.5). */
function genUnit(): fc.Arbitrary<number> {
  return fc.oneof(fc.constantFrom(0, 1), fc.double({ min: 0, max: 1, noNaN: true }));
}

/** Any position at all, NaN and infinities included: what an invalid landmark may carry. */
function genAnyPos(): fc.Arbitrary<Vec2> {
  return fc.record({ x: fc.double(), y: fc.double() });
}

/** One to ten valid samples in camera space, each with a delta from genDtClamped. */
function genValidRun(): fc.Arbitrary<PointerPathStep[]> {
  const step = fc
    .record({ dtMs: genDtClamped(), pos: fc.record({ x: genUnit(), y: genUnit() }) })
    .map(({ dtMs, pos }) => ({ dtMs, pos, valid: true }));
  return fc.array(step, { minLength: 1, maxLength: 10 });
}

/**
 * The first parts, in order, while their sum stays within durationMs, then steps of
 * `step` and a remainder up to durationMs. Never empty: a gap has at least one sample.
 */
function splitDuration(durationMs: number, parts: readonly number[], step: number): number[] {
  const deltas: number[] = [];
  let sum = 0;
  for (const part of parts) {
    if (sum + part > durationMs) break;
    deltas.push(part);
    sum += part;
  }
  while (sum < durationMs) {
    const part = Math.min(step, durationMs - sum);
    deltas.push(part);
    sum += part;
  }
  return deltas.length > 0 ? deltas : [0];
}

/**
 * One gap: invalid samples at any position. Their deltas are whole milliseconds, so
 * their sum, the gap's duration, is exact: exactly 0, exactly GAP_MAX_MS, or a whole
 * number in between.
 */
function genGap(): fc.Arbitrary<PointerPathStep[]> {
  const step = Math.floor(TUNING.maxClockStepMs);
  const duration = fc.oneof(
    fc.constantFrom(0, GAP_MAX_MS),
    fc.integer({ min: 0, max: GAP_MAX_MS }),
  );
  const parts = fc.array(fc.integer({ min: 0, max: step }), { maxLength: 30 });
  return fc.tuple(duration, parts).chain(([durationMs, chosen]) =>
    fc.tuple(
      ...splitDuration(durationMs, chosen, step).map((dtMs) =>
        genAnyPos().map((pos) => ({ dtMs, pos, valid: false })),
      ),
    ),
  );
}

/**
 * One wrist's samples over consecutive consumed frames (Req 8): runs of valid
 * samples in camera space, separated by gaps of invalid samples. A gap's duration is
 * the sum of the deltas of its invalid samples, 0..GAP_MAX_MS, and two gaps are never
 * next to each other. Every delta is in 0..maxClockStepMs, and 0 is common. A path
 * may start with a gap and may end with one.
 */
export function genPointerPath(): fc.Arbitrary<PointerPathStep[]> {
  return fc
    .record({
      lead: fc.option(genGap(), { nil: undefined }),
      body: fc.array(fc.tuple(genValidRun(), genGap()), { minLength: 1, maxLength: 5 }),
      tail: fc.option(genValidRun(), { nil: undefined }),
    })
    .map(({ lead, body, tail }) => [...(lead ?? []), ...body.flat(2), ...(tail ?? [])]);
}

/**
 * The range of the play aspect A and of the frame aspect a in the mapping properties
 * (Req 10.3, 14.8). Test parameters, not tuning values (requirements Appendix B).
 */
export const ASPECT_MIN = 1.0;
export const ASPECT_MAX = 2.4;

/**
 * How far outside its space a point from genVec2Camera or genVec2Screen can lie, on
 * each axis. With 1, camera points lie in -1..2 on both axes, and screen points in
 * -1..A + 1 on x and -1..2 on y. A test parameter, not a tuning value. It is finite,
 * so no point holds NaN or an infinity.
 */
export const OUTSIDE_MARGIN = 1;

/** Camera space is 0..1 on each axis, and screen space is 0..1 on y (glossary). Geometry, not a tuning value. */
const UNIT_EXTENT = 1;

/** A number in lo..hi, with lo and hi themselves drawn often. */
function genClosed(lo: number, hi: number): fc.Arbitrary<number> {
  return fc.oneof(fc.constantFrom(lo, hi), fc.double({ min: lo, max: hi, noNaN: true }));
}

/**
 * A coordinate on an axis of a space that spans 0..extent: inside it, with both edges
 * drawn often, or anywhere from OUTSIDE_MARGIN below it to OUTSIDE_MARGIN above it.
 */
function genAxis(extent: number): fc.Arbitrary<number> {
  return fc.oneof(
    genClosed(0, extent),
    fc.double({ min: -OUTSIDE_MARGIN, max: extent + OUTSIDE_MARGIN, noNaN: true }),
  );
}

/**
 * Mapping parameters (Req 10.3, 14.8): A and a in ASPECT_MIN..ASPECT_MAX, the gain in
 * reachGainMin..reachGainMax, and the centre inside the play area [0, A] x [0, 1].
 * Every range includes its ends, and the ends are drawn often. In some samples a
 * equals A exactly, so A > a, A < a and A = a all occur.
 */
export function genMappingParams(): fc.Arbitrary<MappingParams> {
  const aspect = genClosed(ASPECT_MIN, ASPECT_MAX);
  return fc
    .record({
      playAspect: aspect,
      // undefined stands for a frame aspect equal to the play aspect.
      frameAspect: fc.option(aspect, { nil: undefined }),
      gain: genClosed(TUNING.reachGainMin, TUNING.reachGainMax),
      // The centre as fractions of the play area's width and height. A fraction of
      // exactly 1 gives exactly A, and no fraction gives more than A.
      centre: fc.record({ x: genUnit(), y: genUnit() }),
    })
    .map(({ playAspect, frameAspect, gain, centre }) => ({
      playAspect,
      frameAspect: frameAspect ?? playAspect,
      gain,
      centre: { x: centre.x * playAspect, y: centre.y },
    }));
}

/**
 * A camera-space point (Req 10.3). Each coordinate lies in the frame, 0..1 with both
 * edges, or outside it within OUTSIDE_MARGIN. So points occur inside the frame,
 * outside it on one axis, and outside it on both. Never NaN or infinite.
 */
export function genVec2Camera(): fc.Arbitrary<Vec2> {
  return fc.record({ x: genAxis(UNIT_EXTENT), y: genAxis(UNIT_EXTENT) });
}

/**
 * A screen-space point for the play aspect A (Req 10.3). Each coordinate lies in the
 * play area [0, A] x [0, 1], with every edge, or outside it within OUTSIDE_MARGIN.
 * Never NaN or infinite.
 */
export function genVec2Screen(playAspect: number): fc.Arbitrary<Vec2> {
  return fc.record({ x: genAxis(playAspect), y: genAxis(UNIT_EXTENT) });
}

/**
 * How many steps genEven divides its range into: Number.MAX_SAFE_INTEGER, finer than the
 * spacing of doubles in any range these generators use. A test parameter.
 */
const EVEN_STEPS = Number.MAX_SAFE_INTEGER;

/**
 * How near an end genSpread's near-end draws lie, as a share of the range's width: 2^-20,
 * about 1e-6. A test parameter.
 */
export const NEAR_END_SHARE = 2 ** -20;

/**
 * A number spread evenly over lo..hi, both included: k / EVEN_STEPS of the way from lo to
 * hi, for a whole k drawn with fc.noBias. Without it fast-check favours small k, and so
 * values near lo. Exactly lo at k = 0 and exactly hi at k = EVEN_STEPS.
 */
function genEven(lo: number, hi: number): fc.Arbitrary<number> {
  return fc.noBias(fc.integer({ min: 0, max: EVEN_STEPS })).map((k) => {
    const t = k / EVEN_STEPS;
    return clamp(lo * (1 - t) + hi * t, lo, hi);
  });
}

/** A number within (hi - lo) * NEAR_END_SHARE of lo or of hi, inside lo..hi; often the end itself. */
function genNearEnd(lo: number, hi: number): fc.Arbitrary<number> {
  const width = (hi - lo) * NEAR_END_SHARE;
  return fc
    .tuple(fc.boolean(), fc.double({ min: 0, max: width, noNaN: true }))
    .map(([nearHi, offset]) => (nearHi ? hi - offset : lo + offset));
}

/**
 * A number in lo..hi, both included, that covers the whole range: lo or hi exactly
 * (weight 1), a number spread evenly between them (weight 3), or one within
 * NEAR_END_SHARE of the range's width from an end (weight 1).
 *
 * Use this, not fc.double, for a number in a range. fc.double spreads its draws evenly
 * over bit patterns, not values, so a range that starts at 0 is dominated by tiny numbers:
 * over 0..1 about 91% of its draws lie below 1e-6, and the middle half of the range is
 * almost never drawn (seed 42, 1000 samples). Within one binade, such as 1..1.6, its draws
 * are even. The generators above this one still draw with fc.double.
 */
export function genSpread(lo: number, hi: number): fc.Arbitrary<number> {
  return fc.oneof(
    { arbitrary: fc.constantFrom(lo, hi), weight: 1 },
    { arbitrary: genEven(lo, hi), weight: 3 },
    { arbitrary: genNearEnd(lo, hi), weight: 1 },
  );
}

/** A cell of a grid of TUNING's size: column 0..gridCols - 1 and row 0..gridRows - 1. */
function genCell(): fc.Arbitrary<CellIndex> {
  return fc.record({
    col: fc.integer({ min: 0, max: TUNING.gridCols - 1 }),
    row: fc.integer({ min: 0, max: TUNING.gridRows - 1 }),
  });
}

/**
 * The most cells a small block of genGrid reaches over on each axis. About half the
 * blocks are no larger, so that several blocks often lie apart. A test parameter.
 */
const SMALL_BLOCK = 4;

/** A block's length on an axis of n cells: 1..n, and at most SMALL_BLOCK in about half the samples. */
function genLength(n: number): fc.Arbitrary<number> {
  return fc.oneof(
    fc.integer({ min: 1, max: Math.min(SMALL_BLOCK, n) }),
    fc.integer({ min: 1, max: n }),
  );
}

/** One block of genGrid: a rectangle of cells from its first cell, and the samples each of its cells holds. */
interface Block {
  readonly first: CellIndex;
  readonly width: number;
  readonly height: number;
  readonly samples: number;
}

/**
 * A comfort grid of TUNING's size, gridCols x gridRows (Req 11.1, design section 10.1),
 * never marked all-valid. Up to 5 blocks of cells, each holding cellValidSamples to
 * twice cellValidSamples samples, are cut off at the grid's edges; blocks may overlap
 * and merge. Then up to 30 single cells get 0 to cellValidSamples - 1 samples, which
 * punches holes in the blocks and leaves cells short of valid between them. So the
 * samples include grids with no valid cell, with one, with several separate valid
 * regions, with holes, and with valid cells on every edge of the frame.
 */
export function genGrid(): fc.Arbitrary<ComfortGrid> {
  const needed = TUNING.cellValidSamples;
  const block: fc.Arbitrary<Block> = fc.record({
    first: genCell(),
    width: genLength(TUNING.gridCols),
    height: genLength(TUNING.gridRows),
    samples: fc.integer({ min: needed, max: 2 * needed }),
  });
  const shortCell = fc.record({ cell: genCell(), samples: fc.integer({ min: 0, max: needed - 1 }) });
  return fc
    .record({
      blocks: fc.array(block, { maxLength: 5 }),
      shortCells: fc.array(shortCell, { maxLength: 30 }),
    })
    .map(({ blocks, shortCells }) => {
      const empty = createGrid(TUNING);
      const { cols, rows } = empty;
      const counts = [...empty.counts];
      for (const { first, width, height, samples } of blocks) {
        for (let row = first.row; row < Math.min(first.row + height, rows); row++) {
          for (let col = first.col; col < Math.min(first.col + width, cols); col++) {
            counts[row * cols + col] = samples;
          }
        }
      }
      for (const { cell, samples } of shortCells) counts[cell.row * cols + cell.col] = samples;
      return { ...empty, counts };
    });
}

/** The camera-space centre of a cell of a grid of TUNING's size, halfway between its edges. */
function cellCentre({ col, row }: CellIndex): Vec2 {
  const { x0, y0, x1, y1 } = cellRectCamera(col, row, TUNING);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/**
 * The transformer that only adds samples (Req 14.9, design section 10.1). For a grid of
 * TUNING's size: the grid after 1 to cellValidSamples more samples in each of 1 to 10
 * cells, added with addSample at the cells' centres. No count goes down and the
 * all-valid mark stays as it is, so a valid cell stays valid; a cell turns valid once
 * it holds cellValidSamples.
 */
export function promote(grid: ComfortGrid): fc.Arbitrary<ComfortGrid> {
  const addition = fc.record({
    cell: genCell(),
    samples: fc.integer({ min: 1, max: TUNING.cellValidSamples }),
  });
  return fc.array(addition, { minLength: 1, maxLength: 10 }).map((additions) => {
    let result = grid;
    for (const { cell, samples } of additions) {
      const pos = cellCentre(cell);
      for (let i = 0; i < samples; i++) result = addSample(result, pos);
    }
    return result;
  });
}

/**
 * The transformer that only removes one valid cell (Req 14.9, design section 10.1). For
 * a grid of TUNING's size: the grid with one of its valid cells left with 0 to
 * cellValidSamples - 1 samples, and every other count as it was. A grid with no valid
 * cell has none to remove and comes back as it is. On a grid marked all-valid every cell
 * stays valid whatever its count, so demote refuses one.
 */
export function demote(grid: ComfortGrid): fc.Arbitrary<ComfortGrid> {
  if (grid.allValid) {
    throw new Error('demote: on a grid marked all-valid no cell can stop being valid');
  }
  const cells = validCells(grid, TUNING);
  if (cells.length === 0) return fc.constant(grid);
  return fc
    .record({
      cell: fc.constantFrom(...cells),
      samples: fc.integer({ min: 0, max: TUNING.cellValidSamples - 1 }),
    })
    .map(({ cell, samples }) => {
      const at = cell.row * grid.cols + cell.col;
      return { ...grid, counts: grid.counts.map((count, i) => (i === at ? samples : count)) };
    });
}

/** The largest parallax margin m genDemand draws: the 0..0.05 of design section 10.1. A test parameter. */
export const MARGIN_MAX = 0.05;

/** The most targets a demand from genDemand asks for. A test parameter. */
export const DEMAND_N_MAX = 4;

/** The most slots in a demand from genDemand: as many as the playground's content file holds (design section 14.4). A test parameter. */
export const DEMAND_SLOTS_MAX = 15;

/**
 * A placement demand for the play aspect A (Req 14.1, design section 10.1): 1 to
 * DEMAND_SLOTS_MAX slots in [0, A] x [0, 1], n in 1..DEMAND_N_MAX (Req 14.1 needs N >= 1),
 * the hit radius r in hitRadiusMin..hitRadiusMax and the margin m in 0..MARGIN_MAX. The
 * coordinates, r and m come from genSpread, so each range is covered at its ends, near
 * them and in the middle. The objects are plain, so structuredClone gives back equal ones.
 */
export function genDemand(playAspect: number): fc.Arbitrary<Demand> {
  const slot = fc.record(
    { x: genSpread(0, playAspect), y: genSpread(0, UNIT_EXTENT) },
    { noNullPrototype: true },
  );
  return fc.record(
    {
      // size 'max': with only maxLength, fast-check's default size never drew more than
      // 12 slots in 1000 samples (seed 42).
      slots: fc.array(slot, { minLength: 1, maxLength: DEMAND_SLOTS_MAX, size: 'max' }),
      n: fc.integer({ min: 1, max: DEMAND_N_MAX }),
      r: genSpread(TUNING.hitRadiusMin, TUNING.hitRadiusMax),
      m: genSpread(0, MARGIN_MAX),
    },
    { noNullPrototype: true },
  );
}
