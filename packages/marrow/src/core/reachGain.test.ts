import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addSample,
  cellRectCamera,
  createGrid,
  markAllValid,
  validCells,
  type CellIndex,
  type ComfortGrid,
} from './comfortGrid';
import type { Vec2 } from './frame';
import * as core from './index';
import { makeMapping } from './mapping';
import { computeComfortTransform, type WristGrids } from './reachGain';
import { genGrid, genMappingParams } from './testgen';
import { TUNING, type Tuning } from './tuning';

// The grid size, the samples a cell needs and the three reach-gain values come from
// TUNING or from the tuning argument. The worked examples use two test parameters: a
// 16:9 play area, such as a 1920 x 1080 viewport, and a 4:3 camera image, such as
// 640 x 480. The other numbers are cell indices, the halves of a cell's centre, the
// identity gain and the tolerance, each named below.
//
// To check the examples by hand with the shipped values: k = max(A / a, 1) = 4/3, the
// base mapping is s = ((16/9) * (1 - x), (4/3) * y - 1/6), and each cell of the 16 x 12
// grid is a square of side 1/9 on screen. Cell (col, row) covers x from (15 - col) / 9
// to (16 - col) / 9 and y from (row - 1.5) / 9 to (row - 0.5) / 9, so column 0, at the
// left edge of the camera image, lies at the right edge of the play area. The gain is
// held at the cap for a span below 0.6 / 1.6 = 0.375 (3.375 cells) and at the floor for
// one above 0.6 / 1.0 = 0.6 (5.4 cells).

/** A, the play area's aspect in the worked examples. A test parameter. */
const PLAY_ASPECT = 16 / 9;
/** a, the camera image's aspect in the worked examples. A test parameter. */
const FRAME_ASPECT = 4 / 3;
/**
 * The identity scale (Req 13.4): the gain with no valid cell. Not read from
 * reachGainMin, which is a tuning value (tasks.md task 6.2).
 */
const IDENTITY_GAIN = 1;
/**
 * How far a computed coordinate or gain may lie from the expected one: far above the
 * rounding in these sums, far below a cell. A test parameter.
 */
const TOLERANCE = 1e-9;
/** The samples a cell needs to be valid. */
const NEEDED = TUNING.cellValidSamples;
/** A row near the middle of the grid. Its cells lie inside the play area in the examples. */
const ROW = Math.floor(TUNING.gridRows / 2);
/** The middle of the gain range, for tuning arguments that move one end of it or the target. */
const MID_GAIN = (TUNING.reachGainMin + TUNING.reachGainMax) / 2;
/** The play area's centre, (A / 2, 1 / 2). */
const PLAY_CENTRE: Vec2 = { x: PLAY_ASPECT / 2, y: 1 / 2 };
/** The base mapping of the examples, for the expected values: the mapping at the identity gain. */
const base = makeMapping({
  playAspect: PLAY_ASPECT,
  frameAspect: FRAME_ASPECT,
  gain: IDENTITY_GAIN,
  centre: PLAY_CENTRE,
});
/** A grid with no sample. */
const EMPTY = createGrid(TUNING);
/** Draws the same samples on every run. */
const SAMPLE = { numRuns: 1000, seed: 42 };

/** The comfort transform for the aspects of the worked examples. */
function transform(grids: WristGrids, tuning: Tuning = TUNING) {
  return computeComfortTransform(grids, FRAME_ASPECT, PLAY_ASPECT, tuning);
}

/** The camera-space centre of a cell, halfway between the edges of its rectangle. */
function centreOf({ col, row }: CellIndex): Vec2 {
  const { x0, y0, x1, y1 } = cellRectCamera(col, row, TUNING);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** The grid after `samples` more samples at the centre of each of the cells. */
function withSamples(grid: ComfortGrid, cells: readonly CellIndex[], samples = NEEDED): ComfortGrid {
  let result = grid;
  for (const cell of cells) {
    for (let i = 0; i < samples; i++) result = addSample(result, centreOf(cell));
  }
  return result;
}

/** The cells in columns col0..col1 and rows row0..row1, both ends included. */
function block(col0: number, col1: number, row0: number, row1: number): CellIndex[] {
  const cells: CellIndex[] = [];
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) cells.push({ col, row });
  }
  return cells;
}

/** Row by row and, within a row, by column: the order of validCells. */
const byRowThenCol = (p: CellIndex, q: CellIndex): number => p.row - q.row || p.col - q.col;

