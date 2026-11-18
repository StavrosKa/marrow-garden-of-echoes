import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { auraIntensity } from './aura';
import {
  addSample,
  cellRectCamera,
  createGrid,
  isCellValid,
  markAllValid,
  validCells,
  type CellIndex,
  type ComfortGrid,
} from './comfortGrid';
import type { Vec2, WristId } from './frame';
import * as core from './index';
import { makeMapping, type Mapping, type MappingParams } from './mapping';
import { computeComfortTransform, type WristGrids } from './reachGain';
import { OUTSIDE_MARGIN, genGrid, genMappingParams, genSpread, genVec2Camera } from './testgen';
import { TUNING, type Tuning } from './tuning';

// The grid size and the samples a cell needs come from TUNING or from the tuning argument.
// The aura's numbers, 1 + the valid neighbours out of 9, come from the spec decision (task
// 8) and are written as fractions of 9 below: an interior cell 9/9, a cell on the region's
// side 6/9, a corner 4/9, a lone cell 1/9. They are not tuning values.
//
// EXACT maps a square play area and a square camera image at gain 1 about their centre:
// toCamera(s) = (1 - s.x, s.y). A camera point whose coordinates are multiples of a power
// of two maps to screen and back exactly, which the frame and edge tests need; each of
// them checks that the round trip is exact before it relies on it.
//
// REALISTIC maps a 16:9 play area and a 4:3 camera image at the middle of the gain range
// about the play-area centre; the value tests use the centres of cells under it.

const COLS = TUNING.gridCols;
const ROWS = TUNING.gridRows;
/** The samples a cell needs to be valid. */
const NEEDED = TUNING.cellValidSamples;
/** Halfway: the middle of camera space on each axis. */
const HALF = 1 / 2;
/** The identity scale: no reach gain. Not read from reachGainMin, which is a tuning value. */
const IDENTITY_GAIN = 1;
/** A and a of EXACT. A test parameter. */
const SQUARE = 1;
/** A of REALISTIC, such as a 1920 x 1080 viewport. A test parameter. */
const PLAY_ASPECT = 16 / 9;
/** a of REALISTIC, such as a 640 x 480 camera image. A test parameter. */
const FRAME_ASPECT = 4 / 3;
/** The gain of REALISTIC: the middle of the gain range. */
const MID_GAIN = (TUNING.reachGainMin + TUNING.reachGainMax) / 2;
/** The cells in a cell's neighbourhood with itself: 3 x 3. */
const BLOCK = 9;
/** One ULP of 1: the smallest step from 1 upwards. */
const ONE_ULP = Number.EPSILON;
/** Samples in a cell that is valid, and more than that. */
const PLENTY = 2 * NEEDED;

const EXACT: Mapping = makeMapping({
  playAspect: SQUARE,
  frameAspect: SQUARE,
  gain: IDENTITY_GAIN,
  centre: { x: SQUARE * HALF, y: HALF },
});
const REALISTIC_PARAMS: MappingParams = {
  playAspect: PLAY_ASPECT,
  frameAspect: FRAME_ASPECT,
  gain: MID_GAIN,
  centre: { x: PLAY_ASPECT * HALF, y: HALF },
};
const REALISTIC: Mapping = makeMapping(REALISTIC_PARAMS);

const EMPTY = createGrid(TUNING);
const ALL_VALID = markAllValid(EMPTY);

/** A grid of TUNING's size with `samples` samples in each cell for which `chosen` holds, and none in the others. */
function gridWhere(chosen: (cell: CellIndex) => boolean, samples = NEEDED): ComfortGrid {
  return {
    ...EMPTY,
    counts: EMPTY.counts.map((_, i) => (chosen({ col: i % COLS, row: Math.floor(i / COLS) }) ? samples : 0)),
  };
}

/** A grid in which exactly the given cells hold `samples` samples. */
function gridOf(cells: readonly CellIndex[], samples = NEEDED): ComfortGrid {
  return gridWhere((cell) => cells.some((c) => c.col === cell.col && c.row === cell.row), samples);
}

/** The camera-space centre of a cell, halfway between its edges. */
function cellCentre({ col, row }: CellIndex): Vec2 {
  const { x0, y0, x1, y1 } = cellRectCamera(col, row, TUNING);
  return { x: (x0 + x1) * HALF, y: (y0 + y1) * HALF };
}

