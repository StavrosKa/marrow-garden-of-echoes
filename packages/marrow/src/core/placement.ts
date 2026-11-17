// Placement in the comfort region (Requirement 14, design section 9.2): which slots a
// wrist can reach, and which of them a demand uses.
//
// A slot is usable by a wrist when every point of the closed screen disc of radius
// R = r + m around it, mapped to camera space, lies inside the closed frame [0, 1]²
// and in no closed rectangle of a cell of that wrist that is not valid (Req 14.2). A
// point inside the frame lies in some half-open cell (Req 11.2), whose closed rectangle
// holds it, so such a disc lies in the wrist's valid cells (Req 14.8). The test:
//   1. The mapping is affine with a diagonal Jacobian, so the disc maps to an
//      axis-aligned ellipse. Its centre is toCamera(slot). Its extremes on each axis are
//      the mapped points toCamera(slot -+ (R, 0)) and toCamera(slot -+ (0, R)), which
//      this file uses as they are, never as centre -+ semi-axis: that sum need not round
//      back to the mapped point. The semi-axis on each axis is the larger of the two
//      distances from the centre to those extremes. Mapping has only toScreen and
//      toCamera, and they are all this needs. Dividing x by the x semi-axis and y by the
//      y semi-axis makes the ellipse the unit circle, and the cells stay axis-aligned
//      rectangles.
//   2. The frame is closed: the disc leaves it only if one of its points lies strictly
//      outside [0, 1]², so x = 1 and y = 1 are inside, as for a valid landmark (Req 2.5).
//      Every point of the disc maps between the extremes, because toCamera is monotone
//      on each axis in floating point, so the frame test compares the four extreme
//      coordinates themselves with 0 and 1.
//   3. A cell counts when the distance from the centre to the cell's closed rectangle, in
//      those rescaled units, is at most 1. A half-open cell holds its edges at
//      x = col / cols and y = row / rows, so a disc tangent to one of them from outside
//      has a point in that cell, which a strict < would miss. The closed rectangle also
//      counts a cell that the disc touches only on its open edge at x = (col + 1) / cols
//      or y = (row + 1) / rows, a point that belongs to the next cell. Such a slot is
//      rejected although its disc is covered, and no slot with an uncovered point is
//      accepted.
// Every cell of the grid is tested, not a range of cells found with floor(): at an exact
// tangency, a range from floor() can miss the neighbour whose closed rectangle the
// ellipse touches.
//
// Each wrist is checked alone (Req 14.3), and nothing here changes a grid (Req 14.7).
// The caller supplies a finite slot and mapping, r + m > 0 so that both semi-axes are
// above 0, m >= 0, n >= 1, and grids of the size of the tuning it passes. Nothing here
// checks them or throws. The frame test is written as four comparisons that must all
// hold, so a NaN slot or radius puts the disc outside the frame and the slot is unusable.
import { cellRectCamera, isCellValid, type CellRect, type ComfortGrid } from './comfortGrid';
import type { Vec2, WristId } from './frame';
import { dist } from './geometry';
import type { Mapping } from './mapping';
import type { WristGrids } from './reachGain';
import type { Tuning } from './tuning';

/** What placement is asked for (Req 14.1, design section 14.2). */
export interface Demand {
  /** The candidate target centres in screen space, in the caller's order (Req 14.4). */
  readonly slots: readonly Vec2[];
  /** N: how many targets are needed, at least 1. */
  readonly n: number;
  /** r: the hit radius in screen space. */
  readonly r: number;
  /** m: the parallax margin, at least 0. A slot's expanded circle has radius r + m. */
  readonly m: number;
}