/** The arithmetic mean. */
const mean = (values: readonly number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * The expected centre: the mean of the cells' screen-space centres, with a cell listed
 * once for each wrist it is valid for. The mapping is affine, so this is the base
 * mapping of the mean of their camera-space centres, which is how it is computed here:
 * the mean first and one mapping after, the other way round from computeComfortTransform.
 */
function expectedCentre(cells: readonly CellIndex[]): Vec2 {
  const cams = cells.map(centreOf);
  return base.toScreen({ x: mean(cams.map((p) => p.x)), y: mean(cams.map((p) => p.y)) });
}

/**
 * A cell's width and height on screen at gain 1: 1/9 by 1/9 with the shipped values.
 * Every cell has the same size, because the base mapping scales each axis by one factor.
 */
const CELL = (() => {
  const { x0, y0, x1, y1 } = cellRectCamera(0, 0, TUNING);
  const p = base.toScreen({ x: x0, y: y0 });
  const q = base.toScreen({ x: x1, y: y1 });
  return { width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) };
})();

/**
 * The expected span of the cells taken as whole rectangles: the larger side of their
 * box, from the number of columns and rows it reaches over, first to last, gaps included.
 */
function expectedSpan(cells: readonly CellIndex[]): number {
  const cols = cells.map((c) => c.col);
  const rows = cells.map((c) => c.row);
  const across = Math.max(...cols) - Math.min(...cols) + 1;
  const down = Math.max(...rows) - Math.min(...rows) + 1;
  return Math.max(across * CELL.width, down * CELL.height);
}

/** Expects the two points within TOLERANCE of each other on each axis. */
function expectNear(actual: Vec2, expected: Vec2): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(TOLERANCE);
}

