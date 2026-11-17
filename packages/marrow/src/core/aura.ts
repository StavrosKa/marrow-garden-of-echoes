// The comfort aura (Requirement 15, design sections 9 and 13 question 8): how brightly the
// calibration screen glows at a screen point, from the comfort grids and the Mapping.
//
// The point is converted to camera space with the inverse Mapping. It must lie inside the
// closed camera frame [0, 1]², as in placement (design section 9.2 step 2): x = 1 and y = 1
// are inside and lie in the last column and row, and a point outside the frame gives 0.
// Its cell is found with cellIndex of comfortGrid.ts, the function addSample counts a
// sample with, so a point is in the cell its samples were counted in (Req 11.2).
//
// A cell that is not valid gives 0 (Req 15.2, 15.3), whatever its neighbours: the aura
// never extends past the valid region (Req 15.4). A valid cell has one value, constant
// within the cell: (1 + the number of valid cells among its 8 neighbours) / 9, where a
// neighbour outside the grid counts as not valid. So the value falls towards the edge of
// the valid region and never rises past an interior cell's 1, and it needs no tuning
// value. With two active wrists the point takes the larger of the two wrists' values.
// A grid marked all-valid has every cell valid (isCellValid). Nothing here changes an
// argument (design section 1: a pure function).
import { cellIndex, isCellValid, type ComfortGrid } from './comfortGrid';
import type { Vec2, WristId } from './frame';
import type { Mapping } from './mapping';
import type { WristGrids } from './reachGain';
import type { Tuning } from './tuning';

/** The wrists, in the order the larger value is taken over. The result does not depend on the order. */
const WRISTS: readonly WristId[] = ['left', 'right'];

/** Camera space is 0..1 on each axis, and the frame includes its edges (Req 2.5). Geometry, not tuning values. */
const FRAME_MIN = 0;
const FRAME_MAX = 1;

/** How many cells a cell's neighbourhood reaches on each side: the 8 cells around it. Geometry, not a tuning value. */
const NEIGHBOUR_REACH = 1;
/** The cells in a cell's neighbourhood with the cell itself, 3 x 3. The value of a valid cell is its valid share of these. */
const BLOCK_CELLS = (2 * NEIGHBOUR_REACH + 1) ** 2;

/** Whether v lies in the closed frame on one axis. False for NaN. */
function inFrame(v: number): boolean {
  return v >= FRAME_MIN && v <= FRAME_MAX;
}

/**
 * The aura value of the cell holding the camera point on one wrist's grid: 0 if the cell
 * is not valid, else (1 + the valid cells among its 8 neighbours) / 9.
 */
function cellAura(grid: ComfortGrid, camera: Vec2, tuning: Tuning): number {
  const col = cellIndex(camera.x, grid.cols);
  const row = cellIndex(camera.y, grid.rows);
  if (!isCellValid(grid, col, row, tuning)) return 0;
  // The block holds the cell itself, which is valid, and its neighbours; isCellValid is
  // false for a cell outside the grid, so a neighbour past an edge counts as not valid.
  let valid = 0;
  for (let dRow = -NEIGHBOUR_REACH; dRow <= NEIGHBOUR_REACH; dRow++) {
    for (let dCol = -NEIGHBOUR_REACH; dCol <= NEIGHBOUR_REACH; dCol++) {
      if (isCellValid(grid, col + dCol, row + dRow, tuning)) valid += 1;
    }
  }
  return valid / BLOCK_CELLS;
}

/**
 * The aura intensity at a screen point, in 0..1 (Req 15.1): 0 unless the inverse Mapping of
 * the point lies inside the camera frame and in a valid cell of an active wrist (Req 15.2,
 * 15.3); otherwise the larger of the active wrists' values for that cell. A wrist with no
 * grid is not active. A point with NaN or an infinite coordinate gives 0. The grids, the
 * mapping and the tuning are only read.
 */
export function auraIntensity(screenPt: Vec2, grids: WristGrids, mapping: Mapping, tuning: Tuning): number {
  const camera = mapping.toCamera(screenPt);
  if (!inFrame(camera.x) || !inFrame(camera.y)) return 0;
  let intensity = 0;
  for (const wrist of WRISTS) {
    const grid = grids[wrist];
    if (grid !== undefined) intensity = Math.max(intensity, cellAura(grid, camera, tuning));
  }
  return intensity;
}
