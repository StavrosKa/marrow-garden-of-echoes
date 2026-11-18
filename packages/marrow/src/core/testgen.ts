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
import type { NeutralHead } from './calibration';
import type { HitArea, PointerInput } from './dwell';
import type { Landmark, PoseLandmarks, Vec2, WristId } from './frame';
import { clamp } from './geometry';
import type { HelpEvent, HelpFlags } from './help';
import type { MappingParams } from './mapping';
import type { Demand } from './placement';
import { SETTINGS_VERSION } from './settings';
import { TUNING } from './tuning';

/**
 * Raw frame deltas for the clocks (Req 16.2, 16.6): exactly 0 and -0, NaN and both
 * infinities, numbers from -maxClockStepMs to three times maxClockStepMs, and any
 * other number.
 */
export function genDt(): fc.Arbitrary<number> {
  const max = TUNING.maxClockStepMs;
  // Weights 1, 4, 1. With equal weights the zeros and the any-double branch, whose draws
  // in the range are mostly tiny, left only 6% of the draws in the range in its third
  // quarter (seed 42, 1000 samples); the coverage check in testgen.test.ts needs 10%.
  return fc.oneof(
    { arbitrary: fc.constantFrom(0, -0, NaN, Infinity, -Infinity), weight: 1 },
    { arbitrary: genSpread(-max, 3 * max), weight: 4 },
    // Not a number in a range: any double at all, huge and tiny ones included.
    { arbitrary: fc.double(), weight: 1 },
  );
}