/** The aura at the centre of a cell, under REALISTIC, for the right wrist's grid. */
function auraAtCell(cell: CellIndex, grid: ComfortGrid): number {
  return auraIntensity(REALISTIC.toScreen(cellCentre(cell)), { right: grid }, REALISTIC, TUNING);
}

/** A square block of cells: columns col..col + side - 1 and rows row..row + side - 1. */
function block(col: number, row: number, side: number): CellIndex[] {
  const cells: CellIndex[] = [];
  for (let r = row; r < row + side; r++) for (let c = col; c < col + side; c++) cells.push({ col: c, row: r });
  return cells;
}

/** The screen point under EXACT whose camera point is `camera`, or null if the round trip is not exact. */
function exactScreen(camera: Vec2): Vec2 | null {
  const screen = EXACT.toScreen(camera);
  const back = EXACT.toCamera(screen);
  return back.x === camera.x && back.y === camera.y ? screen : null;
}

/** The largest number below a positive finite v. */
function nextBelow(v: number): number {
  const f = new Float64Array([v]);
  const bits = new BigInt64Array(f.buffer);
  bits[0] = (bits[0] ?? 0n) - 1n;
  return f[0] ?? NaN;
}

describe('auraIntensity (Req 15)', () => {
  // A 5 x 5 block of valid cells in the middle of the grid, as an interior, sides and corners.
  const REGION = block(10, 8, 5);
  const region = gridOf(REGION);

  it('gives a valid cell (1 + its valid neighbours) / 9: 1 inside the region, 6/9 on its sides, 4/9 at its corners, constant within the cell', () => {
    expect(auraAtCell({ col: 12, row: 10 }, region)).toBe(BLOCK / BLOCK);
    expect(auraAtCell({ col: 11, row: 9 }, region)).toBe(BLOCK / BLOCK);
    for (const side of [
      { col: 10, row: 10 },
      { col: 14, row: 10 },
      { col: 12, row: 8 },
      { col: 12, row: 12 },
    ]) {
      expect(auraAtCell(side, region)).toBe(6 / BLOCK);
    }
    for (const corner of [
      { col: 10, row: 8 },
      { col: 14, row: 8 },
      { col: 10, row: 12 },
      { col: 14, row: 12 },
    ]) {
      expect(auraAtCell(corner, region)).toBe(4 / BLOCK);
    }
    // The value is the same at every point of a cell: its four corners as half-open edges, pulled in.
    const { x0, y0, x1, y1 } = cellRectCamera(10, 8, TUNING);
    const inset = (x1 - x0) / 8;
    for (const camera of [
      { x: x0, y: y0 },
      { x: x1 - inset, y: y0 },
      { x: x0, y: y1 - inset },
      { x: x1 - inset, y: y1 - inset },
    ]) {
      expect(auraIntensity(REALISTIC.toScreen(camera), { right: region }, REALISTIC, TUNING)).toBeCloseTo(4 / BLOCK, 12);
    }
  });

  it('an edge cell of the region is never brighter than an interior cell, and every cell outside the region gives 0 (Req 15.4)', () => {
    const interior = auraAtCell({ col: 12, row: 10 }, region);
    const inRegion = (cell: CellIndex): boolean => REGION.some((c) => c.col === cell.col && c.row === cell.row);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const value = auraAtCell({ col, row }, region);
        if (inRegion({ col, row })) {
          expect(value).toBeGreaterThan(0);
          expect(value).toBeLessThanOrEqual(interior);
        } else {
          expect(value).toBe(0);
        }
      }
    }
  });

  it('a cell with 1 to cellValidSamples - 1 samples gives 0, even with every neighbour valid (Req 15.3)', () => {
    const hole: CellIndex = { col: 12, row: 10 };
    for (let samples = 1; samples < NEEDED; samples++) {
      const grid: ComfortGrid = {
        ...region,
        counts: region.counts.map((count, i) => (i === hole.row * COLS + hole.col ? samples : count)),
      };
      expect(auraAtCell(hole, grid)).toBe(0);
      // Its neighbours do not count it as valid, and are not brightened by it.
      expect(auraAtCell({ col: 11, row: 10 }, grid)).toBe(8 / BLOCK);
    }
    // One more sample makes it valid.
    expect(auraAtCell(hole, gridOf([...REGION], NEEDED))).toBe(BLOCK / BLOCK);
  });

  it('a grid marked all-valid gives every cell as valid: 1 inside, 6/9 on the grid sides, 4/9 at its corners, whatever the counts', () => {
    const marked = markAllValid(gridWhere((cell) => (cell.col + cell.row) % 2 === 0, 1));
    for (const grid of [ALL_VALID, marked]) {
      expect(auraAtCell({ col: 16, row: 12 }, grid)).toBe(BLOCK / BLOCK);
      for (const side of [
        { col: 0, row: 12 },
        { col: COLS - 1, row: 12 },
        { col: 16, row: 0 },
        { col: 16, row: ROWS - 1 },
      ]) {
        expect(auraAtCell(side, grid)).toBe(6 / BLOCK);
      }
      for (const corner of [
        { col: 0, row: 0 },
        { col: COLS - 1, row: 0 },
        { col: 0, row: ROWS - 1 },
        { col: COLS - 1, row: ROWS - 1 },
      ]) {
        expect(auraAtCell(corner, grid)).toBe(4 / BLOCK);
      }
    }
  });

  it('a neighbour past the end of a row or of the grid counts as not valid: it does not wrap to the other side', () => {
    // (0, 1) and (cols - 1, 0) are neighbours in the row-by-row array, not in the grid.
    expect(auraAtCell({ col: 0, row: 1 }, gridOf([{ col: 0, row: 1 }, { col: COLS - 1, row: 0 }]))).toBe(1 / BLOCK);
    expect(
      auraAtCell({ col: COLS - 1, row: 1 }, gridOf([{ col: COLS - 1, row: 1 }, { col: 0, row: 2 }])),
    ).toBe(1 / BLOCK);
    // A cell in the first row has no cell above it, and one in the last row none below.
    expect(auraAtCell({ col: 5, row: 0 }, gridOf([{ col: 5, row: 0 }, { col: 5, row: ROWS - 1 }]))).toBe(1 / BLOCK);
    expect(auraAtCell({ col: 5, row: ROWS - 1 }, gridOf([{ col: 5, row: ROWS - 1 }, { col: 5, row: 0 }]))).toBe(1 / BLOCK);
  });

  it('the frame is closed: x = 1 and y = 1 are inside and lie in the last column and row, and a point just outside gives 0', () => {
    const at = (camera: Vec2, grid: ComfortGrid): number => {
      const screen = exactScreen(camera);
      expect(screen, `the round trip of (${camera.x}, ${camera.y}) is exact`).not.toBeNull();
      return auraIntensity(screen ?? { x: NaN, y: NaN }, { right: grid }, EXACT, TUNING);
    };
    const past = 1 + ONE_ULP;
    // With every cell valid: the last column, the last row, and their corner.
    expect(at({ x: 1, y: HALF }, ALL_VALID)).toBe(6 / BLOCK);
    expect(at({ x: HALF, y: 1 }, ALL_VALID)).toBe(6 / BLOCK);
    expect(at({ x: 1, y: 1 }, ALL_VALID)).toBe(4 / BLOCK);
    expect(at({ x: 0, y: 0 }, ALL_VALID)).toBe(4 / BLOCK);
    expect(at({ x: 0, y: HALF }, ALL_VALID)).toBe(6 / BLOCK);
    // One ULP outside the frame: 0, on each side and in the corners.
    expect(at({ x: past, y: HALF }, ALL_VALID)).toBe(0);
    expect(at({ x: HALF, y: past }, ALL_VALID)).toBe(0);
    expect(at({ x: past, y: past }, ALL_VALID)).toBe(0);
    expect(at({ x: -ONE_ULP, y: HALF }, ALL_VALID)).toBe(0);
    expect(at({ x: HALF, y: -ONE_ULP }, ALL_VALID)).toBe(0);
    // x = 1 is the last column: with that column not valid and the one before it valid, it gives 0.
    const lastColumnOff = gridWhere((cell) => cell.col < COLS - 1);
    expect(at({ x: 1, y: HALF }, lastColumnOff)).toBe(0);
    const lastRowOff = gridWhere((cell) => cell.row < ROWS - 1);
    expect(at({ x: HALF, y: 1 }, lastRowOff)).toBe(0);
    // And with only the last column valid, x = 1 is in it.
    const onlyLastColumn = gridWhere((cell) => cell.col === COLS - 1);
    expect(at({ x: 1, y: HALF }, onlyLastColumn)).toBe(3 / BLOCK);
  });

  it('a point outside the frame gives 0 whatever the grid, and a NaN or infinite point gives 0', () => {
    const grids = { left: ALL_VALID, right: ALL_VALID };
    for (const screen of [
      REALISTIC.toScreen({ x: -HALF, y: HALF }),
      REALISTIC.toScreen({ x: 2, y: HALF }),
      REALISTIC.toScreen({ x: HALF, y: -HALF }),
      REALISTIC.toScreen({ x: HALF, y: 2 }),
      { x: NaN, y: HALF },
      { x: HALF, y: NaN },
      { x: Infinity, y: HALF },
      { x: HALF, y: -Infinity },
    ]) {
      expect(auraIntensity(screen, grids, REALISTIC, TUNING)).toBe(0);
    }
    expect(auraIntensity(REALISTIC.toScreen({ x: HALF, y: HALF }), grids, REALISTIC, TUNING)).toBe(BLOCK / BLOCK);
  });

  it('finds a point\'s cell with the function addSample uses: a point on or just below each cell edge is in the cell addSample counts it in', () => {
    // A grid with one valid cell, made by addSample at the point itself, gives the lone-cell
    // value at that point, so aura and addSample agree on the cell. Camera points whose round
    // trip under EXACT is exact keep the point the same on both sides. The edges at x in
    // 1/2..3/4 and y in 1/4..1 qualify; the others do not round trip and are skipped.
    const alone = (camera: Vec2): number | null => {
      const screen = exactScreen(camera);
      if (screen === null) return null;
      let grid = EMPTY;
      for (let i = 0; i < NEEDED; i++) grid = addSample(grid, camera);
      expect(validCells(grid, TUNING)).toHaveLength(1);
      return auraIntensity(screen, { right: grid }, EXACT, TUNING);
    };
    const xEdges = Array.from({ length: COLS - 1 }, (_, i) => cellRectCamera(i + 1, 0, TUNING).x0);
    const yEdges = Array.from({ length: ROWS - 1 }, (_, i) => cellRectCamera(0, i + 1, TUNING).y0);
    const tested = { x: 0, y: 0 };
    for (const edge of xEdges) {
      for (const x of [edge, nextBelow(edge)]) {
        const value = alone({ x, y: HALF });
        if (value === null) continue;
        tested.x += 1;
        expect(value, `x = ${x}`).toBe(1 / BLOCK);
      }
    }
    for (const edge of yEdges) {
      for (const y of [edge, nextBelow(edge)]) {
        const value = alone({ x: HALF, y });
        if (value === null) continue;
        tested.y += 1;
        expect(value, `y = ${y}`).toBe(1 / BLOCK);
      }
    }
    // Most edges qualify, so the loop is not empty.
    expect(tested.x).toBeGreaterThan(COLS / 2);
    expect(tested.y).toBeGreaterThan(ROWS);
  });

  it('finds the same cell as addSample for every column count and row count validateTuning allows: floor(v * n) alone is one cell off at some sizes', () => {
    // At 32 columns and 24 rows, the shipped sizes, floor(v * n) is off at some row edges
    // only; at other sizes it is off at columns too (docs/bugs-found.md, "Comfort grid").
    // The grid has one row (or one column) so that the grid is cheap at every size, and
    // the point is mapped to screen and back, so the sample is exactly the point the aura sees.
    const SIZE_MAX = 256;
    const mismatches: string[] = [];
    for (let n = 1; n <= SIZE_MAX; n++) {
      for (const axis of ['x', 'y'] as const) {
        const tuning: Tuning = { ...TUNING, gridCols: axis === 'x' ? n : 1, gridRows: axis === 'y' ? n : 1 };
        for (let k = 1; k < n; k++) {
          const rect = axis === 'x' ? cellRectCamera(k, 0, tuning) : cellRectCamera(0, k, tuning);
          const edge = axis === 'x' ? rect.x0 : rect.y0;
          for (const v of [edge, nextBelow(edge)]) {
            const screen = EXACT.toScreen(axis === 'x' ? { x: v, y: HALF } : { x: HALF, y: v });
            const camera = EXACT.toCamera(screen);
            let grid = createGrid(tuning);
            for (let i = 0; i < NEEDED; i++) grid = addSample(grid, camera);
            const value = auraIntensity(screen, { right: grid }, EXACT, tuning);
            if (value !== 1 / BLOCK) mismatches.push(`${axis} ${v} of ${n} cells: ${value}`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
    // About 3.7 s alone and over 5 s when the whole suite runs in parallel: the limit is raised, not the work cut.
  }, 60_000);

  it('with two active wrists the point takes the larger of their values; a wrist with no grid is not active', () => {
    const cell: CellIndex = { col: 12, row: 10 };
    const side = gridOf(block(12, 10, 2));
    const interior = gridOf(REGION);
    const point = REALISTIC.toScreen(cellCentre(cell));
    const at = (grids: WristGrids): number => auraIntensity(point, grids, REALISTIC, TUNING);
    // The cell is a corner of the 2 x 2 block (value 4/9) and an interior cell of the 5 x 5 block (9/9).
    expect(at({ right: side })).toBe(4 / BLOCK);
    expect(at({ left: interior })).toBe(BLOCK / BLOCK);
    expect(at({ left: interior, right: side })).toBe(BLOCK / BLOCK);
    expect(at({ left: side, right: interior })).toBe(BLOCK / BLOCK);
    // Not the sum or the mean of the two: two corner values stay a corner value.
    expect(at({ left: side, right: side })).toBe(4 / BLOCK);
    // A wrist whose cell is valid gives its value even when the other wrist's cell is not.
    expect(at({ left: EMPTY, right: interior })).toBe(BLOCK / BLOCK);
    expect(at({ left: interior, right: EMPTY })).toBe(BLOCK / BLOCK);
    expect(at({ left: EMPTY, right: EMPTY })).toBe(0);
    expect(at({})).toBe(0);
  });

  it('reads cellValidSamples from the tuning argument', () => {
    const grid = gridOf([...REGION], NEEDED);
    const cell: CellIndex = { col: 12, row: 10 };
    const point = REALISTIC.toScreen(cellCentre(cell));
    const higher: Tuning = { ...TUNING, cellValidSamples: NEEDED + 1 };
    expect(auraIntensity(point, { right: grid }, REALISTIC, TUNING)).toBe(BLOCK / BLOCK);
    expect(auraIntensity(point, { right: grid }, REALISTIC, higher)).toBe(0);
    expect(auraIntensity(point, { right: gridOf([...REGION], PLENTY) }, REALISTIC, higher)).toBe(BLOCK / BLOCK);
  });

  it('leaves the grids, the point, the mapping parameters and the tuning deep-equal to what they were', () => {
    const tuning: Tuning = structuredClone(TUNING);
    const grids: WristGrids = { left: region, right: markAllValid(gridWhere((cell) => cell.row < 3, 1)) };
    const point: Vec2 = REALISTIC.toScreen(cellCentre({ col: 12, row: 10 }));
    const params = structuredClone(REALISTIC_PARAMS);
    const before = structuredClone({ grids, point, params, tuning });
    expect(auraIntensity(point, grids, makeMapping(params), tuning)).toBe(BLOCK / BLOCK);
    expect(auraIntensity({ x: NaN, y: NaN }, grids, makeMapping(params), tuning)).toBe(0);
    expect({ grids, point, params, tuning }).toStrictEqual(before);
  });
});

// ---------------------------------------------------------------------------------
// aura_positive_only_in_valid_cells (Req 15.2, design section 10.2).
//
// Each input holds the grids of the right wrist, the left wrist or both, each from genGrid
// and, one time in five, marked all-valid; a mapping whose aspects come from
// genMappingParams and whose gain and centre come, in half the inputs each, from
// genMappingParams or from computeComfortTransform on the same grids; and up to POINTS_MAX
// screen points. A point is drawn in one of three ways: its x and y from genSpread over the
// play area and OUTSIDE_MARGIN beyond it, so some lie outside the play area; the screen
// image of a point from genVec2Camera, which includes the frame's edges and points outside
// the frame; or the screen image of the centre of a valid cell, so that the positive case
// is reached.
//
// The oracle is written apart from aura.ts. It finds the point's cell by scanning the
// half-open rectangles of cellRectCamera, not with cellIndex, and counts the neighbours by
// coordinates.

/** The most points one input holds. A test parameter. */
const POINTS_MAX = 20;
/** Runs of the property. A test parameter. */
const AURA_RUNS = 300;
/** The time limit of the property, in milliseconds. A test parameter. */
const PROPERTY_TIMEOUT_MS = 60_000;
/** Draws the same inputs on every run, for the coverage check of the inputs. */
const SAMPLE = { numRuns: 1000, seed: 42 };
/** One grid in this many is marked all-valid. A test parameter. */
const ALL_VALID_ONE_IN = 5;

/** Where the gain and centre of an input's mapping come from. */
type CentreSource = 'genMappingParams' | 'computeComfortTransform';

interface AuraCase {
  readonly params: MappingParams;
  readonly source: CentreSource;
  readonly grids: WristGrids;
  readonly points: readonly Vec2[];
}

/** A grid from genGrid, marked all-valid one time in ALL_VALID_ONE_IN. */
function genMaybeAllValid(): fc.Arbitrary<ComfortGrid> {
  return fc.oneof(
    { arbitrary: genGrid(), weight: ALL_VALID_ONE_IN - 1 },
    { arbitrary: genGrid().map(markAllValid), weight: 1 },
  );
}

/** The grids of the active wrists: the right wrist's, the left wrist's or both, as plain objects. */
function genWristGrids(): fc.Arbitrary<WristGrids> {
  return fc.oneof(
    genMaybeAllValid().map((right): WristGrids => ({ right })),
    genMaybeAllValid().map((left): WristGrids => ({ left })),
    fc.record({ left: genMaybeAllValid(), right: genMaybeAllValid() }, { noNullPrototype: true }),
  );
}

/** The active wrists of the grids. */
function activeWrists(grids: WristGrids): WristId[] {
  return (['right', 'left'] as const).filter((wrist) => grids[wrist] !== undefined);
}

/** A screen point with x and y from genSpread over the play area and OUTSIDE_MARGIN beyond it. */
function genSpreadScreenPoint(playAspect: number): fc.Arbitrary<Vec2> {
  return fc.record(
    {
      x: genSpread(-OUTSIDE_MARGIN, playAspect + OUTSIDE_MARGIN),
      y: genSpread(-OUTSIDE_MARGIN, 1 + OUTSIDE_MARGIN),
    },
    { noNullPrototype: true },
  );
}

function genAuraCase(): fc.Arbitrary<AuraCase> {
  return fc
    .record({ base: genMappingParams(), grids: genWristGrids(), fromTransform: fc.boolean() })
    .chain(({ base, grids, fromTransform }) => {
      const params: MappingParams = fromTransform
        ? { ...base, ...computeComfortTransform(grids, base.frameAspect, base.playAspect, TUNING) }
        : base;
      const source: CentreSource = fromTransform ? 'computeComfortTransform' : 'genMappingParams';
      const mapping = makeMapping(params);
      const valid = activeWrists(grids).flatMap((wrist) => validCells(grids[wrist] ?? EMPTY, TUNING));
      const spread = genSpreadScreenPoint(params.playAspect);
      const fromCamera = genVec2Camera().map((camera) => mapping.toScreen(camera));
      const point: fc.Arbitrary<Vec2> =
        valid.length === 0
          ? fc.oneof(spread, fromCamera)
          : fc.oneof(
              spread,
              fromCamera,
              fc.constantFrom(...valid).map((cell) => mapping.toScreen(cellCentre(cell))),
            );
      return fc
        .array(point, { minLength: 1, maxLength: POINTS_MAX })
        .map((points) => ({ params, source, grids, points }));
    });
}

/** The start of each column and of each row in camera space, as cellRectCamera computes them. */
const COLUMN_STARTS = Array.from({ length: COLS }, (_, col) => cellRectCamera(col, 0, TUNING).x0);
const ROW_STARTS = Array.from({ length: ROWS }, (_, row) => cellRectCamera(0, row, TUNING).y0);

/** The index of the cell that holds v, for v in 0..1: the last cell that starts at or before v (Req 11.2). */
function cellOn(starts: readonly number[], v: number): number {
  let i = 0;
  while (i + 1 < starts.length && (starts[i + 1] ?? Infinity) <= v) i++;
  return i;
}

/** The oracle's value for one wrist at a camera point inside the frame: 0 if its cell is not valid, else valid / 9 of the 3 x 3 block. */
function oracleWristValue(grid: ComfortGrid, camera: Vec2): number {
  const col = cellOn(COLUMN_STARTS, camera.x);
  const row = cellOn(ROW_STARTS, camera.y);
  if (!isCellValid(grid, col, row, TUNING)) return 0;
  let valid = 0;
  for (const c of [col - 1, col, col + 1]) {
    for (const r of [row - 1, row, row + 1]) {
      const inside = c >= 0 && c < grid.cols && r >= 0 && r < grid.rows;
      if (inside && isCellValid(grid, c, r, TUNING)) valid += 1;
    }
  }
  return valid / BLOCK;
}

/** The oracle's aura at a screen point, and whether its camera point lies in a valid cell of an active wrist. */
function oracle(point: Vec2, grids: WristGrids, mapping: Mapping): { value: number; inValidCell: boolean } {
  const camera = mapping.toCamera(point);
  const inFrame = camera.x >= 0 && camera.x <= 1 && camera.y >= 0 && camera.y <= 1;
  if (!inFrame) return { value: 0, inValidCell: false };
  const values = activeWrists(grids).map((wrist) => oracleWristValue(grids[wrist] ?? EMPTY, camera));
  const value = Math.max(0, ...values);
  return { value, inValidCell: values.some((v) => v > 0) };
}

it(
  'aura_positive_only_in_valid_cells',
  () => {
    fc.assert(
      fc.property(genAuraCase(), ({ params, grids, points }) => {
        const mapping = makeMapping(params);
        const before = structuredClone({ grids, points });
        for (const point of points) {
          const intensity = auraIntensity(point, grids, mapping, TUNING);
          const expected = oracle(point, grids, mapping);
          const at = `at (${point.x}, ${point.y})`;
          expect(intensity >= 0 && intensity <= 1, `intensity ${intensity} in 0..1 ${at}`).toBe(true);
          // Req 15.2: above 0 only where the inverse Mapping lies in a valid cell of an active wrist.
          expect(intensity > 0 && !expected.inValidCell, `positive outside a valid cell ${at}`).toBe(false);
          // The design's reading of 15.4: every valid cell glows, and the value is the oracle's.
          expect(intensity, `intensity ${at}`).toBe(expected.value);
        }
        expect({ grids, points }).toStrictEqual(before);
      }),
      { numRuns: AURA_RUNS, includeErrorInReport: true },
    );
  },
  PROPERTY_TIMEOUT_MS,
);

// A property is only as strong as its inputs: drawn as for the property, from a fixed seed.
it('the aura inputs reach every source of the mapping, points inside and outside the play area and the frame, valid and not valid cells, a marked grid, and values from 1/9 to 1', () => {
  const cases = fc.sample(genAuraCase(), SAMPLE);
  const seen = {
    paramsSource: false,
    transformSource: false,
    outsidePlayArea: false,
    outsideFrame: false,
    inFrameNotValid: false,
    positive: false,
    full: false,
    partial: false,
    markedGrid: false,
    bothWrists: false,
  };
  for (const { params, source, grids, points } of cases) {
    const mapping = makeMapping(params);
    seen.paramsSource ||= source === 'genMappingParams';
    seen.transformSource ||= source === 'computeComfortTransform';
    seen.markedGrid ||= activeWrists(grids).some((wrist) => grids[wrist]?.allValid === true);
    seen.bothWrists ||= activeWrists(grids).length === 2;
    for (const point of points) {
      const camera = mapping.toCamera(point);
      const inFrame = camera.x >= 0 && camera.x <= 1 && camera.y >= 0 && camera.y <= 1;
      const intensity = auraIntensity(point, grids, mapping, TUNING);
      seen.outsidePlayArea ||= point.x < 0 || point.x > params.playAspect || point.y < 0 || point.y > 1;
      seen.outsideFrame ||= !inFrame;
      seen.inFrameNotValid ||= inFrame && intensity === 0;
      seen.positive ||= intensity > 0;
      seen.full ||= intensity === 1;
      seen.partial ||= intensity > 0 && intensity < 1;
    }
  }
  expect(seen).toEqual({
    paramsSource: true,
    transformSource: true,
    outsidePlayArea: true,
    outsideFrame: true,
    inFrameNotValid: true,
    positive: true,
    full: true,
    partial: true,
    markedGrid: true,
    bothWrists: true,
  });
}, PROPERTY_TIMEOUT_MS);

describe('marrow/core', () => {
  it('exports auraIntensity (design section 6)', () => {
    expect(core.auraIntensity).toBe(auraIntensity);
  });

  it('does not export cellIndex, cellRectCamera or validCells (design section 6)', () => {
    const names: readonly string[] = Object.keys(core);
    expect(names).not.toContain('cellIndex');
    expect(names).not.toContain('cellRectCamera');
    expect(names).not.toContain('validCells');
  });
});