describe('computeComfortTransform (Req 13.1-13.4)', () => {
  it('with no valid cell, the gain is the identity, 1, not reachGainMin, and the centre is the play-area centre (Req 13.4)', () => {
    const short = withSamples(EMPTY, [{ col: 0, row: ROW }], NEEDED - 1);
    const cases: WristGrids[] = [{ right: EMPTY }, { left: short }, { left: EMPTY, right: short }];
    // With reachGainMin raised to reachGainMax, a gain read from reachGainMin would not be 1.
    const raisedFloor: Tuning = { ...TUNING, reachGainMin: TUNING.reachGainMax };
    const identity = { centre: PLAY_CENTRE, gain: IDENTITY_GAIN };
    for (const grids of cases) {
      expect(transform(grids)).toEqual(identity);
      expect(transform(grids, raisedFloor)).toEqual(identity);
    }
    // cellValidSamples comes from the tuning argument: at a threshold one higher, a cell
    // with cellValidSamples samples is short of valid too.
    const higherThreshold: Tuning = { ...TUNING, cellValidSamples: NEEDED + 1 };
    expect(transform({ right: withSamples(EMPTY, [{ col: 0, row: ROW }]) }, higherThreshold)).toEqual(
      identity,
    );
  });

  it('one valid cell: the centre is its base-mapped centre, on the mirrored side, and the span is its larger side on screen (Req 13.1-13.3)', () => {
    // Cell (1, ROW) lies near the left edge of the camera image, so on screen it lies near
    // the right edge of the play area: as shipped its centre maps to (14.5 / 9, 5 / 9),
    // about (1.611, 0.556). The cell beside it holds one sample less than a valid cell
    // needs, and counts for neither the centre nor the span.
    const cell: CellIndex = { col: 1, row: ROW };
    const grids = { right: withSamples(withSamples(EMPTY, [cell]), [{ col: 2, row: ROW }], NEEDED - 1) };
    const { centre } = transform(grids);
    expectNear(centre, base.toScreen(centreOf(cell)));
    expect(centre.x).toBeGreaterThan(PLAY_CENTRE.x);
    // As shipped the gain is held at the cap (0.6 * 9 = 5.4 cells), so the span shows only
    // through another target: reachGainSpanTarget = MID_GAIN * span gives the gain
    // MID_GAIN when the span is one cell's larger side, and not when it is 0 (the cell's
    // centre alone) or reaches the short cell beside it.
    const probe: Tuning = { ...TUNING, reachGainSpanTarget: MID_GAIN * expectedSpan([cell]) };
    expect(Math.abs(transform(grids, probe).gain - MID_GAIN)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('two separate regions: the centre is the mean over their cells and lies in the gap, and the span reaches across the gap (Req 13.1-13.3, 13.5)', () => {
    // Two adjacent cells in columns 0-1 and one cell in column 4, with columns 2-3 empty
    // between them. As shipped: the mean camera column of the three cells is 2.17 (cells are
    // averaged, not regions), which lies in the empty columns 2-3, so the centre lies over
    // the gap. The box reaches over 5 columns and 1 row, so the span is 5 / 9, about 0.556,
    // and the gain 0.6 / 0.556 = 1.08, between floor and cap.
    const cells: CellIndex[] = [{ col: 0, row: ROW }, { col: 1, row: ROW }, { col: 4, row: ROW }];
    const grids = { right: withSamples(EMPTY, cells) };
    const before = structuredClone(grids);
    const { centre, gain } = transform(grids);
    expectNear(centre, expectedCentre(cells));
    // The centre lies over the gap: on screen, right of the cell in column 4 and left of
    // the block, which the mirror puts on the right. The mapping takes x on its own, so
    // any camera y gives the same screen x.
    const y = centreOf({ col: 0, row: ROW }).y;
    const gapStart = base.toScreen({ x: cellRectCamera(4, ROW, TUNING).x0, y }).x;
    const gapEnd = base.toScreen({ x: cellRectCamera(1, ROW, TUNING).x1, y }).x;
    expect(centre.x).toBeGreaterThan(gapStart);
    expect(centre.x).toBeLessThan(gapEnd);
    const raw = TUNING.reachGainSpanTarget / expectedSpan(cells);
    expect(raw).toBeGreaterThan(TUNING.reachGainMin);
    expect(raw).toBeLessThan(TUNING.reachGainMax);
    expect(Math.abs(gain - raw)).toBeLessThanOrEqual(TOLERANCE);
    // The box only sizes the gain (Req 13.5): the columns between the regions stay
    // empty, and the grid is as it was.
    expect(grids).toStrictEqual(before);
    expect(validCells(grids.right, TUNING)).toEqual([...cells].sort(byRowThenCol));
  });

  it('a cell valid for both wrists counts once for each wrist, and the box covers the cells of both wrists (Req 13.1, 13.2)', () => {
    // Left wrist: P = (3, ROW) and Q = (0, ROW). Right wrist: P and R = (4, ROW). The
    // centre is the mean over P, Q, P and R: the mean camera column is 2.5, the mean over
    // P, Q and R once would be 7/3, so the two differ. The box reaches from Q, a cell of
    // the left wrist, to R, a cell of the right wrist: 5 columns, so the span is 5 / 9 and
    // the gain 0.6 / (5 / 9), about 1.08. Alone, the left wrist's cells span 4 / 9 and the
    // right wrist's span 2 / 9, so the box over both is a span of its own.
    const P: CellIndex = { col: 3, row: ROW };
    const Q: CellIndex = { col: 0, row: ROW };
    const R: CellIndex = { col: 4, row: ROW };
    const grids = { left: withSamples(EMPTY, [P, Q]), right: withSamples(EMPTY, [P, R]) };
    const { centre, gain } = transform(grids);
    expectNear(centre, expectedCentre([P, Q, P, R]));
    expect(Math.abs(centre.x - expectedCentre([P, Q, R]).x)).toBeGreaterThan(TOLERANCE);
    const raw = TUNING.reachGainSpanTarget / expectedSpan([Q, R]);
    expect(raw).toBeGreaterThan(TUNING.reachGainMin);
    expect(raw).toBeLessThan(TUNING.reachGainMax);
    expect(Math.abs(gain - raw)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('a span small enough to hit the cap: reachGainSpanTarget / span is above reachGainMax, and the gain is held at reachGainMax (Req 13.3)', () => {
    // A 2 x 2 block: as shipped its span is 2 / 18, about 0.111, and 0.6 / 0.111 = 5.4 is
    // above the cap of 1.6, so the clamp holds the gain at 1.6.
    const cells = block(10, 11, ROW, ROW + 1);
    const grids = { right: withSamples(EMPTY, cells) };
    const raw = TUNING.reachGainSpanTarget / expectedSpan(cells);
    expect(raw).toBeGreaterThan(TUNING.reachGainMax);
    expect(transform(grids).gain).toBe(TUNING.reachGainMax);
    // The cap is read from the tuning argument: a lower one holds the gain there instead.
    expect(raw).toBeGreaterThan(MID_GAIN);
    expect(transform(grids, { ...TUNING, reachGainMax: MID_GAIN }).gain).toBe(MID_GAIN);
  });

  it('every cell valid: the span is the whole camera image, reachGainSpanTarget / span is below reachGainMin, and the gain is held at reachGainMin (Req 13.3)', () => {
    // A grid marked all-valid, as "Use the whole screen" leaves it (Req 11.15). As shipped
    // the image is 16/9 wide and 4/3 high on screen, so the span is 16/9, about 1.778, and
    // 0.6 / 1.778 = 0.3375 is below the floor of 1.0. The mean of the centres of all the
    // cells is the centre of the image, which maps to the play-area centre.
    const grids = { right: markAllValid(EMPTY) };
    const all = block(0, TUNING.gridCols - 1, 0, TUNING.gridRows - 1);
    const raw = TUNING.reachGainSpanTarget / expectedSpan(all);
    expect(raw).toBeLessThan(TUNING.reachGainMin);
    const { centre, gain } = transform(grids);
    expect(gain).toBe(TUNING.reachGainMin);
    expectNear(centre, PLAY_CENTRE);
    // The floor is read from the tuning argument: a higher one holds the gain there instead.
    expect(transform(grids, { ...TUNING, reachGainMin: MID_GAIN }).gain).toBe(MID_GAIN);
  });
});

/** One wrist's grid: from genGrid, or one from genGrid marked all-valid (Req 11.15). */
function genAnyGrid(): fc.Arbitrary<ComfortGrid> {
  return fc.oneof(
    { arbitrary: genGrid(), weight: 4 },
    { arbitrary: genGrid().map(markAllValid), weight: 1 },
  );
}

/**
 * The grids of the active wrists: the right wrist's, the left wrist's, or both. Each is
 * a plain object, as calibration builds them. fc.record alone gives an object with no
 * prototype, and structuredClone gives back a plain one, so toStrictEqual reports the
 * two as different though every value is the same: without noNullPrototype,
 * reachgain_in_range_and_cells_stable failed on seed 265693639 with "Compared values
 * have no visual difference". A fault of the test, not of computeComfortTransform.
 */
function genWristGrids(): fc.Arbitrary<WristGrids> {
  return fc.oneof(
    genAnyGrid().map((right): WristGrids => ({ right })),
    genAnyGrid().map((left): WristGrids => ({ left })),
    fc.record({ left: genAnyGrid(), right: genAnyGrid() }, { noNullPrototype: true }),
  );
}

/** Whether any of the grids has a valid cell at TUNING's threshold. */
function hasValidCell(grids: WristGrids): boolean {
  return Object.values(grids).some((grid) => grid !== undefined && validCells(grid, TUNING).length > 0);
}

// Req 13.6: for all grids, the gain lies in reachGainMin..reachGainMax (1.0..1.6 as
// shipped), and the set of valid cells is the same before and after. The test compares
// the grids whole, deep-equal before and after, so no count and no all-valid mark may
// change: that is stronger than the same set of valid cells. The grids are not frozen,
// so a write to them would go through and show here. The aspects A and a come from
// genMappingParams.
it('reachgain_in_range_and_cells_stable', () => {
  fc.assert(
    fc.property(genMappingParams(), genWristGrids(), ({ playAspect, frameAspect }, grids) => {
      const before = structuredClone(grids);
      const { gain } = computeComfortTransform(grids, frameAspect, playAspect, TUNING);
      expect(gain).toBeGreaterThanOrEqual(TUNING.reachGainMin);
      expect(gain).toBeLessThanOrEqual(TUNING.reachGainMax);
      expect(grids).toStrictEqual(before);
    }),
  );
});

// A property is only as strong as its samples. These are drawn as for
// reachgain_in_range_and_cells_stable, from a fixed seed so that the check is the same
// on every run, and they reach every branch: no valid cell, the gain held at each end
// of the clamp, and a gain strictly between the two.
it('the samples of reachgain_in_range_and_cells_stable reach no valid cell, the gain held at reachGainMin and at reachGainMax, and a gain between them', () => {
  const samples = fc.sample(fc.tuple(genMappingParams(), genWristGrids()), SAMPLE);
  const outcomes = samples.map(([{ playAspect, frameAspect }, grids]) => ({
    valid: hasValidCell(grids),
    gain: computeComfortTransform(grids, frameAspect, playAspect, TUNING).gain,
  }));
  const { reachGainMin: min, reachGainMax: max } = TUNING;
  expect({
    noValidCell: outcomes.some((o) => !o.valid),
    atFloor: outcomes.some((o) => o.valid && o.gain === min),
    atCap: outcomes.some((o) => o.valid && o.gain === max),
    between: outcomes.some((o) => o.gain > min && o.gain < max),
  }).toEqual({ noValidCell: true, atFloor: true, atCap: true, between: true });
});

describe('marrow/core', () => {
  it('exports computeComfortTransform (design section 6)', () => {
    expect(core.computeComfortTransform).toBe(computeComfortTransform);
  });
});