/** Deltas the clocks can return, for the reducers: 0..maxClockStepMs, both ends included. */
export function genDtClamped(): fc.Arbitrary<number> {
  return genSpread(0, TUNING.maxClockStepMs);
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
export function genUnit(): fc.Arbitrary<number> {
  return genSpread(0, UNIT_EXTENT);
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
export function genClosed(lo: number, hi: number): fc.Arbitrary<number> {
  return genSpread(lo, hi);
}

/**
 * A coordinate on an axis of a space that spans 0..extent: inside it, with both edges
 * drawn often, or anywhere from OUTSIDE_MARGIN below it to OUTSIDE_MARGIN above it.
 */
export function genAxis(extent: number): fc.Arbitrary<number> {
  return fc.oneof(genClosed(0, extent), genSpread(-OUTSIDE_MARGIN, extent + OUTSIDE_MARGIN));
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
 * are even. The fc.double left in this file draws numbers that have no range: genDt's
 * any-double branch and the positions of invalid landmarks.
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

/** The range of the neutral nose's x and y in genHeadFrames, in camera space. A test parameter. */
export const HEAD_NEUTRAL_MIN = 0.3;
export const HEAD_NEUTRAL_MAX = 0.7;
/** The range of the neutral shoulder width in genHeadFrames, in aspect-corrected units. A test parameter. */
export const HEAD_WIDTH_MIN = 0.1;
export const HEAD_WIDTH_MAX = 0.25;
/** The range of a shoulder's x and y in genHeadFrames, in camera space. A test parameter. */
export const HEAD_SHOULDER_MIN = 0.1;
export const HEAD_SHOULDER_MAX = 0.9;
/** How far past headClamp the offsets of genHeadFrames reach, as a multiple of headClamp. A test parameter. */
export const HEAD_REACH = 1.5;
/** How near headDeadZone and headClamp the offsets near them lie, as a share of headDeadZone. A test parameter. */
export const HEAD_EDGE_SHARE = 0.5;
/** The most steps in one run of genHeadFrames with the nose valid or with it invalid. A test parameter. */
export const HEAD_RUN_MAX = 12;
/** The most runs in a genHeadFrames sequence. A test parameter. */
export const HEAD_RUNS_MAX = 6;

/** One step of a genHeadFrames sequence: the head's offset, whether the nose is valid, the delta, and two sets of shoulders. */
export interface HeadFrameStep {
  /** The normalised offset d of the nose from the neutral nose (Req 9.2), per axis. */
  readonly d: Vec2;
  readonly noseValid: boolean;
  /** The presence delta of the step, 0..maxClockStepMs. */
  readonly dtMs: number;
  /** The shoulders of the frame as calibrated. */
  readonly shoulders: { readonly left: Landmark; readonly right: Landmark };
  /** Other shoulders: the variant in which only the shoulders change after calibration (Req 9.10). */
  readonly otherShoulders: { readonly left: Landmark; readonly right: Landmark };
}

/** A sequence of head frames after calibration (Req 9, 18.12). */
export interface HeadFramesCase {
  /** The neutral head data that calibration recorded. */
  readonly neutral: NeutralHead;
  /** The frame aspect a. */
  readonly frameAspect: number;
  readonly steps: readonly HeadFrameStep[];
}

/** A signed offset near an edge: |d| within HEAD_EDGE_SHARE * headDeadZone of it, either sign. */
function genNearEdge(edge: number): fc.Arbitrary<number> {
  const width = TUNING.headDeadZone * HEAD_EDGE_SHARE;
  return fc
    .tuple(fc.boolean(), genSpread(Math.max(0, edge - width), edge + width))
    .map(([negative, magnitude]) => (negative ? -magnitude : magnitude));
}

/** One axis of the head's offset: spread over the whole range, or around the dead zone's edge, or around the clamp. */
function genHeadOffset(): fc.Arbitrary<number> {
  const reach = TUNING.headClamp * HEAD_REACH;
  return fc.oneof(genSpread(-reach, reach), genNearEdge(TUNING.headDeadZone), genNearEdge(TUNING.headClamp));
}

/** A shoulder: its position anywhere in the middle of the frame, valid or not. */
function genShoulder(): fc.Arbitrary<Landmark> {
  return fc.record(
    {
      pos: fc.record(
        { x: genSpread(HEAD_SHOULDER_MIN, HEAD_SHOULDER_MAX), y: genSpread(HEAD_SHOULDER_MIN, HEAD_SHOULDER_MAX) },
        { noNullPrototype: true },
      ),
      valid: fc.boolean(),
    },
    { noNullPrototype: true },
  );
}

function genShoulders(): fc.Arbitrary<{ left: Landmark; right: Landmark }> {
  return fc.record({ left: genShoulder(), right: genShoulder() }, { noNullPrototype: true });
}

/**
 * Head frames after calibration (design section 10.1, Req 9.5, 9.9, 9.10, 18.12): a neutral
 * nose and shoulder width, a frame aspect, and 1 to HEAD_RUNS_MAX runs of 1 to HEAD_RUN_MAX steps with the nose
 * valid or invalid, so there are nose gaps, some long enough to run the whole ease to
 * centre. Each step has the offset d of the nose on each axis, drawn across -1.5 to 1.5
 * headClamp and, one time in three each, around the dead zone's edge and around the clamp;
 * a delta from 0 to maxClockStepMs with both ends; and two sets of shoulders, the frame's and
 * a variant that differs in the shoulders only. All numbers come from genSpread.
 */
export function genHeadFrames(): fc.Arbitrary<HeadFramesCase> {
  const step = fc.record(
    {
      d: fc.record({ x: genHeadOffset(), y: genHeadOffset() }, { noNullPrototype: true }),
      dtMs: genSpread(0, TUNING.maxClockStepMs),
      shoulders: genShoulders(),
      otherShoulders: genShoulders(),
    },
    { noNullPrototype: true },
  );
  const run = fc.record(
    {
      noseValid: fc.boolean(),
      steps: fc.array(step, { minLength: 1, maxLength: HEAD_RUN_MAX, size: 'max' }),
    },
    { noNullPrototype: true },
  );
  return fc
    .record(
      {
        neutral: fc.record(
          {
            nose: fc.record(
              { x: genSpread(HEAD_NEUTRAL_MIN, HEAD_NEUTRAL_MAX), y: genSpread(HEAD_NEUTRAL_MIN, HEAD_NEUTRAL_MAX) },
              { noNullPrototype: true },
            ),
            shoulderWidth: genSpread(HEAD_WIDTH_MIN, HEAD_WIDTH_MAX),
          },
          { noNullPrototype: true },
        ),
        frameAspect: genSpread(ASPECT_MIN, ASPECT_MAX),
        runs: fc.array(run, { minLength: 1, maxLength: HEAD_RUNS_MAX, size: 'max' }),
      },
      { noNullPrototype: true },
    )
    .map(({ neutral, frameAspect, runs }) => ({
      neutral,
      frameAspect,
      steps: runs.flatMap((r) => r.steps.map((s) => ({ ...s, noseValid: r.noseValid }))),
    }));
}

/**
 * The landmarks of one step of a HeadFramesCase: the nose at the offset d from the neutral
 * nose (invalid when the step says so), the step's shoulders or, with `other`, the variant
 * shoulders, and wrists at fixed valid positions. The camera-space nose is the inverse of
 * the head's offset: d.x = ((1 - x) - (1 - nx)) * a / w, so x = nx - d.x * w / a, and
 * d.y = (y - ny) / w, so y = ny + d.y * w.
 */
export function headCaseLandmarks(frames: HeadFramesCase, step: HeadFrameStep, other: boolean): PoseLandmarks {
  const { neutral, frameAspect } = frames;
  const shoulders = other ? step.otherShoulders : step.shoulders;
  const WRIST_AT: Vec2 = { x: 0.5, y: 0.5 };
  return {
    nose: {
      pos: {
        x: neutral.nose.x - (step.d.x * neutral.shoulderWidth) / frameAspect,
        y: neutral.nose.y + step.d.y * neutral.shoulderWidth,
      },
      valid: step.noseValid,
    },
    leftShoulder: shoulders.left,
    rightShoulder: shoulders.right,
    leftWrist: { pos: WRIST_AT, valid: true },
    rightWrist: { pos: WRIST_AT, valid: true },
  };
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

/** The most targets in a dwell run (design section 10.1). A test parameter. */
export const DWELL_TARGETS_MAX = 3;
/** The shortest and the longest dwell run, in steps. A test parameter. */
export const DWELL_STEPS_MIN = 24;
export const DWELL_STEPS_MAX = 160;
/** How many activation ids a target draws from, so that an id can come back (A, B, A). A test parameter. */
export const DWELL_ACTIVATIONS = 3;
/** The most segments in a supply timeline or in a path. A test parameter. */
export const DWELL_SEGMENTS_MAX = 8;
/** How far from the centre of a target a pointer can lie, in hit radii. A test parameter. */
export const DWELL_FAR = 3;
/** How far the centre of a hit area moves between two supply segments, on each axis. A test parameter. */
export const DWELL_SHIFT_MAX = 0.02;
/** How far apart the targets' centres can lie, in the largest hit radius. A test parameter. */
export const DWELL_CLUSTER = 3;
/** "Clearly inside" and "clearly outside", in hit radii, for the paths that must not touch the circle. A test parameter. */
export const DWELL_CLEAR_IN = 0.8;
export const DWELL_CLEAR_OUT = 1.2;
/** The most steps before the owner of genTwoPointerInterleaving is first inside. A test parameter. */
export const DWELL_APPROACH_MAX = 6;
/** A full turn, for the angles of the pointer paths. Geometry, not a tuning value. */
const FULL_TURN = 2 * Math.PI;

/** One step of a dwell run: what stepDwell is given (Req 17.1). */
export interface DwellStepCase {
  readonly dt: number;
  readonly pointers: readonly PointerInput[];
  readonly hitAreas: readonly HitArea[];
}

/** A target's own geometry, where its pointers are placed in a step in which it is not supplied. */
export interface DwellTargetBase {
  readonly targetId: string;
  readonly centre: Vec2;
  readonly radius: number;
}

/** The targets of a dwell run and the hit areas supplied in each step. */
export interface DwellWorld {
  readonly bases: readonly DwellTargetBase[];
  readonly areas: readonly (readonly HitArea[])[];
}

/** One step of a pointer path: its validity and its position, which an invalid pointer carries too. */
export interface DwellPathPoint {
  readonly valid: boolean;
  readonly pos: Vec2;
}

/** The longest short and medium segment and the longest long one, in steps, and the shortest long one. Test parameters. */
export const DWELL_SHORT_RUN_MAX = 5;
export const DWELL_MEDIUM_RUN_MAX = 40;
export const DWELL_LONG_RUN_MIN = 30;
export const DWELL_LONG_RUN_MAX = 90;

/** The length of a segment in steps: short stints, medium ones and long rests. */
function genRunLength(): fc.Arbitrary<number> {
  return fc.oneof(
    { arbitrary: fc.integer({ min: 1, max: DWELL_SHORT_RUN_MAX }), weight: 1 },
    { arbitrary: fc.integer({ min: DWELL_SHORT_RUN_MAX + 1, max: DWELL_MEDIUM_RUN_MAX }), weight: 3 },
    { arbitrary: fc.integer({ min: DWELL_LONG_RUN_MIN, max: DWELL_LONG_RUN_MAX }), weight: 2 },
  );
}

/** Each segment repeated for its `steps`, as `count` segments: the last one goes on if they run out. */
function expandSegments<T extends { readonly steps: number }>(segments: readonly T[], count: number): T[] {
  const out: T[] = [];
  for (const segment of segments) {
    for (let i = 0; i < segment.steps && out.length < count; i++) out.push(segment);
  }
  const last = segments[segments.length - 1];
  while (out.length < count && last !== undefined) out.push(last);
  return out;
}

/** One stretch of the supply of a target: present or not, under one activation id, with one radius and a shift of its centre. */
interface SupplySegment {
  readonly present: boolean;
  readonly activation: number;
  readonly radius: number;
  readonly shift: Vec2;
  readonly steps: number;
}

function genSupply(): fc.Arbitrary<SupplySegment> {
  return fc.record(
    {
      present: fc.oneof(
        { arbitrary: fc.constant(true), weight: 3 },
        { arbitrary: fc.constant(false), weight: 1 },
      ),
      activation: fc.integer({ min: 0, max: DWELL_ACTIVATIONS - 1 }),
      radius: genSpread(TUNING.hitRadiusMin, TUNING.hitRadiusMax),
      shift: fc.record(
        { x: genSpread(-DWELL_SHIFT_MAX, DWELL_SHIFT_MAX), y: genSpread(-DWELL_SHIFT_MAX, DWELL_SHIFT_MAX) },
        { noNullPrototype: true },
      ),
      steps: genRunLength(),
    },
    { noNullPrototype: true },
  );
}

/**
 * The hit areas of a dwell run of `steps` steps (Req 17.1, 17.14, design section 10.1): 1 to
 * DWELL_TARGETS_MAX targets t0, t1, ... whose centres lie within DWELL_CLUSTER largest radii of
 * the first, so that they often overlap. Each target has a timeline of up to DWELL_SEGMENTS_MAX
 * stretches: present or removed, under one of DWELL_ACTIVATIONS activation ids, so that an id changes
 * and can come back, with a radius in hitRadiusMin..hitRadiusMax and a centre moved by up to
 * DWELL_SHIFT_MAX, so that the radius and the centre also change under the same activation id.
 * Every number comes from genSpread.
 */
export function genHitAreas(steps: number): fc.Arbitrary<DwellWorld> {
  const target = fc.record(
    {
      distance: genSpread(0, DWELL_CLUSTER * TUNING.hitRadiusMax),
      angle: genSpread(0, FULL_TURN),
      radius: genSpread(TUNING.hitRadiusMin, TUNING.hitRadiusMax),
      supplies: fc.array(genSupply(), { minLength: 1, maxLength: DWELL_SEGMENTS_MAX, size: 'max' }),
    },
    { noNullPrototype: true },
  );
  return fc
    .record(
      {
        origin: fc.record(
          { x: genSpread(0, ASPECT_MAX), y: genSpread(0, UNIT_EXTENT) },
          { noNullPrototype: true },
        ),
        targets: fc.array(target, { minLength: 1, maxLength: DWELL_TARGETS_MAX, size: 'max' }),
      },
      { noNullPrototype: true },
    )
    .map(({ origin, targets }) => {
      const bases: DwellTargetBase[] = targets.map((t, j) => ({
        targetId: `t${j}`,
        centre:
          j === 0
            ? origin
            : { x: origin.x + t.distance * Math.cos(t.angle), y: origin.y + t.distance * Math.sin(t.angle) },
        radius: t.radius,
      }));
      const timelines = targets.map((t) => expandSegments(t.supplies, steps));
      const areas: HitArea[][] = [];
      for (let step = 0; step < steps; step++) {
        const supplied: HitArea[] = [];
        bases.forEach((base, j) => {
          const segment = timelines[j]?.[step];
          if (segment === undefined || !segment.present) return;
          supplied.push({
            targetId: base.targetId,
            activationId: `a${segment.activation}`,
            centre: { x: base.centre.x + segment.shift.x, y: base.centre.y + segment.shift.y },
            radius: segment.radius,
          });
        });
        areas.push(supplied);
      }
      return { bases, areas };
    });
}

/** What a stretch of a path does: valid and inside the target's circle, valid and outside it, or invalid (anywhere). */
export type DwellPathMode = 'inside' | 'outside' | 'invalid';

/** One stretch of a path, relative to one target. */
interface PathSegment {
  readonly mode: DwellPathMode;
  /** The target the pointer lies relative to, modulo the number of targets. */
  readonly target: number;
  /** A draw in 0..1 that sets the distance from the centre inside the range of the mode. */
  readonly unit: number;
  readonly angle: number;
  readonly steps: number;
}

function genPathSegment(): fc.Arbitrary<PathSegment> {
  return fc.record(
    {
      mode: fc.oneof(
        { arbitrary: fc.constant<DwellPathMode>('inside'), weight: 3 },
        { arbitrary: fc.constant<DwellPathMode>('outside'), weight: 2 },
        { arbitrary: fc.constant<DwellPathMode>('invalid'), weight: 1 },
      ),
      target: fc.integer({ min: 0, max: DWELL_TARGETS_MAX - 1 }),
      unit: genUnit(),
      angle: genSpread(0, FULL_TURN),
      steps: genRunLength(),
    },
    { noNullPrototype: true },
  );
}

/** The distance from a centre, in hit radii: inside 0..1, outside 1..DWELL_FAR, invalid 0..DWELL_FAR. */
function factorOf(mode: DwellPathMode, unit: number): number {
  if (mode === 'inside') return unit;
  if (mode === 'outside') return 1 + unit * (DWELL_FAR - 1);
  return unit * DWELL_FAR;
}

/**
 * The point at `factor` hit radii from the centre of target `target` (modulo their number) in the
 * given direction, measured on the hit area supplied in that step, or on the target's own geometry
 * when it is not supplied. An invalid point has a position like any other.
 */
function pointAt(world: DwellWorld, step: number, target: number, mode: DwellPathMode, factor: number, angle: number): DwellPathPoint {
  const base = world.bases[target % world.bases.length] as DwellTargetBase;
  const anchor = world.areas[step]?.find((a) => a.targetId === base.targetId) ?? base;
  return {
    valid: mode !== 'invalid',
    pos: {
      x: anchor.centre.x + factor * anchor.radius * Math.cos(angle),
      y: anchor.centre.y + factor * anchor.radius * Math.sin(angle),
    },
  };
}

/** The points of steps from..to - 1 of a path made of `segments`. */
function pathFrom(segments: readonly PathSegment[], world: DwellWorld, from: number, to: number): DwellPathPoint[] {
  return expandSegments(segments, to - from).map((s, i) =>
    pointAt(world, from + i, s.target, s.mode, factorOf(s.mode, s.unit), s.angle),
  );
}

/**
 * One pointer's path over the steps of `world` (Req 17, design section 10.1): up to DWELL_SEGMENTS_MAX
 * stretches, each valid and inside, valid and outside, or invalid, relative to one target, at a fixed
 * distance and direction from its centre, so that the pointer enters, leaves, crosses and rests on
 * targets, and the circles overlap. An invalid pointer lies anywhere, often inside a circle.
 */
export function genTargetPath(world: DwellWorld): fc.Arbitrary<readonly DwellPathPoint[]> {
  return fc
    .array(genPathSegment(), { minLength: 1, maxLength: DWELL_SEGMENTS_MAX, size: 'max' })
    .map((segments) => pathFrom(segments, world, 0, world.areas.length));
}

/**
 * The deltas of `count` steps (Req 17.1): each from genSpread over 0..maxClockStepMs, or every one
 * maxClockStepMs, or every one half of it. The last two make sums come out exactly on the windows
 * and on dwellMs, which a spread alone rarely does.
 */
function genDeltas(count: number): fc.Arbitrary<readonly number[]> {
  const max = TUNING.maxClockStepMs;
  return fc.oneof(
    { arbitrary: fc.array(genSpread(0, max), { minLength: count, maxLength: count }), weight: 3 },
    { arbitrary: fc.constant(Array.from({ length: count }, () => max)), weight: 1 },
    { arbitrary: fc.constant(Array.from({ length: count }, () => max / 2)), weight: 1 },
  );
}

/** The pointer a path point stands for. An invalid one carries its position too, which the reducer must never read. */
function pointerFor(wrist: WristId, point: DwellPathPoint): PointerInput {
  return point.valid
    ? { wrist, valid: true, pos: point.pos }
    : ({ wrist, valid: false, pos: point.pos } as PointerInput);
}

/**
 * A run of dwell steps (Req 17, design section 10.1): DWELL_STEPS_MIN to DWELL_STEPS_MAX steps with
 * the hit areas of genHitAreas, the right wrist, the left wrist or both, each on its own path from
 * genTargetPath, and the deltas of genDeltas.
 */
export function genDwellRun(): fc.Arbitrary<readonly DwellStepCase[]> {
  return fc.integer({ min: DWELL_STEPS_MIN, max: DWELL_STEPS_MAX }).chain((count) =>
    genHitAreas(count).chain((world) =>
      fc
        .record(
          {
            wrists: fc.constantFrom<readonly WristId[]>(['right'], ['left'], ['left', 'right']),
            left: genTargetPath(world),
            right: genTargetPath(world),
            dts: genDeltas(count),
          },
          { noNullPrototype: true },
        )
        .map(({ wrists, left, right, dts }) =>
          world.areas.map((hitAreas, i) => ({
            dt: dts[i] ?? 0,
            pointers: wrists.flatMap((wrist) => {
              const point = (wrist === 'left' ? left : right)[i];
              return point === undefined ? [] : [pointerFor(wrist, point)];
            }),
            hitAreas,
          })),
        ),
    ),
  );
}

/** A world of one target, t0, supplied in every step with the same hit area. */
function genStaticWorld(count: number): fc.Arbitrary<DwellWorld> {
  return fc
    .record(
      {
        x: genSpread(0, ASPECT_MAX),
        y: genSpread(0, UNIT_EXTENT),
        radius: genSpread(TUNING.hitRadiusMin, TUNING.hitRadiusMax),
      },
      { noNullPrototype: true },
    )
    .map(({ x, y, radius }) => {
      const area: HitArea = { targetId: 't0', activationId: 'a0', centre: { x, y }, radius };
      return {
        bases: [{ targetId: 't0', centre: area.centre, radius }],
        areas: Array.from({ length: count }, () => [area]),
      };
    });
}

/** A point of step `step` that is not valid and inside the first target: invalid anywhere, or valid clearly outside. */
function genBlockedPoint(world: DwellWorld, step: number): fc.Arbitrary<DwellPathPoint> {
  const spot = fc.record({ unit: genUnit(), angle: genSpread(0, FULL_TURN) }, { noNullPrototype: true });
  return fc.oneof(
    spot.map(({ unit, angle }) => pointAt(world, step, 0, 'invalid', factorOf('invalid', unit), angle)),
    spot.map(({ unit, angle }) =>
      pointAt(world, step, 0, 'outside', DWELL_CLEAR_OUT + unit * (DWELL_FAR - DWELL_CLEAR_OUT), angle),
    ),
  );
}

/** The blocked points of steps 0..count - 1. */
function genBlockedPrefix(world: DwellWorld, count: number): fc.Arbitrary<DwellPathPoint[]> {
  return fc.tuple(...Array.from({ length: count }, (_, step) => genBlockedPoint(world, step)));
}

/** Two pointers on one target for the ownership property (Req 17.19). */
export interface TwoPointerCase {
  /** The pointer that is first valid and inside the target. */
  readonly owner: WristId;
  /** The step in which the owner is first inside, and so acquires the target. */
  readonly acquireAt: number;
  readonly steps: readonly DwellStepCase[];
  /** The same steps, with the other pointer's path replaced by another one. */
  readonly replaced: readonly DwellStepCase[];
}

/**
 * Two pointers on one target (design section 10.1, Req 17.19): the owner is clearly outside or
 * invalid for 0..DWELL_APPROACH_MAX steps and then clearly inside, and goes on with any path. The
 * other pointer is clearly outside or invalid for as long, and the step in which the owner arrives,
 * and goes on with any path, so that it is inside, nearer the centre, outside and invalid at times.
 * `replaced` has the same steps with another such path for the other pointer. The owner's path, the
 * hit area and the deltas are the same in both.
 */
export function genTwoPointerInterleaving(): fc.Arbitrary<TwoPointerCase> {
  return fc
    .record(
      {
        owner: fc.constantFrom<WristId>('left', 'right'),
        approach: fc.integer({ min: 0, max: DWELL_APPROACH_MAX }),
        rest: fc.integer({ min: DWELL_STEPS_MIN, max: DWELL_STEPS_MAX }),
      },
      { noNullPrototype: true },
    )
    .chain(({ owner, approach, rest }) => {
      const count = approach + 1 + rest;
      const segments = fc.array(genPathSegment(), { minLength: 1, maxLength: DWELL_SEGMENTS_MAX, size: 'max' });
      return genStaticWorld(count).chain((world) =>
        fc
          .record(
            {
              ownerApproach: genBlockedPrefix(world, approach),
              arrival: fc.record({ unit: genUnit(), angle: genSpread(0, FULL_TURN) }, { noNullPrototype: true }),
              ownerRest: segments,
              otherBlocked: genBlockedPrefix(world, approach + 1),
              otherRest: segments,
              replacedBlocked: genBlockedPrefix(world, approach + 1),
              replacedRest: segments,
              dts: genDeltas(count),
            },
            { noNullPrototype: true },
          )
          .map((draw) => {
            const arrival = pointAt(world, approach, 0, 'inside', DWELL_CLEAR_IN * draw.arrival.unit, draw.arrival.angle);
            const ownerPath = [...draw.ownerApproach, arrival, ...pathFrom(draw.ownerRest, world, approach + 1, count)];
            const otherPath = [...draw.otherBlocked, ...pathFrom(draw.otherRest, world, approach + 1, count)];
            const replacedPath = [...draw.replacedBlocked, ...pathFrom(draw.replacedRest, world, approach + 1, count)];
            const other: WristId = owner === 'left' ? 'right' : 'left';
            const build = (otherSide: readonly DwellPathPoint[]): DwellStepCase[] =>
              world.areas.map((hitAreas, i) => {
                const mine = ownerPath[i];
                const theirs = otherSide[i];
                const pointers: PointerInput[] = [];
                for (const wrist of ['left', 'right'] as const) {
                  const point = wrist === owner ? mine : wrist === other ? theirs : undefined;
                  if (point !== undefined) pointers.push(pointerFor(wrist, point));
                }
                return { dt: draw.dts[i] ?? 0, pointers, hitAreas };
              });
            return { owner, acquireAt: approach, steps: build(otherPath), replaced: build(replacedPath) };
          }),
      );
    });
}

/** The fewest and the most cycles in a genReselectRun. A test parameter. */
export const RESELECT_CYCLES_MIN = 3;
export const RESELECT_CYCLES_MAX = 6;
/** The most steps a cycle rests beyond the one that selects, and the most steps it spends away. A test parameter. */
export const RESELECT_EXTRA_MAX = 3;
export const RESELECT_AWAY_MAX = 3;

/** How a cycle of genReselectRun ends: the pointer goes valid and outside, goes invalid, stays inside, or stays inside while the target is not supplied. */
type ReselectLeave = 'outside' | 'invalid' | 'stay' | 'removed';

/**
 * A pointer that selects one target again and again (Req 17.13, 17.20, design section 10.1):
 * RESELECT_CYCLES_MIN to RESELECT_CYCLES_MAX cycles. In each the right wrist rests inside for
 * the dwell time under one of DWELL_ACTIVATIONS activation ids (so an id repeats, or comes back
 * after another one), with steps of maxClockStepMs or half of it, and then goes valid and
 * outside, goes invalid (with its position still at the centre), stays inside, or goes outside
 * while the target is not supplied, for up to RESELECT_AWAY_MAX steps. So the target is selected,
 * left or not left, and offered again under another id, which can be an id that has been used.
 * Sometimes the left wrist is there too, inside, outside or invalid throughout, so that it is
 * latched along with the right one, or is not.
 */
export function genReselectRun(): fc.Arbitrary<readonly DwellStepCase[]> {
  const cycle = fc.record(
    {
      activation: fc.integer({ min: 0, max: DWELL_ACTIVATIONS - 1 }),
      extra: fc.integer({ min: 0, max: RESELECT_EXTRA_MAX }),
      leave: fc.oneof(
        { arbitrary: fc.constant<ReselectLeave>('outside'), weight: 2 },
        { arbitrary: fc.constant<ReselectLeave>('invalid'), weight: 1 },
        { arbitrary: fc.constant<ReselectLeave>('stay'), weight: 1 },
        { arbitrary: fc.constant<ReselectLeave>('removed'), weight: 1 },
      ),
      away: fc.integer({ min: 1, max: RESELECT_AWAY_MAX }),
    },
    { noNullPrototype: true },
  );
  return fc
    .record(
      {
        x: genSpread(0, ASPECT_MAX),
        y: genSpread(0, UNIT_EXTENT),
        radius: genSpread(TUNING.hitRadiusMin, TUNING.hitRadiusMax),
        dt: fc.constantFrom(TUNING.maxClockStepMs, TUNING.maxClockStepMs / 2),
        // The left wrist: not there, or inside, outside or invalid in every step. Inside, it is latched with the right.
        second: fc.oneof(
          { arbitrary: fc.constant<StintKind | null>(null), weight: 4 },
          { arbitrary: fc.constant<StintKind | null>('inside'), weight: 1 },
          { arbitrary: fc.constant<StintKind | null>('outside'), weight: 1 },
          { arbitrary: fc.constant<StintKind | null>('invalid'), weight: 1 },
        ),
        cycles: fc.array(cycle, { minLength: RESELECT_CYCLES_MIN, maxLength: RESELECT_CYCLES_MAX, size: 'max' }),
      },
      { noNullPrototype: true },
    )
    .map(({ x, y, radius, dt, second, cycles }) => {
      const centre = { x, y };
      const toSelect = Math.ceil(TUNING.dwellMs / dt);
      const steps: DwellStepCase[] = [];
      const pointerOfKind = (wrist: WristId, kind: StintKind): PointerInput =>
        kind === 'inside'
          ? { wrist, valid: true, pos: centre }
          : kind === 'outside'
            ? { wrist, valid: true, pos: { x: x + DWELL_FAR * radius, y } }
            : ({ wrist, valid: false, pos: centre } as PointerInput);
      const push = (kind: StintKind, activation: number, supplied: boolean): void => {
        steps.push({
          dt,
          pointers:
            second === null ? [pointerOfKind('right', kind)] : [pointerOfKind('right', kind), pointerOfKind('left', second)],
          hitAreas: supplied ? [{ targetId: 't0', activationId: `a${activation}`, centre, radius }] : [],
        });
      };
      for (const c of cycles) {
        // The step that acquires adds no progress, then toSelect full steps reach dwellMs.
        for (let i = 0; i < 1 + toSelect + c.extra; i++) push('inside', c.activation, true);
        // Away: valid and outside, invalid, or valid and outside while the target is not supplied.
        if (c.leave === 'outside' || c.leave === 'invalid') {
          for (let i = 0; i < c.away; i++) push(c.leave, c.activation, true);
        } else if (c.leave === 'removed') {
          for (let i = 0; i < c.away; i++) push('outside', c.activation, false);
        }
      }
      return steps;
    });
}

/** The fewest and the most steps of a tracking run, and the most stretches of each of its three timelines. Test parameters. */
export const TRACKING_STEPS_MIN = 30;
export const TRACKING_STEPS_MAX = 200;
export const TRACKING_SEGMENTS_MAX = 12;

/** Which wrists a stretch of a tracking run has valid: both, only the left, only the right, or neither. */
export type WristPattern = 'both' | 'left' | 'right' | 'none';

/** One step of a tracking run, as the driver sees it: the raw delta, the pause and hidden flags, and the validity of both wrists and the nose. */
export interface TrackingStepCase {
  /** The raw frame delta, 0..maxClockStepMs, before the clocks make it the presence delta. */
  readonly rawDt: number;
  readonly paused: boolean;
  readonly hidden: boolean;
  /** The validity of both wrists. A wrist that is not active is there too, and must change nothing. */
  readonly wristValid: { readonly left: boolean; readonly right: boolean };
  readonly noseValid: boolean;
}

export interface TrackingRunCase {
  readonly activeWrists: readonly WristId[];
  readonly steps: readonly TrackingStepCase[];
}

/** The length of a stretch of a tracking run in steps: flickers, medium stretches, and long ones. */
function genTrackingLength(): fc.Arbitrary<number> {
  return fc.oneof(
    { arbitrary: fc.integer({ min: 1, max: 3 }), weight: 2 },
    { arbitrary: fc.integer({ min: 4, max: 15 }), weight: 3 },
    { arbitrary: fc.integer({ min: 16, max: 45 }), weight: 2 },
  );
}

/**
 * A run of tracking steps (design section 10.1, Req 18.12 - 18.14): TRACKING_STEPS_MIN to
 * TRACKING_STEPS_MAX steps, the right wrist, the left or both active, and three independent
 * timelines of stretches of 1 to 45 steps: which wrists are valid (both, one, or neither, so
 * with gaps from a flicker to a few seconds), the nose (valid or invalid), and the clocks
 * (running, paused or hidden). The raw deltas are 0..maxClockStepMs, each from genSpread or
 * all the maximum or all half of it, so that sums land exactly on the thresholds. The validity
 * of a wrist that is not active is generated too. With `alwaysOneWrist`, no step is without a
 * valid active wrist, and the generator never draws that stretch.
 */
export function genTrackingRun(alwaysOneWrist: boolean): fc.Arbitrary<TrackingRunCase> {
  const patterns: WristPattern[] = alwaysOneWrist ? ['both', 'left', 'right'] : ['both', 'left', 'right', 'none', 'none'];
  const wristSegment = fc.record(
    { pattern: fc.constantFrom<WristPattern>(...patterns), steps: genTrackingLength() },
    { noNullPrototype: true },
  );
  const noseSegment = fc.record(
    {
      valid: fc.oneof(
        { arbitrary: fc.constant(true), weight: 2 },
        { arbitrary: fc.constant(false), weight: 1 },
      ),
      steps: genTrackingLength(),
    },
    { noNullPrototype: true },
  );
  const clockSegment = fc.record(
    {
      mode: fc.oneof(
        { arbitrary: fc.constant<'running' | 'paused' | 'hidden'>('running'), weight: 4 },
        { arbitrary: fc.constant<'running' | 'paused' | 'hidden'>('paused'), weight: 1 },
        { arbitrary: fc.constant<'running' | 'paused' | 'hidden'>('hidden'), weight: 1 },
      ),
      steps: genTrackingLength(),
    },
    { noNullPrototype: true },
  );
  const timeline = <T extends { readonly steps: number }>(segment: fc.Arbitrary<T>): fc.Arbitrary<T[]> =>
    fc.array(segment, { minLength: 1, maxLength: TRACKING_SEGMENTS_MAX, size: 'max' });
  return fc.integer({ min: TRACKING_STEPS_MIN, max: TRACKING_STEPS_MAX }).chain((count) =>
    fc
      .record(
        {
          active: fc.constantFrom<readonly WristId[]>(['right'], ['left'], ['left', 'right']),
          wrists: timeline(wristSegment),
          nose: timeline(noseSegment),
          clock: timeline(clockSegment),
          deltas: genDeltas(count),
        },
        { noNullPrototype: true },
      )
      .map(({ active, wrists, nose, clock, deltas }): TrackingRunCase => {
        const w = expandSegments(wrists, count);
        const n = expandSegments(nose, count);
        const c = expandSegments(clock, count);
        const steps = Array.from({ length: count }, (_, i): TrackingStepCase => {
          const pattern = w[i]?.pattern ?? 'both';
          let valid = {
            left: pattern === 'both' || pattern === 'left',
            right: pattern === 'both' || pattern === 'right',
          };
          // No stretch without a valid active wrist: make the first active wrist valid in it.
          if (alwaysOneWrist && !active.some((wrist) => valid[wrist])) {
            const first = active[0] ?? 'right';
            valid = { ...valid, [first]: true };
          }
          return {
            rawDt: deltas[i] ?? 0,
            paused: c[i]?.mode === 'paused',
            hidden: c[i]?.mode === 'hidden',
            wristValid: valid,
            noseValid: n[i]?.valid ?? true,
          };
        });
        return { activeWrists: active, steps };
      }),
  );
}

/** The size of a step of genStintRun that is not a divisor of any window, so that no sum lines up by luck. A test parameter. */
export const STINT_ODD_STEP_MS = 7;
/** The most stints in a genStintRun, and the fewest. A test parameter. */
export const STINT_COUNT_MIN = 2;
export const STINT_COUNT_MAX = 10;

/** What the pointer does for one stint: valid and inside the circle, valid and outside it, or invalid (with a position at the centre). */
export type StintKind = 'inside' | 'outside' | 'invalid';

/** One stint: a kind and a duration in whole milliseconds. */
export interface Stint {
  readonly kind: StintKind;
  readonly ms: number;
}

/** A run of one pointer on one target in stints (Req 17.21, 17.22). */
export interface StintRun {
  /** Whether every Outside stint is at most outsideWindowMs and every Invalid stint at most invalidWindowMs, with none next to one of its own kind. */
  readonly bounded: boolean;
  readonly stints: readonly Stint[];
  /** The one hit area, supplied in every step. */
  readonly area: HitArea;
  /** The acquiring step (the right wrist inside), then every stint cut into steps of at most maxClockStepMs. */
  readonly steps: readonly DwellStepCase[];
}

/**
 * A duration in whole milliseconds for a stint: at or next to its window, or spread over 0..twice
 * the window. The window of an Inside stint is dwellMs, so that some runs reach a selection. A
 * bounded run keeps its Outside and Invalid stints from 0 to their window and no longer.
 */
function genStintMs(kind: StintKind, bounded: boolean): fc.Arbitrary<number> {
  // Not called `window`: tests/dependency-graph.test.ts reads that name as the DOM global.
  const limit =
    kind === 'outside' ? TUNING.outsideWindowMs : kind === 'invalid' ? TUNING.invalidWindowMs : TUNING.dwellMs;
  const capped = bounded && kind !== 'inside';
  const edges = capped ? [limit - 1, limit] : [limit - 1, limit, limit + 1];
  return fc.oneof(
    { arbitrary: fc.constantFrom(...edges), weight: 3 },
    { arbitrary: genSpread(0, capped ? limit : 2 * limit).map(Math.round), weight: 3 },
  );
}

/** A duration cut into steps of at most `size`, summing to it exactly; a duration of 0 is one step of delta 0. */
function cutInto(ms: number, size: number): number[] {
  if (ms <= 0) return [0];
  const parts: number[] = [];
  for (let left = ms; left > 0; left -= size) parts.push(Math.min(size, left));
  return parts;
}

/**
 * A pointer that rests, leaves and goes invalid in stints of exact lengths (design section 10.1,
 * Req 17.21, 17.22): the right wrist is inside in the first step, which acquires the target, then
 * STINT_COUNT_MIN to STINT_COUNT_MAX stints of valid-and-inside, valid-and-outside or invalid (with
 * its position at the centre), each of whole milliseconds that is at, just under or just over its
 * window or spread over 0..twice the window, cut into steps of maxClockStepMs, half of it or
 * STINT_ODD_STEP_MS, so that the sums come out exactly. With `bounded`, no Outside stint is longer
 * than outsideWindowMs and no Invalid stint longer than invalidWindowMs, and a stint next to one of
 * its own kind becomes an inside stint, so that the stints of one kind never join.
 */
export function genStintRun(bounded: boolean): fc.Arbitrary<StintRun> {
  const stint = fc
    .oneof(
      { arbitrary: fc.constant<StintKind>('inside'), weight: 1 },
      { arbitrary: fc.constant<StintKind>('outside'), weight: 3 },
      { arbitrary: fc.constant<StintKind>('invalid'), weight: 3 },
    )
    .chain((kind) => genStintMs(kind, bounded).map((ms): Stint => ({ kind, ms })));
  return fc
    .record(
      {
        x: genSpread(0, ASPECT_MAX),
        y: genSpread(0, UNIT_EXTENT),
        radius: genSpread(TUNING.hitRadiusMin, TUNING.hitRadiusMax),
        acquireDt: genSpread(0, TUNING.maxClockStepMs),
        stints: fc.array(stint, { minLength: STINT_COUNT_MIN, maxLength: STINT_COUNT_MAX, size: 'max' }),
        size: fc.constantFrom(TUNING.maxClockStepMs, TUNING.maxClockStepMs / 2, STINT_ODD_STEP_MS),
      },
      { noNullPrototype: true },
    )
    .map(({ x, y, radius, acquireDt, stints, size }) => {
      const area: HitArea = { targetId: 't0', activationId: 'a0', centre: { x, y }, radius };
      const kept = stints.map((s, i): Stint => {
        const previous = stints[i - 1];
        const joins = bounded && s.kind !== 'inside' && previous !== undefined && previous.kind === s.kind;
        return joins ? { kind: 'inside', ms: Math.min(s.ms, TUNING.maxClockStepMs) } : s;
      });
      const pointer = (kind: StintKind): PointerInput => {
        if (kind === 'inside') return { wrist: 'right', valid: true, pos: area.centre };
        if (kind === 'outside') {
          return { wrist: 'right', valid: true, pos: { x: x + DWELL_FAR * radius, y } };
        }
        return { wrist: 'right', valid: false, pos: area.centre } as PointerInput;
      };
      const steps: DwellStepCase[] = [{ dt: acquireDt, pointers: [pointer('inside')], hitAreas: [area] }];
      for (const s of kept) {
        for (const dt of cutInto(s.ms, size)) steps.push({ dt, pointers: [pointer(s.kind)], hitAreas: [area] });
      }
      return { bounded, stints: kept, area, steps };
    });
}

/**
 * The most rounds of a help session, the most steps of a round, the most events of a round between
 * its start and its end, and the most stray events drawn before a round. Test parameters (design
 * section 10.1).
 */
export const HELP_ROUNDS_MAX = 8;
export const HELP_STEPS_MAX = 10;
export const HELP_BODY_MAX = 12;
export const HELP_STRAY_MAX = 2;

const NO_HELP_FLAGS: HelpFlags = { dwellActive: false, playbackActive: false };

/** The four combinations of the two flags that every help event carries, neither first. */
const HELP_FLAG_SETS: readonly HelpFlags[] = [
  NO_HELP_FLAGS,
  { dwellActive: true, playbackActive: false },
  { dwellActive: false, playbackActive: true },
  { dwellActive: true, playbackActive: true },
];

/**
 * How a round draws the flags of its events: neither flag in any event, at least one in every event,
 * any combination in each, or at least one in every event but its end, which has neither (a dwell or a
 * playback that runs through the round and has stopped when it ends).
 */
type HelpFlagMode = 'calm' | 'busy' | 'mixed' | 'settling';

/** The kinds of event a round holds between its start and its end, and the round end that a stray event can be. */
type HelpBodyKind = 'difficulty' | 'stepCompleted' | 'continueWithHelp';
type HelpDrawnKind = HelpBodyKind | 'roundEnded';

/** One drawn event before the flags of its round are applied. `flag` indexes HELP_FLAG_SETS. */
interface HelpEventSpec {
  readonly kind: HelpDrawnKind;
  readonly axis: 'motor' | 'cognitive';
  readonly motorStepAllowed: boolean;
  readonly flag: number;
}

function helpFlagsOf(flag: number, mode: HelpFlagMode): HelpFlags {
  // A busy round never takes the first set, which has neither flag. A settling round is busy up to its end.
  const busy = mode === 'busy' || mode === 'settling';
  const index = mode === 'calm' ? 0 : busy ? 1 + (flag % (HELP_FLAG_SETS.length - 1)) : flag;
  return HELP_FLAG_SETS[index] ?? NO_HELP_FLAGS;
}

function helpEventOf(spec: HelpEventSpec, mode: HelpFlagMode): HelpEvent {
  const flags = helpFlagsOf(spec.flag, mode);
  switch (spec.kind) {
    case 'difficulty':
      return { kind: 'difficulty', axis: spec.axis, ...flags };
    case 'stepCompleted':
      return { kind: 'stepCompleted', ...flags };
    case 'continueWithHelp':
      return { kind: 'continueWithHelp', ...flags };
    case 'roundEnded':
      return { kind: 'roundEnded', motorStepAllowed: spec.motorStepAllowed, ...flags };
  }
}

/**
 * A session of the help policy as the caller sends it (design section 10.1, Req 19.11 - 19.13): 1 to
 * HELP_ROUNDS_MAX rounds, each with n in 1..HELP_STEPS_MAX steps and 0 to HELP_BODY_MAX events between
 * its start and its end, any mix of difficulties of either axis (the most often), completed steps and
 * "continue with help". Each round draws its flags one of four ways, so that the changes that wait
 * for a free moment do meet one: neither flag in any event of the round, at least one flag in every
 * event, any combination in each event, or at least one flag in every event but the round end, which
 * has neither (so that a change that waits meets a round end that earns another). A round end allows a motor step or not, one time in three
 * not. About one round in seven is left without an end, so that the next start replaces it and a
 * session can end inside a round, and up to HELP_STRAY_MAX events of any kind, a round end included,
 * come before each round, outside a round when the one before ended.
 *
 * Every draw is a whole number, a boolean or a choice from a short list: there is no range of reals
 * to spread, so nothing here is built on genSpread or fc.double.
 */
export function genHelpSession(): fc.Arbitrary<HelpEvent[]> {
  const spec = (kinds: fc.Arbitrary<HelpDrawnKind>): fc.Arbitrary<HelpEventSpec> =>
    fc.record(
      {
        kind: kinds,
        axis: fc.constantFrom<'motor' | 'cognitive'>('motor', 'cognitive'),
        motorStepAllowed: fc.oneof(
          { arbitrary: fc.constant(true), weight: 2 },
          { arbitrary: fc.constant(false), weight: 1 },
        ),
        flag: fc.integer({ min: 0, max: HELP_FLAG_SETS.length - 1 }),
      },
      { noNullPrototype: true },
    );
  const body = spec(
    fc.oneof(
      { arbitrary: fc.constant<HelpDrawnKind>('difficulty'), weight: 4 },
      { arbitrary: fc.constant<HelpDrawnKind>('stepCompleted'), weight: 2 },
      { arbitrary: fc.constant<HelpDrawnKind>('continueWithHelp'), weight: 1 },
    ),
  );
  const stray = spec(
    fc.oneof(
      { arbitrary: fc.constant<HelpDrawnKind>('difficulty'), weight: 2 },
      { arbitrary: fc.constant<HelpDrawnKind>('stepCompleted'), weight: 1 },
      { arbitrary: fc.constant<HelpDrawnKind>('continueWithHelp'), weight: 1 },
      { arbitrary: fc.constant<HelpDrawnKind>('roundEnded'), weight: 1 },
    ),
  );
  const round = fc.record(
    {
      steps: fc.integer({ min: 1, max: HELP_STEPS_MAX }),
      mode: fc.oneof(
        { arbitrary: fc.constant<HelpFlagMode>('calm'), weight: 2 },
        { arbitrary: fc.constant<HelpFlagMode>('busy'), weight: 3 },
        { arbitrary: fc.constant<HelpFlagMode>('mixed'), weight: 3 },
        { arbitrary: fc.constant<HelpFlagMode>('settling'), weight: 2 },
      ),
      startFlag: fc.integer({ min: 0, max: HELP_FLAG_SETS.length - 1 }),
      body: fc.array(body, { maxLength: HELP_BODY_MAX, size: 'max' }),
      ends: fc.oneof({ arbitrary: fc.constant(true), weight: 6 }, { arbitrary: fc.constant(false), weight: 1 }),
      end: spec(fc.constant<HelpDrawnKind>('roundEnded')),
      strays: fc.array(stray, { maxLength: HELP_STRAY_MAX, size: 'max' }),
    },
    { noNullPrototype: true },
  );
  return fc.array(round, { minLength: 1, maxLength: HELP_ROUNDS_MAX, size: 'max' }).map((rounds) =>
    rounds.flatMap((r): HelpEvent[] => [
      ...r.strays.map((s) => helpEventOf(s, 'mixed')),
      { kind: 'roundStarted', steps: r.steps, ...helpFlagsOf(r.startFlag, r.mode) },
      ...r.body.map((s) => helpEventOf(s, r.mode)),
      ...(r.ends ? [helpEventOf(r.end, r.mode === 'settling' ? 'calm' : r.mode)] : []),
    ]),
  );
}
/**
 * The deepest nesting, the longest text and the shortest "long" text that genSettingsString draws.
 * Test parameters (design section 10.1). The deepest nesting is far beyond what a JSON parser with
 * a recursive descent handles on a default stack.
 */
export const SETTINGS_DEPTH_MAX = 50_000;
export const SETTINGS_LONG_MIN = 1_000;
export const SETTINGS_LONG_MAX = 100_000;
/** The keys of the four settings, in the order serializeSettings writes them. */
export const SETTINGS_FIELDS = ['motion', 'mute', 'volume', 'hands'] as const;
type SettingsField = (typeof SETTINGS_FIELDS)[number];
/** Keys that name something on every object, and a value for each that looks like stored settings. */
export const SETTINGS_HOSTILE_KEYS = [
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'hasOwnProperty',
  'valueOf',
] as const;
const HOSTILE_VALUE = '{"version":1,"motion":"gentle","mute":true,"volume":0.1,"hands":"left"}';
const HOSTILE_VALUES = [
  HOSTILE_VALUE,
  `{"prototype":${HOSTILE_VALUE},"__proto__":${HOSTILE_VALUE}}`,
  '{"motion":"gentle"}',
  '"gentle"',
  'null',
  '[]',
] as const;
/** The JSON text of a valid value for each field. */
const VALID_FIELD_TEXT: Record<SettingsField, fc.Arbitrary<string>> = {
  motion: fc.constantFrom('full', 'gentle', 'reduced').map((v) => JSON.stringify(v)),
  mute: fc.boolean().map((v) => JSON.stringify(v)),
  volume: fc.oneof(fc.constantFrom(0, 1, TUNING.defaultVolume), genSpread(0, 1)).map((v) => JSON.stringify(v)),
  hands: fc.constantFrom('"right"', '"left"', '"both"', 'null'),
};
/** The JSON text of a value that no field accepts, and of values some field accepts or does not. */
const JUNK_TEXT: readonly string[] = [
  'null', 'true', 'false', '[]', '{}', '[1]', '{"a":1}', '""', '"0.5"', '"full"', '"FULL"', '"both"', '"right "', '"1"',
  '0', '1', '2', '-1', '-0', '0.5', '1.0000000000000002', '-0.0000001', '1e999', '-1e999', '1e-999', '123456789012345678901234567890',
];
const genJunkText: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constantFrom(...JUNK_TEXT), weight: 3 },
  { arbitrary: fc.jsonValue().map((v) => JSON.stringify(v)), weight: 1 },
);
/** The JSON text of a version: the right one most often, otherwise another number, or not a number. */
const genVersionText: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constant(String(SETTINGS_VERSION)), weight: 6 },
  { arbitrary: fc.constantFrom('0', '2', '-1', '1.5', '999999999999', '1e999', '"1"', 'null', 'true', '[1]', '{}'), weight: 2 },
  { arbitrary: fc.integer({ min: -3, max: 5 }).map(String), weight: 1 },
);
/** "key":value pairs whose key names something on every object. */
const genHostilePair: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(...SETTINGS_HOSTILE_KEYS), fc.constantFrom(...HOSTILE_VALUES))
  .map(([key, value]) => `${JSON.stringify(key)}:${value}`);
