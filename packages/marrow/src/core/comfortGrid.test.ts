import { describe, expect, expectTypeOf, it } from 'vitest';
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
import type { Vec2 } from './frame';
import * as core from './index';
import { TUNING, validateTuning, type Tuning } from './tuning';

// The grid size and the samples a cell needs always come from TUNING. The other
// numbers are the edges of camera space (0 and 1) and the nearest numbers past them,
// 0.5 for a coordinate well inside the frame or a column that is not a whole number,
// and halves for the middle of a cell or of the grid.

const COLS = TUNING.gridCols;
const ROWS = TUNING.gridRows;
/** The samples a cell needs to be valid. */
const NEEDED = TUNING.cellValidSamples;
/** One more column and one more row than TUNING, to show the size comes from the tuning argument. */
const BIGGER: Tuning = { ...TUNING, gridCols: COLS + 1, gridRows: ROWS + 1 };
/** A cell away from the edges of the grid. */
const MIDDLE: CellIndex = { col: Math.floor(COLS / 2), row: Math.floor(ROWS / 2) };
/** The largest number below 0, and the smallest number above 1. */
const JUST_BELOW_0 = -Number.MIN_VALUE;
const JUST_ABOVE_1 = 1 + Number.EPSILON;
/** A coordinate well inside the frame. */
const INSIDE = 0.5;

/** The grid after `times` samples at pos. */
function addTimes(grid: ComfortGrid, pos: Vec2, times: number): ComfortGrid {
  let result = grid;
  for (let i = 0; i < times; i++) result = addSample(result, pos);
  return result;
}