/**
 * The outcome of placeTargets (Req 14.4-14.6). Every slot in it is one of the caller's
 * own slot objects, and the slots keep the caller's order.
 *   simultaneous: the n chosen slots, whose expanded circles are pairwise disjoint.
 *                 Target i is shown at slots[i], all targets at once (Req 14.4).
 *   sequential:   fewer than n could be chosen at once. slots holds all k usable slots,
 *                 also those the pass skipped, and targetSlots has n entries: target i is
 *                 shown alone at targetSlots[i], which is slots[i mod k] (Req 14.5).
 *   none:         no slot is usable (Req 14.6).
 */
export type PlacementResult =
  | { readonly kind: 'simultaneous'; readonly slots: readonly Vec2[] }
  | {
      readonly kind: 'sequential';
      readonly slots: readonly Vec2[];
      readonly targetSlots: readonly Vec2[];
    }
  | { readonly kind: 'none' };

/**
 * The wrists in the order isSlotUsable tries them. When both wrists cover a slot it
 * returns 'right', which follows the tie rule of Req 17.4: an exact tie in ownership
 * goes to the right wrist.
 */
const WRISTS: readonly WristId[] = ['right', 'left'];

/** Camera space is 0..1 on each axis, and the frame includes its edges (Req 2.5). Geometry, not tuning values. */
const FRAME_MIN = 0;
const FRAME_MAX = 1;
/**
 * The radius of the circle the ellipse becomes once x is divided by its x semi-axis and
 * y by its y semi-axis (design section 9.2 step 1). Geometry, not a tuning value.
 */
const UNIT_RADIUS = 1;

/** The closed disc around a slot in camera space: an axis-aligned ellipse (design section 9.2 step 1). */
interface CameraEllipse {
  readonly cx: number;
  readonly cy: number;
  /** The smallest and largest camera x of the disc: the coordinates of its mapped extreme points. */
  readonly xLo: number;
  readonly xHi: number;
  /** The smallest and largest camera y of the disc: the coordinates of its mapped extreme points. */
  readonly yLo: number;
  readonly yHi: number;
  /**
   * The semi-axis along x, in camera units: the larger of the distances from the centre to
   * xLo and to xHi. Both are at most this, so no cell the disc meets is missed, and a
   * cell edge at either extreme is at a distance of at most 1 rescaled unit.
   */
  readonly rx: number;
  /** The semi-axis along y, in camera units: the larger of the distances from the centre to yLo and to yHi. */
  readonly ry: number;
}

/** The closed screen disc of the given radius around the slot, mapped to camera space with toCamera. */
function cameraEllipse(slot: Vec2, mapping: Mapping, radius: number): CameraEllipse {
  const centre = mapping.toCamera(slot);
  const left = mapping.toCamera({ x: slot.x - radius, y: slot.y });
  const right = mapping.toCamera({ x: slot.x + radius, y: slot.y });
  const above = mapping.toCamera({ x: slot.x, y: slot.y - radius });
  const below = mapping.toCamera({ x: slot.x, y: slot.y + radius });
  // The mapping mirrors x, so the point to the right of the slot has the smaller camera x.
  const xLo = Math.min(left.x, right.x);
  const xHi = Math.max(left.x, right.x);
  const yLo = Math.min(above.y, below.y);
  const yHi = Math.max(above.y, below.y);
  return {
    cx: centre.x,
    cy: centre.y,
    xLo,
    xHi,
    yLo,
    yHi,
    rx: Math.max(xHi - centre.x, centre.x - xLo),
    ry: Math.max(yHi - centre.y, centre.y - yLo),
  };
}

/**
 * Whether the disc lies inside the closed frame [0, 1]² (design section 9.2 step 2). It
 * leaves the frame only if a point lies strictly outside, so a disc that touches x = 0,
 * x = 1, y = 0 or y = 1 from inside is still in the frame. The mapped extreme points are
 * compared with the edges themselves. NaN gives false.
 */
function inFrame({ xLo, xHi, yLo, yHi }: CameraEllipse): boolean {
  return xLo >= FRAME_MIN && xHi <= FRAME_MAX && yLo >= FRAME_MIN && yHi <= FRAME_MAX;
}