/**
 * Settings text with a version and the four fields, then changed in one way at most: one field
 * corrupted or left out, the version wrong or left out, and hostile keys put in at any position.
 */
const genNearValid: fc.Arbitrary<string> = fc
  .record({
    valid: fc.record({
      motion: VALID_FIELD_TEXT.motion,
      mute: VALID_FIELD_TEXT.mute,
      volume: VALID_FIELD_TEXT.volume,
      hands: VALID_FIELD_TEXT.hands,
    }),
    field: fc.constantFrom(...SETTINGS_FIELDS),
    change: fc.constantFrom('none', 'corrupt', 'corrupt', 'corrupt', 'remove'),
    junk: genJunkText,
    version: genVersionText,
    versionChange: fc.constantFrom('keep', 'keep', 'change', 'change', 'remove'),
    hostile: fc.array(genHostilePair, { maxLength: 3 }),
    at: fc.nat(SETTINGS_FIELDS.length + 1),
  })
  .map((r) => {
    const pairs: string[] = [];
    if (r.versionChange !== 'remove') {
      pairs.push(`"version":${r.versionChange === 'change' ? r.version : String(SETTINGS_VERSION)}`);
    }
    for (const field of SETTINGS_FIELDS) {
      if (field === r.field && r.change === 'remove') continue;
      pairs.push(`"${field}":${field === r.field && r.change === 'corrupt' ? r.junk : r.valid[field]}`);
    }
    pairs.splice(Math.min(r.at, pairs.length), 0, ...r.hostile);
    return `{${pairs.join(',')}}`;
  });
