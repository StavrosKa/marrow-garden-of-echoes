// The comfort grid (Requirement 11.1-11.3): for one wrist, the number of valid
// samples in each cell of a gridCols x gridRows grid over camera space. Calibration
// keeps one grid per active wrist and adds a sample for each consumed frame in which
// that wrist is valid (design section 3).
//
// Camera space is 0..1 on each axis and is not mirrored (glossary). Cell (col, row)
// is the half-open rectangle [col / cols, (col + 1) / cols) x [row / rows,
// (row + 1) / rows) that cellRectCamera computes (design section 9.2), and a sample is
// counted in the cell whose rectangle holds it, with x = 1 and y = 1, which no
// half-open rectangle holds, in the last column and row (Req 11.2). So a point on a
// cell's right edge, or on its upper edge in y, is counted in the next cell.
// floor(x * cols) finds the column except where rounding puts x one cell off, which
// cellIndex corrects. The 0 and 1 of the frame edges are geometry, not tuning values.
//
// A grid is never changed in place: addSample and markAllValid return a new grid.
// The grid records its size, because addSample has no tuning argument. It does not
// record the threshold: isCellValid compares a cell's count with the
// cellValidSamples of the tuning it is given (Req 11.3). markAllValid sets a flag
// and leaves the counts alone, so every cell of a marked grid is valid at any
// threshold, and the counts stay the samples that were really added.
//
// cellIndex, cellRectCamera and validCells are internal (design section 6): reached by
// relative import inside packages/marrow, not exported from marrow/core. aura.ts uses
// cellIndex, so a point is in the cell addSample counts it in.
import type { Vec2 } from './frame';
import type { Tuning } from './tuning';

/** A cell's column and row. Column 0 lies at x = 0 and row 0 at y = 0, in camera space. */
export interface CellIndex {
  readonly col: number;
  readonly row: number;
}

/** A cell's half-open rectangle in camera space: x0 <= x < x1 and y0 <= y < y1 (design section 9.2). */
export interface CellRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** One wrist's comfort grid (Req 11.1). Never changed in place. */
export interface ComfortGrid {
  /** The number of columns: gridCols of the tuning the grid was created with. */
  readonly cols: number;
  /** The number of rows: gridRows of the tuning the grid was created with. */
  readonly rows: number;
  /**
   * The samples added to each cell, row by row: cell (col, row) is at row * cols + col.
   * Read validity with isCellValid or validCells, never from the counts alone.
   */
  readonly counts: readonly number[];
  /**
   * Set by markAllValid, for "Use the whole screen" (Req 11.15): every cell is valid,
   * whatever its count and whatever threshold isCellValid is given.
   */
  readonly allValid: boolean;
}

/** An empty grid of gridCols x gridRows cells, with no sample in any cell (Req 11.1). */
export function createGrid(tuning: Tuning): ComfortGrid {
  const cols = tuning.gridCols;
  const rows = tuning.gridRows;
  return { cols, rows, counts: Array.from({ length: cols * rows }, () => 0), allValid: false };
}

/** Whether v lies in the frame on one axis: 0 <= v <= 1 (Req 2.5). False for NaN. */
function inFrame(v: number): boolean {
  return v >= 0 && v <= 1;
}

/**
 * The cell that holds v, for v in 0..1, on an axis of n cells: the i with
 * i / n <= v < (i + 1) / n, the interval cellRectCamera computes, and n - 1 for v = 1
 * (Req 11.2, design section 9.2). floor(v * n) gives that i or a neighbour, because
 * v * n and i / n are rounded separately: (1 / 49) * 49 is just below 1, and for some
 * sizes the largest number below an edge, times n, rounds up to the edge's index. So
 * the index moves down by one when v is below its interval, and up by one when v is at
 * or past the interval's end. For the sizes validateTuning allows, one step is enough.
 * Internal: addSample and the aura use it, and it is not on the marrow/core barrel.
 */
export function cellIndex(v: number, n: number): number {
  let i = Math.floor(v * n);
  if (v < i / n) i -= 1;
  else if (v >= (i + 1) / n) i += 1;
  return Math.min(i, n - 1);
}

/**
 * The grid with one more sample in the cell that holds camPos (Req 11.2). A position
 * outside the frame, or with NaN, lies in no cell and adds nothing: the same grid
 * comes back. Such a position cannot come from a valid wrist (Req 2.5), and counting
 * it in an edge cell would make that cell reachable without its own samples.
 */
export function addSample(grid: ComfortGrid, camPos: Vec2): ComfortGrid {
  if (!inFrame(camPos.x) || !inFrame(camPos.y)) return grid;
  const at = cellIndex(camPos.y, grid.rows) * grid.cols + cellIndex(camPos.x, grid.cols);
  return { ...grid, counts: grid.counts.map((count, i) => (i === at ? count + 1 : count)) };
}

/** Whether (col, row) is a cell of the grid: whole numbers with 0 <= col < cols and 0 <= row < rows. */
function inGrid(grid: ComfortGrid, col: number, row: number): boolean {
  return (
    Number.isInteger(col) &&
    Number.isInteger(row) &&
    col >= 0 &&
    col < grid.cols &&
    row >= 0 &&
    row < grid.rows
  );
}

/** The samples in cell (col, row), for a cell of the grid. */
function countAt(grid: ComfortGrid, col: number, row: number): number {
  return grid.counts[row * grid.cols + col] ?? 0;
}

/**
 * Whether cell (col, row) is valid: it holds at least tuning.cellValidSamples samples
 * (Req 11.3), or the grid is marked all-valid (Req 11.15). A column or row outside the
 * grid is never valid, so a column past the end of a row never reads the next row.
 */
export function isCellValid(grid: ComfortGrid, col: number, row: number, tuning: Tuning): boolean {
  if (!inGrid(grid, col, row)) return false;
  return grid.allValid || countAt(grid, col, row) >= tuning.cellValidSamples;
}

/**
 * The grid with every cell valid, for "Use the whole screen" (Req 11.15). It sets the
 * allValid flag and keeps the counts, so each cell stays valid after more samples and
 * at any threshold isCellValid is given.
 */
export function markAllValid(grid: ComfortGrid): ComfortGrid {
  return { ...grid, allValid: true };
}

/**
 * The half-open rectangle of cell (col, row) in camera space, for the grid size of
 * tuning: [col / gridCols, (col + 1) / gridCols) x [row / gridRows, (row + 1) / gridRows)
 * (design section 9.2). The two cells on either side of an edge compute it the same
 * way, so neighbouring rectangles meet exactly, and together they cover
 * [0, 1) x [0, 1). For 0 <= col < gridCols and 0 <= row < gridRows.
 */
export function cellRectCamera(col: number, row: number, tuning: Tuning): CellRect {
  const cols = tuning.gridCols;
  const rows = tuning.gridRows;
  return { x0: col / cols, y0: row / rows, x1: (col + 1) / cols, y1: (row + 1) / rows };
}

/** The valid cells of the grid (isCellValid), row by row and, within a row, by column. */
export function validCells(grid: ComfortGrid, tuning: Tuning): CellIndex[] {
  const cells: CellIndex[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (isCellValid(grid, col, row, tuning)) cells.push({ col, row });
    }
  }
  return cells;
}