/**
 * Whether the closed ellipse meets the closed rectangle (design section 9.2 step 3): the
 * distance from the centre to the rectangle, with x divided by rx and y by ry, is at
 * most UNIT_RADIUS. Tangent counts as meeting, on every edge of the rectangle.
 */
function meets({ cx, cy, rx, ry }: CameraEllipse, { x0, y0, x1, y1 }: CellRect): boolean {
  // How far the centre lies outside the rectangle along each axis: 0 within its span.
  const u = Math.max(x0 - cx, 0, cx - x1) / rx;
  const v = Math.max(y0 - cy, 0, cy - y1) / ry;
  return u * u + v * v <= UNIT_RADIUS * UNIT_RADIUS;
}

/** Whether the ellipse meets no cell of the grid that is not valid, each cell taken as its closed rectangle. */
function coveredBy(grid: ComfortGrid, ellipse: CameraEllipse, tuning: Tuning): boolean {
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (!isCellValid(grid, col, row, tuning) && meets(ellipse, cellRectCamera(col, row, tuning))) {
        return false;
      }
    }
  }
  return true;
}

/**
 * The active wrist that can use the slot alone, or null if none can (Req 14.2, 14.3,
 * design section 9.2): every point of the closed screen disc of radius r + m around the
 * slot, mapped with toCamera, lies inside the closed frame and in no closed rectangle of
 * a cell of that wrist that is not valid. A wrist with no grid is not active. When both
 * wrists can, the result is 'right' (the tie rule of Req 17.4). The cells' validity is
 * read with tuning.cellValidSamples, and their rectangles with the grid size of tuning.
 * The caller supplies r + m > 0. The grids are only read.
 */
export function isSlotUsable(
  slot: Vec2,
  grids: WristGrids,
  mapping: Mapping,
  r: number,
  m: number,
  tuning: Tuning,
): WristId | null {
  const ellipse = cameraEllipse(slot, mapping, r + m);
  if (!inFrame(ellipse)) return null;
  for (const wrist of WRISTS) {
    const grid = grids[wrist];
    if (grid !== undefined && coveredBy(grid, ellipse, tuning)) return wrist;
  }
  return null;
}

/**
 * Places the demand's targets (Req 14.4-14.6). One pass over the slots in the caller's
 * order: each usable slot is chosen if its expanded circle overlaps no circle chosen
 * before it, until n are chosen. Hit circles are closed (Req 17.3), so two expanded
 * circles that touch share a point: a slot is chosen only if its distance to every chosen
 * slot is strictly greater than 2(r + m). Written that way, a NaN distance counts as
 * overlapping. A slot the pass skips blocks nothing after it.
 *   n chosen: simultaneous, with them (Req 14.4). The pass stops there.
 *   fewer, but some slot usable: sequential, with all k usable slots and target i in
 *     usable slot i mod k (Req 14.5).
 *   no slot usable: none (Req 14.6).
 * The grids and the demand are only read (Req 14.7).
 */
export function placeTargets(
  demand: Demand,
  grids: WristGrids,
  mapping: Mapping,
  tuning: Tuning,
): PlacementResult {
  const { slots, n, r, m } = demand;
  const radius = r + m;
  const usable: Vec2[] = [];
  const chosen: Vec2[] = [];
  for (const slot of slots) {
    if (isSlotUsable(slot, grids, mapping, r, m, tuning) === null) continue;
    usable.push(slot);
    if (chosen.every((other) => dist(slot, other) > radius + radius)) {
      chosen.push(slot);
      if (chosen.length === n) return { kind: 'simultaneous', slots: chosen };
    }
  }
  if (usable.length === 0) return { kind: 'none' };
  const targetSlots: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    // usable holds k >= 1 slots, so slot i mod k always exists; the check is for the type checker.
    const slot = usable[i % usable.length];
    if (slot !== undefined) targetSlots.push(slot);
  }
  return { kind: 'sequential', slots: usable, targetSlots };
}