/** An object with hostile keys, with the four valid fields before or after them. */
const genHostile: fc.Arbitrary<string> = fc
  .tuple(fc.array(genHostilePair, { minLength: 1, maxLength: 4 }), fc.boolean(), genNearValid)
  .map(([pairs, before, near]) => {
    const inner = near.slice(1, -1);
    const all = before ? [...pairs, inner] : [inner, ...pairs];
    return `{${all.filter((p) => p !== '').join(',')}}`;
  });
/** JSON whose top level is not an object: null, an array, a number, a string, a boolean; and text that holds settings inside one. */
const genTopLevel: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constantFrom('null', 'null', 'null', '[]', '[]', '[]', '[1,2,3]', '7', '0', '-0', '1e999', '"text"', '""', 'true', 'false', '{}'), weight: 2 },
  { arbitrary: genNearValid.map((s) => `[${s}]`), weight: 1 },
  { arbitrary: genNearValid.map((s) => JSON.stringify(s)), weight: 1 },
  { arbitrary: genNearValid.map((s) => `[[${s}],${s}]`), weight: 1 },
);
/** A depth: a few levels or a great many. */
const genDepth: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: 1, max: 64 }),
  fc.integer({ min: 1_000, max: SETTINGS_DEPTH_MAX }),
);
/** Deeply nested JSON: arrays, objects, closed or cut off, and valid settings with a deeply nested extra field. */
const genDeep: fc.Arbitrary<string> = fc
  .tuple(genDepth, fc.constantFrom('array', 'object', 'open', 'inField', 'inVersion'))
  .map(([n, kind]) => {
    const arrays = `${'['.repeat(n)}${']'.repeat(n)}`;
    switch (kind) {
      case 'array':
        return arrays;
      case 'object':
        return `${'{"a":'.repeat(n)}1${'}'.repeat(n)}`;
      case 'open':
        return '['.repeat(n);
      case 'inField':
        return `{"version":1,"motion":"gentle","mute":true,"volume":0.1,"hands":"left","extra":${arrays}}`;
      case 'inVersion':
        return `{"version":${arrays},"motion":"gentle"}`;
    }
  });