/** The centre of cell (col, row), from its rectangle. */
function centreOf(col: number, row: number, tuning: Tuning = TUNING): Vec2 {
  const { x0, y0, x1, y1 } = cellRectCamera(col, row, tuning);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** The cells a point is counted in: the valid cells after enough samples at it on an empty grid. */
function cellsOf(pos: Vec2, tuning: Tuning = TUNING): CellIndex[] {
  return validCells(addTimes(createGrid(tuning), pos, tuning.cellValidSamples), tuning);
}

/** Every cell for the grid size of tuning, row by row and, within a row, by column. */
function allCells(tuning: Tuning): CellIndex[] {
  const cells: CellIndex[] = [];
  for (let row = 0; row < tuning.gridRows; row++) {
    for (let col = 0; col < tuning.gridCols; col++) cells.push({ col, row });
  }
  return cells;
}

/** A grid with one valid cell, one cell a sample short of valid, and one sample in the last cell. */
function sampledGrid(): ComfortGrid {
  const grid = addTimes(createGrid(TUNING), centreOf(0, 0), NEEDED);
  return addSample(addTimes(grid, centreOf(MIDDLE.col, MIDDLE.row), NEEDED - 1), { x: 1, y: 1 });
}

/** The largest number below x, for a positive finite x: the next bit pattern down. */
function nextDown(x: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  view.setBigUint64(0, view.getBigUint64(0) - 1n);
  return view.getFloat64(0);
}

/**
 * Where the search for allowed grid sizes stops: far above any size validateTuning
 * accepts, which allowedSizes checks. A test parameter, not a tuning value.
 */
const SIZE_SEARCH_LIMIT = 4096;

/** Every grid size validateTuning accepts for key, with every other value as in TUNING. */
function allowedSizes(key: 'gridCols' | 'gridRows'): number[] {
  const accepted = (n: number): boolean => validateTuning({ ...TUNING, [key]: n }).length === 0;
  // validateTuning accepts one range of whole numbers, so none lies past a rejected limit.
  expect(accepted(SIZE_SEARCH_LIMIT)).toBe(false);
  const sizes = Array.from({ length: SIZE_SEARCH_LIMIT }, (_, n) => n).filter(accepted);
  expect(sizes).toContain(TUNING[key]);
  return sizes;
}

/** The size of the other axis in the tests over every grid size: one cell across. */
const ONE_CELL = 1;

/**
 * One axis of the grid, for the tests over every grid size. A cell's column depends only
 * on x and gridCols, and its row only on y and gridRows (Req 11.2), so each axis is
 * tested on a grid one cell across the other way. That keeps each grid small enough to
 * test every size.
 */
interface Axis {
  /** The tuning key of the axis's size. */
  readonly key: 'gridCols' | 'gridRows';
  /** What a cell is called on the axis, for the test names and messages. */
  readonly cell: 'column' | 'row';
  /** TUNING with n cells on the axis and one across the other. */
  readonly tuning: (n: number) => Tuning;
  /** The point at v on the axis, inside the frame on the other. */
  readonly point: (v: number) => Vec2;
  /** A cell's index on the axis. */
  readonly index: (cell: CellIndex) => number;
  /** The half-open interval [lo, hi) of cell i on the axis, as cellRectCamera computes it. */
  readonly interval: (i: number, tuning: Tuning) => { readonly lo: number; readonly hi: number };
}

// y grows downwards in camera space, so the edge between rows k - 1 and k is the
// upper edge in y of row k - 1, and its lower side in the image.
const AXES: readonly Axis[] = [
  {
    key: 'gridCols',
    cell: 'column',
    tuning: (n) => ({ ...TUNING, gridCols: n, gridRows: ONE_CELL }),
    point: (v) => ({ x: v, y: INSIDE }),
    index: ({ col }) => col,
    interval: (i, tuning) => {
      const { x0, x1 } = cellRectCamera(i, 0, tuning);
      return { lo: x0, hi: x1 };
    },
  },
  {
    key: 'gridRows',
    cell: 'row',
    tuning: (n) => ({ ...TUNING, gridCols: ONE_CELL, gridRows: n }),
    point: (v) => ({ x: INSIDE, y: v }),
    index: ({ row }) => row,
    interval: (i, tuning) => {
      const { y0, y1 } = cellRectCamera(0, i, tuning);
      return { lo: y0, hi: y1 };
    },
  },
];

/** The indices of the internal edges of an axis with n cells: edge k lies between cells k - 1 and k. */
function internalEdges(n: number): number[] {
  return Array.from({ length: n - 1 }, (_, i) => i + 1);
}

/** Whether two lists of indices are the same. */
function sameIndices(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** What the tests over every grid size need for one size n of an axis. */
interface SizeCase {
  readonly n: number;
  /** TUNING with n cells on the axis and one across the other. */
  readonly tuning: Tuning;
  /** The empty grid for tuning, shared by every point tested at this size. */
  readonly empty: ComfortGrid;
}

/**
 * For every size of the axis that validateTuning allows, the problems `check` finds,
 * one line per size that has any: "gridRows = n: ...". Empty when there are none.
 */
function problemsAtEverySize(axis: Axis, check: (size: SizeCase) => string[]): string[] {
  return allowedSizes(axis.key).flatMap((n) => {
    const tuning = axis.tuning(n);
    const problems = check({ n, tuning, empty: createGrid(tuning) });
    return problems.length > 0 ? [`${axis.key} = ${n}: ${problems.join('; ')}`] : [];
  });
}

/**
 * The cells addSample counts one sample at v in, for one size, as indices on the axis:
 * every cell whose count it raised, read from the counts (cell (col, row) is at
 * row * cols + col). Reading the counts is what keeps the tests over every size fast.
 */
function countedAt(axis: Axis, { empty }: SizeCase, v: number): number[] {
  const { counts, cols } = addSample(empty, axis.point(v));
  const cells: number[] = [];
  counts.forEach((count, i) => {
    if (count > 0) cells.push(axis.index({ col: i % cols, row: Math.floor(i / cols) }));
  });
  return cells;
}

/** The indices of the intervals that hold v. */
function holding(intervals: readonly { readonly lo: number; readonly hi: number }[], v: number): number[] {
  const cells: number[] = [];
  intervals.forEach(({ lo, hi }, i) => {
    if (lo <= v && v < hi) cells.push(i);
  });
  return cells;
}

/** A list of cells of the axis, for a message: "row 5", or "no row". */
function named(axis: Axis, cells: readonly number[]): string {
  return cells.length === 0 ? `no ${axis.cell}` : `${axis.cell} ${cells.join(', ')}`;
}

describe('createGrid (Req 11.1)', () => {
  it('starts with no valid cell', () => {
    expect(validCells(createGrid(TUNING), TUNING)).toEqual([]);
  });

  it('has gridCols x gridRows cells, taken from the tuning argument', () => {
    for (const tuning of [TUNING, BIGGER]) {
      expect(validCells(markAllValid(createGrid(tuning)), tuning)).toEqual(allCells(tuning));
      expect(cellsOf({ x: 1, y: 1 }, tuning)).toEqual([
        { col: tuning.gridCols - 1, row: tuning.gridRows - 1 },
      ]);
    }
  });
});

describe('addSample (Req 11.2)', () => {
  it('counts x = 1 and y = 1 in the last column and row, and x = 0 and y = 0 in the first', () => {
    const mid = centreOf(MIDDLE.col, MIDDLE.row);
    expect(cellsOf({ x: 1, y: 1 })).toEqual([{ col: COLS - 1, row: ROWS - 1 }]);
    expect(cellsOf({ x: 1, y: mid.y })).toEqual([{ col: COLS - 1, row: MIDDLE.row }]);
    expect(cellsOf({ x: mid.x, y: 1 })).toEqual([{ col: MIDDLE.col, row: ROWS - 1 }]);
    expect(cellsOf({ x: 0, y: 0 })).toEqual([{ col: 0, row: 0 }]);
  });

  // The edges below are the ones cellRectCamera computes: edge k is the upper end of
  // cell k - 1's interval, the right edge of a column or the upper edge in y of a row.
  // Rounding is monotone, so floor(v * n) for a v between two tested points lies
  // between its values at them. With every edge and the number just below it in the
  // right cell, one step of cellIndex's correction is enough for every v at that size.
  for (const axis of AXES) {
    it(`counts a point exactly on each internal edge in the next ${axis.cell}, for every ${axis.key} validateTuning allows`, () => {
      const problems = problemsAtEverySize(axis, (size) =>
        internalEdges(size.n).flatMap((k) => {
          const counted = countedAt(axis, size, axis.interval(k - 1, size.tuning).hi);
          return sameIndices(counted, [k]) ? [] : [`edge ${k} counted in ${named(axis, counted)}`];
        }),
      );
      expect(problems).toEqual([]);
    });

    it(`counts the largest double below each internal edge in the ${axis.cell} before it, for every ${axis.key} validateTuning allows`, () => {
      const problems = problemsAtEverySize(axis, (size) =>
        internalEdges(size.n).flatMap((k) => {
          const counted = countedAt(axis, size, nextDown(axis.interval(k - 1, size.tuning).hi));
          return sameIndices(counted, [k - 1]) ? [] : [`below edge ${k} counted in ${named(axis, counted)}`];
        }),
      );
      expect(problems).toEqual([]);
    });

    // The rectangles are the oracle here: every cell whose interval holds the point,
    // found by scanning them all, with 1 in the last cell (Req 11.2).
    it(`counts each of those points, and 0, the largest double below 1 and 1, in the ${axis.cell} whose cellRectCamera rectangle holds it, for every ${axis.key} validateTuning allows`, () => {
      const problems = problemsAtEverySize(axis, (size) => {
        const { n, tuning } = size;
        const intervals = Array.from({ length: n }, (_, i) => axis.interval(i, tuning));
        const edges = internalEdges(n).map((k) => axis.interval(k - 1, tuning).hi);
        const points = [0, ...edges, ...edges.map(nextDown), nextDown(1), 1];
        return points.flatMap((v) => {
          const counted = countedAt(axis, size, v);
          const held = v === 1 ? [n - 1] : holding(intervals, v);
          return sameIndices(counted, held)
            ? []
            : [`${v} counted in ${named(axis, counted)}, held by the rectangle of ${named(axis, held)}`];
        });
      });
      expect(problems).toEqual([]);
    });
  }

  it('counts a point at the centre of each cell in that cell', () => {
    for (const cell of allCells(TUNING)) {
      expect(cellsOf(centreOf(cell.col, cell.row))).toEqual([cell]);
    }
  });

  it('adds nothing for a position outside the frame or with NaN, and returns the same grid', () => {
    const grid = sampledGrid();
    const outside: Vec2[] = [
      { x: JUST_BELOW_0, y: INSIDE },
      { x: JUST_ABOVE_1, y: INSIDE },
      { x: INSIDE, y: JUST_BELOW_0 },
      { x: INSIDE, y: JUST_ABOVE_1 },
      { x: NaN, y: INSIDE },
      { x: INSIDE, y: NaN },
    ];
    for (const pos of outside) {
      expect(addSample(grid, pos)).toBe(grid);
    }
  });
});

describe('isCellValid (Req 11.3)', () => {
  it('cellValidSamples - 1 samples leave a cell invalid, and cellValidSamples make it valid', () => {
    const pos = centreOf(MIDDLE.col, MIDDLE.row);
    const short = addTimes(createGrid(TUNING), pos, NEEDED - 1);
    expect(isCellValid(short, MIDDLE.col, MIDDLE.row, TUNING)).toBe(false);
    expect(validCells(short, TUNING)).toEqual([]);

    const enough = addSample(short, pos);
    expect(isCellValid(enough, MIDDLE.col, MIDDLE.row, TUNING)).toBe(true);
    expect(validCells(enough, TUNING)).toEqual([MIDDLE]);
  });

  it('takes cellValidSamples from the tuning argument', () => {
    const higher: Tuning = { ...TUNING, cellValidSamples: NEEDED + 1 };
    const pos = centreOf(MIDDLE.col, MIDDLE.row);
    const grid = addTimes(createGrid(TUNING), pos, NEEDED);
    expect(isCellValid(grid, MIDDLE.col, MIDDLE.row, TUNING)).toBe(true);
    expect(isCellValid(grid, MIDDLE.col, MIDDLE.row, higher)).toBe(false);
    expect(isCellValid(addSample(grid, pos), MIDDLE.col, MIDDLE.row, higher)).toBe(true);
  });

  it('is false for a column or row outside the grid, even on a grid marked all-valid', () => {
    const grid = markAllValid(createGrid(TUNING));
    const outside: [number, number][] = [
      [-1, 0],
      [COLS, 0],
      [0, -1],
      [0, ROWS],
      [INSIDE, 0],
      [0, INSIDE],
      [NaN, 0],
      [0, NaN],
    ];
    for (const [col, row] of outside) {
      expect(isCellValid(grid, col, row, TUNING)).toBe(false);
    }
  });
});

describe('markAllValid (Req 11.15)', () => {
  it('makes every cell valid at any threshold, and every cell stays valid after more samples', () => {
    const marked = markAllValid(sampledGrid());
    const more = addSample(marked, centreOf(MIDDLE.col, MIDDLE.row));
    // MAX_SAFE_INTEGER is above any count, so cells valid at it are valid by the mark alone.
    for (const cellValidSamples of [NEEDED, NEEDED + 1, Number.MAX_SAFE_INTEGER]) {
      const tuning: Tuning = { ...TUNING, cellValidSamples };
      expect(validCells(marked, tuning)).toEqual(allCells(TUNING));
      expect(validCells(more, tuning)).toEqual(allCells(TUNING));
    }
  });

  it('keeps the counts, so they stay the samples that were really added', () => {
    const grid = sampledGrid();
    expect(markAllValid(grid).counts).toEqual(grid.counts);
  });
});

describe('validCells', () => {
  it('lists each valid cell once, row by row and, within a row, by column', () => {
    let grid = addTimes(createGrid(TUNING), centreOf(0, ROWS - 1), 2 * NEEDED);
    grid = addTimes(grid, centreOf(COLS - 1, 0), NEEDED);
    grid = addTimes(grid, centreOf(MIDDLE.col, MIDDLE.row), NEEDED - 1);
    grid = addTimes(grid, centreOf(0, 0), NEEDED);
    expect(validCells(grid, TUNING)).toEqual([
      { col: 0, row: 0 },
      { col: COLS - 1, row: 0 },
      { col: 0, row: ROWS - 1 },
    ]);
  });
});

describe('cellRectCamera (design section 9.2)', () => {
  it('gives cell (col, row) the rectangle [col / gridCols, (col + 1) / gridCols) x [row / gridRows, (row + 1) / gridRows)', () => {
    for (const { col, row } of allCells(TUNING)) {
      expect(cellRectCamera(col, row, TUNING)).toEqual({
        x0: col / COLS,
        y0: row / ROWS,
        x1: (col + 1) / COLS,
        y1: (row + 1) / ROWS,
      });
    }
  });

  it('tiles the frame for the grid size of the tuning argument: from (0, 0) to (1, 1), each cell ending exactly where the next begins', () => {
    for (const tuning of [TUNING, BIGGER]) {
      const { gridCols: cols, gridRows: rows } = tuning;
      expect(cellRectCamera(0, 0, tuning)).toMatchObject({ x0: 0, y0: 0 });
      expect(cellRectCamera(cols - 1, rows - 1, tuning)).toMatchObject({ x1: 1, y1: 1 });
      for (let col = 0; col < cols - 1; col++) {
        expect(cellRectCamera(col, 0, tuning).x1).toBe(cellRectCamera(col + 1, 0, tuning).x0);
      }
      for (let row = 0; row < rows - 1; row++) {
        expect(cellRectCamera(0, row, tuning).y1).toBe(cellRectCamera(0, row + 1, tuning).y0);
      }
    }
  });
});

// Each test takes a deep copy of every input before the call and compares the input
// with it afterwards. TUNING is frozen, so the tests pass a mutable deep copy of it:
// a write to any input would go through and show in the comparison.
describe('inputs are unchanged after each call', () => {
  /** A mutable deep copy of TUNING. */
  const tuningCopy = (): Tuning => structuredClone(TUNING);
  /** Grids with samples, without and with the all-valid mark. */
  const grids = (): ComfortGrid[] => [sampledGrid(), markAllValid(sampledGrid())];

  it('createGrid', () => {
    const tuning = tuningCopy();
    const before = structuredClone(tuning);
    createGrid(tuning);
    expect(tuning).toStrictEqual(before);
  });

  it('addSample, which returns a new grid with the sample', () => {
    const inFrame: Vec2[] = [centreOf(0, 0), centreOf(MIDDLE.col, MIDDLE.row), { x: 1, y: 1 }];
    const outside: Vec2[] = [{ x: NaN, y: INSIDE }];
    for (const grid of grids()) {
      for (const pos of [...inFrame, ...outside]) {
        const before = structuredClone({ grid, pos });
        const after = addSample(grid, pos);
        expect({ grid, pos }).toStrictEqual(before);
        if (inFrame.includes(pos)) {
          expect(after).not.toBe(grid);
          expect(after).not.toStrictEqual(before.grid);
        }
      }
    }
  });

  it('isCellValid', () => {
    const tuning = tuningCopy();
    const cells: CellIndex[] = [{ col: 0, row: 0 }, MIDDLE, { col: COLS - 1, row: ROWS - 1 }, { col: COLS, row: 0 }];
    for (const grid of grids()) {
      const before = structuredClone({ grid, tuning });
      for (const { col, row } of cells) isCellValid(grid, col, row, tuning);
      expect({ grid, tuning }).toStrictEqual(before);
    }
  });

  it('markAllValid, which returns a new grid', () => {
    for (const grid of grids()) {
      const before = structuredClone(grid);
      const marked = markAllValid(grid);
      expect(grid).toStrictEqual(before);
      expect(marked).not.toBe(grid);
      expect(marked.allValid).toBe(true);
    }
  });

  it('cellRectCamera', () => {
    const tuning = tuningCopy();
    const before = structuredClone(tuning);
    cellRectCamera(MIDDLE.col, MIDDLE.row, tuning);
    expect(tuning).toStrictEqual(before);
  });

  it('validCells', () => {
    const tuning = tuningCopy();
    for (const grid of grids()) {
      const before = structuredClone({ grid, tuning });
      validCells(grid, tuning);
      expect({ grid, tuning }).toStrictEqual(before);
    }
  });
});

describe('marrow/core', () => {
  it('exports createGrid, addSample, isCellValid, markAllValid and ComfortGrid, but not cellRectCamera or validCells (design section 6)', () => {
    expect(core.createGrid).toBe(createGrid);
    expect(core.addSample).toBe(addSample);
    expect(core.isCellValid).toBe(isCellValid);
    expect(core.markAllValid).toBe(markAllValid);
    expect(Object.keys(core)).not.toContain('cellRectCamera');
    expect(Object.keys(core)).not.toContain('validCells');
    // Checked by the type checker (npm run typecheck). At runtime this line does nothing.
    expectTypeOf<core.ComfortGrid>().toEqualTypeOf<ComfortGrid>();
  });
});