/** Very long text: a long string value, a long key, a long number, a long array, and text that is not JSON. */
const genLong: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: SETTINGS_LONG_MIN, max: SETTINGS_LONG_MAX }), fc.constantFrom('value', 'key', 'number', 'array', 'text', 'hands'))
  .map(([n, kind]) => {
    const long = 'a'.repeat(n);
    switch (kind) {
      case 'value':
        return `{"version":1,"motion":"${long}","mute":false,"volume":0.5,"hands":"both"}`;
      case 'key':
        return `{"version":1,"${long}":1,"motion":"gentle"}`;
      case 'number':
        return `{"version":1,"volume":0.${'1'.repeat(n)},"motion":"gentle"}`;
      case 'array':
        return `{"version":1,"hands":[${'1,'.repeat(n)}1],"motion":"gentle"}`;
      case 'text':
        return long;
      case 'hands':
        return `{"version":1,"hands":"${long}","volume":${'9'.repeat(n)}}`;
    }
  });
/**
 * Stored text for the settings key (design section 10.1, Req 20.4): arbitrary strings, any JSON
 * value written out, settings with one field corrupted or left out or a wrong version, objects with
 * keys such as "__proto__" and "constructor", JSON whose top level is null, an array, a number or a
 * string, deeply nested JSON and very long strings.
 */
export function genSettingsString(): fc.Arbitrary<string> {
  return fc.oneof(
    { arbitrary: fc.string(), weight: 2 },
    { arbitrary: fc.string({ unit: 'binary' }), weight: 1 },
    { arbitrary: fc.jsonValue().map((v) => JSON.stringify(v)), weight: 2 },
    { arbitrary: genNearValid, weight: 6 },
    { arbitrary: genHostile, weight: 3 },
    { arbitrary: genTopLevel, weight: 2 },
    { arbitrary: genDeep, weight: 1 },
    { arbitrary: genLong, weight: 1 },
  );
}