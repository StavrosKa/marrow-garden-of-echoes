import fc from 'fast-check';
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
import type { Vec2, WristId } from './frame';
import { dist } from './geometry';
import * as core from './index';
import { makeMapping, type Mapping, type MappingParams } from './mapping';
import { isSlotUsable, placeTargets, type Demand, type PlacementResult } from './placement';
import { computeComfortTransform, type WristGrids } from './reachGain';
import { MARGIN_MAX, demote, genDemand, genGrid, genMappingParams, promote } from './testgen';
import { TUNING, type Tuning } from './tuning';

// The grid size, the samples a cell needs and the hit radius r come from TUNING or from
// the tuning argument. The other numbers are test parameters, each named below: two
// mappings, a parallax margin, a binary step for the exact tests, and fractions of a
// radius or a semi-axis. 0 and 1 are the edges of camera space.
//
// EXACT maps a square play area and a square camera image at gain 1 about their centre:
// toCamera(s) = (1 - s.x, s.y), so a screen disc of radius R is a camera circle of radius
// R. Every coordinate in the exact tests is a multiple of EXACT_STEP, a power of two, so
// the arithmetic is exact in floating point, as the tangency tests need; each of them
// first asserts that its construction is exactly tangent. As shipped, the middle cell
// (16, 12) is [1/2, 17/32) x [1/2, 13/24), and the exact radius is 3/32.
//
// REALISTIC maps a 16:9 play area and a 4:3 camera image at the middle of the gain range
// about the play-area centre. A screen disc of radius R is then a camera ellipse with
// semi-axes R / (g k a) along x and R / (g k) along y, k = max(A / a, 1) = 4/3 (design
// section 9.2 step 1): as shipped, with R = r + MARGIN = 0.12, about 0.052 and 0.069.

const COLS = TUNING.gridCols;
const ROWS = TUNING.gridRows;
/** The samples a cell needs to be valid. */
const NEEDED = TUNING.cellValidSamples;
/** r, the hit radius. */
const HIT = TUNING.hitRadius;
/** m, the parallax margin, where a test needs one: inside the 0..0.05 of design section 10.1. A test parameter. */
const MARGIN = 0.03;
/** m = 0: no parallax margin, as the playground uses (design section 14.2). */
const NO_MARGIN = 0;
/** R = r + MARGIN: the radius of a slot's disc and of its expanded circle. */
const RADIUS = HIT + MARGIN;
/** The space left between two expanded circles, or between a disc and the frame's edge: a quarter of RADIUS. */
const GAP = RADIUS / 4;
/** Halfway: the middle of camera space on each axis, and half a radius or semi-axis. */
const HALF = 1 / 2;
/** A quarter of the way across. */
const QUARTER = 1 / 4;
/**
 * Three quarters of each semi-axis along each axis from the centre: a corner of the
 * ellipse's bounding box that lies outside the ellipse, because (3/4)² + (3/4)² > 1.
 */
const CORNER = 3 / 4;
/** More targets than the three usable slots of the sequential example, so that i mod k wraps round. A test parameter. */
const MANY_TARGETS = 5;
/** The identity scale: no reach gain. Not read from reachGainMin, which is a tuning value. */
const IDENTITY_GAIN = 1;
/** A and a of EXACT: a square play area and a square camera image. A test parameter. */
const SQUARE = 1;
/** A of REALISTIC, such as a 1920 x 1080 viewport. A test parameter. */
const PLAY_ASPECT = 16 / 9;
/** a of REALISTIC, such as a 640 x 480 camera image. A test parameter. */
const FRAME_ASPECT = 4 / 3;
/** The gain of REALISTIC: the middle of the gain range. */
const MID_GAIN = (TUNING.reachGainMin + TUNING.reachGainMax) / 2;
/** The play-area centre of REALISTIC, the point its reach gain leaves in place. */
const PLAY_CENTRE: Vec2 = { x: PLAY_ASPECT * HALF, y: HALF };
/** The base scale at which the camera image is exactly as high as the play area (glossary). Geometry. */
const SAME_HEIGHT_SCALE = 1;
/** k of REALISTIC, the larger of A / a and SAME_HEIGHT_SCALE: 4/3. */
const BASE_SCALE = Math.max(PLAY_ASPECT / FRAME_ASPECT, SAME_HEIGHT_SCALE);

const EXACT: Mapping = makeMapping({
  playAspect: SQUARE,
  frameAspect: SQUARE,
  gain: IDENTITY_GAIN,
  centre: { x: SQUARE * HALF, y: HALF },
});
const REALISTIC: Mapping = makeMapping({
  playAspect: PLAY_ASPECT,
  frameAspect: FRAME_ASPECT,
  gain: MID_GAIN,
  centre: PLAY_CENTRE,
});

/**
 * A power of two: every coordinate of the exact tests is a multiple of it, so their sums
 * and differences are exact in floating point. A test parameter.
 */
const EXACT_STEP = 1 / 64;
/** R of the exact tests: r rounded up to a multiple of EXACT_STEP, 3/32 as shipped. */
const EXACT_RADIUS = Math.ceil(HIT / EXACT_STEP) * EXACT_STEP;
/** m of the exact tests, so that r + m is EXACT_RADIUS. exactSlot asserts that it is, exactly. */
const EXACT_MARGIN = EXACT_RADIUS - HIT;

/** A grid with no sample. */
const EMPTY = createGrid(TUNING);
/** A grid with every cell valid, as "Use the whole screen" leaves it (Req 11.15). */
const ALL_VALID = markAllValid(EMPTY);

/** Whether two cells are the same. */
const sameCell = (p: CellIndex, q: CellIndex): boolean => p.col === q.col && p.row === q.row;

/** A grid of TUNING's size with `samples` samples in each cell for which `chosen` holds, and none in the others. */
function gridWhere(chosen: (cell: CellIndex) => boolean, samples = NEEDED): ComfortGrid {
  return {
    ...EMPTY,
    counts: EMPTY.counts.map((_, i) => (chosen({ col: i % COLS, row: Math.floor(i / COLS) }) ? samples : 0)),
  };
}

/** A grid in which every cell is valid except the given ones, which hold no sample. */
function allValidExcept(...blocked: CellIndex[]): ComfortGrid {
  return gridWhere((cell) => !blocked.some((b) => sameCell(b, cell)));
}

/** The cells addSample counts a point in: the valid cells after cellValidSamples samples at it on an empty grid. */
function cellsOf(pos: Vec2): CellIndex[] {
  let grid = EMPTY;
  for (let i = 0; i < NEEDED; i++) grid = addSample(grid, pos);
  return validCells(grid, TUNING);
}

/** The middle cell, (16, 12) as shipped. Its edges at x = col / cols and y = row / rows are both 1/2. */
const MIDDLE: CellIndex = { col: Math.floor(COLS / 2), row: Math.floor(ROWS / 2) };
const MIDDLE_RECT = cellRectCamera(MIDDLE.col, MIDDLE.row, TUNING);
/** The cell before the middle one along x. Its open edge at x = (col + 1) / cols is the middle cell's edge at x = col / cols. */
const BEFORE_MIDDLE_X: CellIndex = { col: MIDDLE.col - 1, row: MIDDLE.row };
/** The cell before the middle one along y. Its open edge at y = (row + 1) / rows is the middle cell's edge at y = row / rows. */
const BEFORE_MIDDLE_Y: CellIndex = { col: MIDDLE.col, row: MIDDLE.row - 1 };

/**
 * The camera-space semi-axes of a screen disc of radius R under REALISTIC, from the
 * glossary's mapping: R / (g k a) along x and R / (g k) along y.
 */
function semiAxes(R: number): { readonly rx: number; readonly ry: number } {
  return { rx: R / (MID_GAIN * BASE_SCALE * FRAME_ASPECT), ry: R / (MID_GAIN * BASE_SCALE) };
}

/**
 * The slot whose disc of radius EXACT_RADIUS has its camera-space centre at `centre`
 * under EXACT, after asserting that the arithmetic is exact: r + m is EXACT_RADIUS,
 * toCamera gives the centre back, and both semi-axes are EXACT_RADIUS.
 */
function exactSlot(centre: Vec2): Vec2 {
  expect(HIT + EXACT_MARGIN).toBe(EXACT_RADIUS);
  const slot = EXACT.toScreen(centre);
  expect(EXACT.toCamera(slot)).toEqual(centre);
  expect(Math.abs(EXACT.toCamera({ x: slot.x + EXACT_RADIUS, y: slot.y }).x - centre.x)).toBe(EXACT_RADIUS);
  expect(Math.abs(EXACT.toCamera({ x: slot.x, y: slot.y + EXACT_RADIUS }).y - centre.y)).toBe(EXACT_RADIUS);
  return slot;
}

/** isSlotUsable under EXACT for the right wrist's grid, with r and the margin of the exact tests. */
function exactUsable(slot: Vec2, grid: ComfortGrid): WristId | null {
  return isSlotUsable(slot, { right: grid }, EXACT, HIT, EXACT_MARGIN, TUNING);
}

/** The smallest and largest camera x and y of the disc of radius R around the slot: toCamera of its four extreme points. */
function cameraExtent(slot: Vec2, mapping: Mapping, R: number) {
  const points = [
    { x: slot.x - R, y: slot.y },
    { x: slot.x + R, y: slot.y },
    { x: slot.x, y: slot.y - R },
    { x: slot.x, y: slot.y + R },
  ].map((p) => mapping.toCamera(p));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** The slots of a result, in order: for sequential, its usable slots and then its target slots. */
function slotsIn(result: PlacementResult): readonly Vec2[] {
  if (result.kind === 'none') return [];
  return result.kind === 'simultaneous' ? result.slots : [...result.slots, ...result.targetSlots];
}

/** Expects the result, with each slot in it the very object the caller passed. */
function expectResult(actual: PlacementResult, expected: PlacementResult): void {
  expect(actual).toEqual(expected);
  const want = slotsIn(expected);
  slotsIn(actual).forEach((slot, i) => expect(slot).toBe(want[i]));
}

/** A disc touching a cell's closed rectangle in one point, in camera space, for the tangency tests. */
interface Tangency {
  /** Which edge of the blocked cell the disc touches, for the test name. */
  readonly edge: string;
  /** The cell that is not valid. */
  readonly blocked: CellIndex;
  /** The disc's centre. */
  readonly centre: Vec2;
  /** The point where the disc touches the blocked cell's closed rectangle. */
  readonly touch: Vec2;
  /** The cell the touching point belongs to (Req 11.2). */
  readonly holder: CellIndex;
  /** The centre moved EXACT_STEP away from the blocked cell, where the disc no longer touches it. */
  readonly away: Vec2;
}

const { x0: EDGE_X, y0: EDGE_Y } = MIDDLE_RECT;
/** Coordinates EXACT_STEP inside the middle cell from its edges at x = col / cols and y = row / rows. */
const INSET_X = EDGE_X + EXACT_STEP;
const INSET_Y = EDGE_Y + EXACT_STEP;

/** Tangent to an edge that belongs to the blocked cell: the touching point lies in that cell. */
const OWN_EDGES: readonly Tangency[] = [
  {
    edge: 'its edge at x = col / cols',
    blocked: MIDDLE,
    centre: { x: EDGE_X - EXACT_RADIUS, y: INSET_Y },
    touch: { x: EDGE_X, y: INSET_Y },
    holder: MIDDLE,
    away: { x: EDGE_X - EXACT_RADIUS - EXACT_STEP, y: INSET_Y },
  },
  {
    edge: 'its edge at y = row / rows',
    blocked: MIDDLE,
    centre: { x: INSET_X, y: EDGE_Y - EXACT_RADIUS },
    touch: { x: INSET_X, y: EDGE_Y },
    holder: MIDDLE,
    away: { x: INSET_X, y: EDGE_Y - EXACT_RADIUS - EXACT_STEP },
  },
];

/** Tangent to an open edge of the blocked cell: the touching point lies in the next cell, the middle one. */
const OPEN_EDGES: readonly Tangency[] = [
  {
    edge: 'its open edge at x = (col + 1) / cols',
    blocked: BEFORE_MIDDLE_X,
    centre: { x: EDGE_X + EXACT_RADIUS, y: INSET_Y },
    touch: { x: EDGE_X, y: INSET_Y },
    holder: MIDDLE,
    away: { x: EDGE_X + EXACT_RADIUS + EXACT_STEP, y: INSET_Y },
  },
  {
    edge: 'its open edge at y = (row + 1) / rows',
    blocked: BEFORE_MIDDLE_Y,
    centre: { x: INSET_X, y: EDGE_Y + EXACT_RADIUS },
    touch: { x: INSET_X, y: EDGE_Y },
    holder: MIDDLE,
    away: { x: INSET_X, y: EDGE_Y + EXACT_RADIUS + EXACT_STEP },
  },
];

/**
 * The slot of a tangency, after asserting that it is exactly tangent: the arithmetic is
 * exact (exactSlot); the blocked cell's closed rectangle lies exactly EXACT_RADIUS from
 * the centre along one axis and spans the centre along the other; the touching point lies
 * on that rectangle and exactly EXACT_RADIUS from the slot on screen; and addSample counts
 * the touching point in the holder cell.
 */
function tangentSlot({ blocked, centre, touch, holder }: Tangency): Vec2 {
  const slot = exactSlot(centre);
  const { x0, y0, x1, y1 } = cellRectCamera(blocked.col, blocked.row, TUNING);
  const gapX = Math.max(x0 - centre.x, 0, centre.x - x1);
  const gapY = Math.max(y0 - centre.y, 0, centre.y - y1);
  expect(Math.min(gapX, gapY)).toBe(0);
  expect(Math.max(gapX, gapY)).toBe(EXACT_RADIUS);
  expect(touch.x >= x0 && touch.x <= x1 && touch.y >= y0 && touch.y <= y1).toBe(true);
  expect(dist(EXACT.toScreen(touch), slot)).toBe(EXACT_RADIUS);
  expect(cellsOf(touch)).toEqual([holder]);
  return slot;
}

/** A disc touching an edge of the frame from inside, in camera space, for the frame tests. */
interface FrameEdge {
  readonly edge: string;
  /** The disc's centre. */
  readonly centre: Vec2;
  /** The side of the disc's camera extent that touches the edge, and the edge's coordinate. */
  readonly side: 'minX' | 'maxX' | 'minY' | 'maxY';
  readonly at: number;
  /** The centre moved EXACT_STEP outwards, so that the disc reaches past the edge. */
  readonly outward: Vec2;
}

const FRAME_EDGES: readonly FrameEdge[] = [
  {
    edge: 'x = 0',
    centre: { x: EXACT_RADIUS, y: HALF },
    side: 'minX',
    at: 0,
    outward: { x: EXACT_RADIUS - EXACT_STEP, y: HALF },
  },
  {
    edge: 'x = 1',
    centre: { x: 1 - EXACT_RADIUS, y: HALF },
    side: 'maxX',
    at: 1,
    outward: { x: 1 - EXACT_RADIUS + EXACT_STEP, y: HALF },
  },
  {
    edge: 'y = 0',
    centre: { x: HALF, y: EXACT_RADIUS },
    side: 'minY',
    at: 0,
    outward: { x: HALF, y: EXACT_RADIUS - EXACT_STEP },
  },
  {
    edge: 'y = 1',
    centre: { x: HALF, y: 1 - EXACT_RADIUS },
    side: 'maxY',
    at: 1,
    outward: { x: HALF, y: 1 - EXACT_RADIUS + EXACT_STEP },
  },
];

describe('isSlotUsable (Req 14.2, 14.3, design section 9.2)', () => {
  it('returns the wrist whose cells alone cover the slot, and right when both do, by the tie rule of Req 17.4', () => {
    const slot: Vec2 = { x: HALF, y: HALF };
    const at = (grids: WristGrids) => isSlotUsable(slot, grids, EXACT, HIT, MARGIN, TUNING);
    expect(at({ left: ALL_VALID })).toBe('left');
    expect(at({ right: ALL_VALID })).toBe('right');
    expect(at({ left: ALL_VALID, right: EMPTY })).toBe('left');
    expect(at({ left: EMPTY, right: ALL_VALID })).toBe('right');
    expect(at({ left: ALL_VALID, right: ALL_VALID })).toBe('right');
    // A wrist with no grid is not active.
    expect(at({})).toBeNull();
  });

  it('a slot covered only by the two wrists together is unusable: each wrist is checked alone (Req 14.3)', () => {
    // The left wrist's cells are valid left of x = 1/2 in camera space, the right wrist's
    // from x = 1/2 on. The disc around the play-area centre maps around (1/2, 1/2), so it
    // reaches into both halves.
    const leftHalf = (cell: CellIndex): boolean => cell.col < MIDDLE.col;
    const left = gridWhere(leftHalf);
    const right = gridWhere((cell) => !leftHalf(cell));
    const bothHalves = gridWhere(() => true);
    const at = (grids: WristGrids) => isSlotUsable(PLAY_CENTRE, grids, REALISTIC, HIT, MARGIN, TUNING);
    // One wrist with the cells of both covers the slot, so together they cover it.
    expect(at({ right: bothHalves })).toBe('right');
    expect(at({ left })).toBeNull();
    expect(at({ right })).toBeNull();
    expect(at({ left, right })).toBeNull();
    expect(
      placeTargets({ slots: [PLAY_CENTRE], n: 1, r: HIT, m: MARGIN }, { left, right }, REALISTIC, TUNING),
    ).toEqual({ kind: 'none' });
  });

  it('a disc that leaves the camera frame makes the slot unusable, even with every cell valid (Req 14.2)', () => {
    const { rx, ry } = semiAxes(RADIUS);
    const grids = { right: ALL_VALID };
    const at = (centre: Vec2) =>
      isSlotUsable(REALISTIC.toScreen(centre), grids, REALISTIC, HIT, MARGIN, TUNING);
    expect(isSlotUsable(PLAY_CENTRE, grids, REALISTIC, HIT, MARGIN, TUNING)).toBe('right');
    // Discs half a semi-axis inside the frame's edges at x = 0 and y = 1 ...
    expect(at({ x: rx * (1 + HALF), y: HALF })).toBe('right');
    expect(at({ x: HALF, y: 1 - ry * (1 + HALF) })).toBe('right');
    // ... and discs reaching half a semi-axis past them.
    expect(at({ x: rx * HALF, y: HALF })).toBeNull();
    expect(at({ x: HALF, y: 1 - ry * HALF })).toBeNull();
    // A slot so far outside the play area that its disc lies wholly outside the frame.
    expect(isSlotUsable({ x: -PLAY_ASPECT, y: HALF }, grids, REALISTIC, HIT, MARGIN, TUNING)).toBeNull();
  });

  it('the margin counts: a disc of radius r inside the frame, but of radius r + m past its edge, makes the slot unusable (Req 14.2)', () => {
    // Under EXACT the disc's centre lies r + m / 2 from the frame's edge at x = 1.
    const slot = EXACT.toScreen({ x: 1 - HIT - MARGIN * HALF, y: HALF });
    const grids = { right: ALL_VALID };
    expect(isSlotUsable(slot, grids, EXACT, HIT, NO_MARGIN, TUNING)).toBe('right');
    expect(isSlotUsable(slot, grids, EXACT, HIT, MARGIN, TUNING)).toBeNull();
    expect(placeTargets({ slots: [slot], n: 1, r: HIT, m: NO_MARGIN }, grids, EXACT, TUNING)).toEqual({
      kind: 'simultaneous',
      slots: [slot],
    });
    expect(placeTargets({ slots: [slot], n: 1, r: HIT, m: MARGIN }, grids, EXACT, TUNING)).toEqual({
      kind: 'none',
    });
  });

  // The frame is closed (design section 9.2 step 2): a disc leaves it only if one of its
  // points lies strictly outside [0, 1]².
  for (const { edge, centre, side, at, outward } of FRAME_EDGES) {
    it(`a disc touching the frame's edge ${edge} from inside is usable, and EXACT_STEP further out it is not`, () => {
      const slot = exactSlot(centre);
      const extent = cameraExtent(slot, EXACT, EXACT_RADIUS);
      expect(extent[side]).toBe(at);
      expect(extent.minX >= 0 && extent.maxX <= 1 && extent.minY >= 0 && extent.maxY <= 1).toBe(true);
      expect(exactUsable(slot, ALL_VALID)).toBe('right');
      expect(exactUsable(exactSlot(outward), ALL_VALID)).toBeNull();
    });
  }

  // A strict < would count none of these cells, because each lies at a distance of exactly
  // the radius. A property test would practically never draw an exact tangency, so these
  // tests are what pin the closed test (design section 9.2 step 3).
  for (const tangency of OWN_EDGES) {
    it(`a disc tangent from outside to a non-valid cell at ${tangency.edge}, which belongs to that cell, makes the slot unusable`, () => {
      const slot = tangentSlot(tangency);
      expect(exactUsable(slot, allValidExcept(tangency.blocked))).toBeNull();
      // With the cell valid the slot is usable, so the cell is what makes it unusable; and
      // EXACT_STEP further away the disc no longer touches the cell.
      expect(exactUsable(slot, ALL_VALID)).toBe('right');
      expect(exactUsable(exactSlot(tangency.away), allValidExcept(tangency.blocked))).toBe('right');
    });
  }

  for (const tangency of OPEN_EDGES) {
    it(`a disc tangent to a non-valid cell at ${tangency.edge}, which belongs to the next cell, makes the slot unusable too: the closed test is conservative`, () => {
      const slot = tangentSlot(tangency);
      expect(exactUsable(slot, allValidExcept(tangency.blocked))).toBeNull();
      expect(exactUsable(slot, ALL_VALID)).toBe('right');
      expect(exactUsable(exactSlot(tangency.away), allValidExcept(tangency.blocked))).toBe('right');
    });
  }

  it('uses the ellipse with both its semi-axes: at a = 4/3 a non-valid cell between the two semi-axes away is met straight along y and missed straight along x, and a corner of the bounding box outside the ellipse is missed (design section 9.2 step 1)', () => {
    const { rx, ry } = semiAxes(RADIUS);
    expect(rx).toBeLessThan(ry);
    const between = (rx + ry) * HALF;
    const grid = allValidExcept(MIDDLE);
    const { x0, y0, x1, y1 } = MIDDLE_RECT;
    const at = (centre: Vec2, cells: ComfortGrid) =>
      isSlotUsable(REALISTIC.toScreen(centre), { right: cells }, REALISTIC, HIT, MARGIN, TUNING);
    // Straight above the cell in the image: the cell lies `between` away along y, inside ry.
    const above = { x: (x0 + x1) * HALF, y: y0 - between };
    expect(at(above, grid)).toBeNull();
    expect(at(above, ALL_VALID)).toBe('right');
    // Straight beside it: `between` away along x, outside rx.
    expect(at({ x: x0 - between, y: (y0 + y1) * HALF }, grid)).toBe('right');
    // Diagonally: CORNER of each semi-axis away along each axis.
    expect(at({ x: x0 - CORNER * rx, y: y0 - CORNER * ry }, grid)).toBe('right');
  });

  it('reads cellValidSamples from the tuning argument', () => {
    // Every cell holds exactly cellValidSamples samples: valid at TUNING, and one short at a
    // threshold one higher.
    const grids = { right: gridWhere(() => true) };
    const higher: Tuning = { ...TUNING, cellValidSamples: NEEDED + 1 };
    const slot: Vec2 = { x: HALF, y: HALF };
    expect(isSlotUsable(slot, grids, EXACT, HIT, MARGIN, TUNING)).toBe('right');
    expect(isSlotUsable(slot, grids, EXACT, HIT, MARGIN, higher)).toBeNull();
    const demand: Demand = { slots: [slot], n: 1, r: HIT, m: MARGIN };
    expect(placeTargets(demand, grids, EXACT, TUNING)).toEqual({ kind: 'simultaneous', slots: [slot] });
    expect(placeTargets(demand, grids, EXACT, higher)).toEqual({ kind: 'none' });
  });
});

describe('placeTargets (Req 14.4-14.6)', () => {
  it('skips a slot whose expanded circle overlaps a chosen one and stops at n; a skipped slot blocks no later slot (Req 14.4)', () => {
    // Under EXACT, with every cell valid, along y = 1/2. s1 lies between 2r and 2(r + m)
    // from s0: the hit circles are apart, but the expanded circles overlap. s2 lies more
    // than 2(r + m) from s0 but overlaps s1, which the pass skipped. s3 is clear of s0 and s2.
    const grids = { right: ALL_VALID };
    const s0: Vec2 = { x: RADIUS + GAP, y: HALF };
    const s1: Vec2 = { x: s0.x + HIT + RADIUS, y: HALF };
    const s2: Vec2 = { x: s0.x + RADIUS + RADIUS + GAP, y: HALF };
    const s3: Vec2 = { x: s2.x + RADIUS + RADIUS + GAP, y: HALF };
    expect(dist(s0, s1)).toBeGreaterThan(HIT + HIT);
    expect(dist(s0, s1)).toBeLessThan(RADIUS + RADIUS);
    expect(dist(s1, s2)).toBeLessThan(RADIUS + RADIUS);
    for (const slot of [s0, s1, s2, s3]) {
      expect(isSlotUsable(slot, grids, EXACT, HIT, MARGIN, TUNING)).toBe('right');
    }
    const place = (n: number) => placeTargets({ slots: [s0, s1, s2, s3], n, r: HIT, m: MARGIN }, grids, EXACT, TUNING);
    expectResult(place(2), { kind: 'simultaneous', slots: [s0, s2] });
    expectResult(place(3), { kind: 'simultaneous', slots: [s0, s2, s3] });
  });

  it('two slots exactly 2(r + m) apart overlap, because hit circles are closed, so the later one is skipped; EXACT_STEP further apart both are chosen (Req 14.4, 17.3)', () => {
    const grids = { right: ALL_VALID };
    const s0 = exactSlot({ x: 1 - QUARTER, y: HALF });
    const touching = exactSlot({ x: 1 - QUARTER - EXACT_RADIUS - EXACT_RADIUS, y: HALF });
    const apart = exactSlot({ x: 1 - QUARTER - EXACT_RADIUS - EXACT_RADIUS - EXACT_STEP, y: HALF });
    expect(dist(s0, touching)).toBe(EXACT_RADIUS + EXACT_RADIUS);
    expect(dist(s0, apart)).toBe(EXACT_RADIUS + EXACT_RADIUS + EXACT_STEP);
    for (const slot of [s0, touching, apart]) expect(exactUsable(slot, ALL_VALID)).toBe('right');
    const place = (slots: Vec2[]) => placeTargets({ slots, n: 2, r: HIT, m: EXACT_MARGIN }, grids, EXACT, TUNING);
    expectResult(place([s0, touching]), {
      kind: 'sequential',
      slots: [s0, touching],
      targetSlots: [s0, touching],
    });
    expectResult(place([s0, apart]), { kind: 'simultaneous', slots: [s0, apart] });
  });

  it('sequential: all usable slots in caller order, those the pass skipped included, and target i in usable slot i mod k (Req 14.5)', () => {
    // Under EXACT, with every cell valid, along y = 1/2. a and d are clear of each other; c
    // overlaps a, so the pass skips it; b's disc leaves the frame. MANY_TARGETS are needed,
    // but only a and d can be shown at once, so the result is sequential with k = 3.
    const grids = { right: ALL_VALID };
    const a: Vec2 = { x: RADIUS + GAP, y: HALF };
    const b: Vec2 = { x: RADIUS * HALF, y: HALF };
    const c: Vec2 = { x: a.x + RADIUS, y: HALF };
    const d: Vec2 = { x: a.x + RADIUS + RADIUS + GAP, y: HALF };
    expect(isSlotUsable(b, grids, EXACT, HIT, MARGIN, TUNING)).toBeNull();
    for (const slot of [a, c, d]) expect(isSlotUsable(slot, grids, EXACT, HIT, MARGIN, TUNING)).toBe('right');
    expect(dist(a, c)).toBeLessThan(RADIUS + RADIUS);
    expect(dist(a, d)).toBeGreaterThan(RADIUS + RADIUS);
    const result = placeTargets({ slots: [a, b, c, d], n: MANY_TARGETS, r: HIT, m: MARGIN }, grids, EXACT, TUNING);
    expectResult(result, { kind: 'sequential', slots: [a, c, d], targetSlots: [a, c, d, a, c] });
  });

  it('none when no slot is usable: no valid cell, no active wrist, or every disc out of the frame (Req 14.6)', () => {
    const inside: Vec2 = { x: HALF, y: HALF };
    const outside: Vec2 = { x: RADIUS * HALF, y: HALF };
    const place = (slots: Vec2[], grids: WristGrids) =>
      placeTargets({ slots, n: 1, r: HIT, m: MARGIN }, grids, EXACT, TUNING);
    const none: PlacementResult = { kind: 'none' };
    expect(place([inside], { right: EMPTY })).toEqual(none);
    expect(place([inside], { left: EMPTY, right: gridWhere(() => true, NEEDED - 1) })).toEqual(none);
    expect(place([inside], {})).toEqual(none);
    expect(place([outside], { right: ALL_VALID })).toEqual(none);
    expect(place([], { right: ALL_VALID })).toEqual(none);
    // The slot inside the frame is usable once a wrist's cells cover it.
    expectResult(place([inside], { right: ALL_VALID }), { kind: 'simultaneous', slots: [inside] });
  });
});

// TUNING is frozen, so the test passes a mutable deep copy of it. The grids and the
// demand are plain objects, not frozen either: a write to any input would go through and
// show in the comparison with the copy taken before the calls.
describe('inputs are unchanged (Req 14.7)', () => {
  it('placeTargets and isSlotUsable leave the grids, the demand and the tuning deep-equal to what they were', () => {
    const tuning: Tuning = structuredClone(TUNING);
    const grids: WristGrids = {
      left: allValidExcept(MIDDLE),
      right: markAllValid(gridWhere((cell) => cell.row < MIDDLE.row)),
    };
    const demand: Demand = {
      slots: [PLAY_CENTRE, { x: PLAY_ASPECT * QUARTER, y: HALF }, { x: GAP, y: HALF }],
      n: MANY_TARGETS,
      r: HIT,
      m: MARGIN,
    };
    const before = structuredClone({ grids, demand, tuning });
    expect(placeTargets(demand, grids, REALISTIC, tuning).kind).toBe('sequential');
    for (const slot of demand.slots) isSlotUsable(slot, grids, REALISTIC, demand.r, demand.m, tuning);
    expect({ grids, demand, tuning }).toStrictEqual(before);
  });
});

// ---------------------------------------------------------------------------------
// Property tests (Req 14.8-14.10, design sections 10.2 and 10.3).
//
// Each input holds the grids of the right wrist, the left wrist or both, each from
// genGrid; a mapping whose aspects come from genMappingParams and whose gain and centre
// come, in half the inputs each, from genMappingParams or from computeComfortTransform
// on the same grids, which can put the centre outside the play area; and a demand from
// genDemand with up to ANCHORS_MAX more slots at the screen centres of valid cells, put
// at random places in the slot list. Without those slots nine inputs in ten end in none.
// They can lie outside the play area, which "for all slots" in Req 14.8 allows.

/** Runs of placement_covers_every_point and placement_simultaneous_disjoint: most inputs end in none. A test parameter. */
const PLACEMENT_RUNS = 1000;
/**
 * The time limit of each test below, in milliseconds. With PLACEMENT_RUNS runs,
 * placement_covers_every_point took 6.9 s on one seed, over vitest's default limit of 5 s,
 * and 1.4 to 4.5 s on eight others. A test parameter.
 */
const PROPERTY_TIMEOUT_MS = 60_000;
/** The most slots an input adds at the screen centres of valid cells. A test parameter. */
const ANCHORS_MAX = 4;
/** Draws the same inputs on every run, for the coverage check of the inputs. */
const SAMPLE = { numRuns: 1000, seed: 42 };
/** Both wrists, right first: the order in which isSlotUsable tries them (Req 17.4). */
const RIGHT_FIRST: readonly WristId[] = ['right', 'left'];
/** A full turn, in radians. */
const FULL_TURN = 2 * Math.PI;
/** Points on the boundary of each sampled disc, evenly spaced in angle (design section 10.3). A test parameter. */
const BOUNDARY_POINTS = 64;
/**
 * The spacing of the lattice inside each sampled disc, in screen units: half the smallest
 * side a cell can have on screen. A cell is g * k * a / gridCols wide and g * k / gridRows
 * tall there, and g, k * a and k are all at least 1, so every cell that lies wholly inside
 * a disc holds a lattice point.
 */
const LATTICE_SPACING = HALF / Math.max(COLS, ROWS);

/** Where the gain and centre of an input's mapping come from. */
type CentreSource = 'genMappingParams' | 'computeComfortTransform';

/** One input of the placement properties. */
interface PlacementCase {
  readonly params: MappingParams;
  readonly source: CentreSource;
  readonly grids: WristGrids;
  readonly demand: Demand;
}

/** The active wrists of the grids, right first. */
function activeWrists(grids: WristGrids): WristId[] {
  return RIGHT_FIRST.filter((wrist) => grids[wrist] !== undefined);
}

/** The camera-space centre of a cell, halfway between its edges. */
function cellCentre({ col, row }: CellIndex): Vec2 {
  const { x0, y0, x1, y1 } = cellRectCamera(col, row, TUNING);
  return { x: (x0 + x1) * HALF, y: (y0 + y1) * HALF };
}

/** The grids of the active wrists: the right wrist's, the left wrist's or both, each from genGrid, as plain objects. */
function genWristGrids(): fc.Arbitrary<WristGrids> {
  return fc.oneof(
    genGrid().map((right): WristGrids => ({ right })),
    genGrid().map((left): WristGrids => ({ left })),
    fc.record({ left: genGrid(), right: genGrid() }, { noNullPrototype: true }),
  );
}

/** One input of the placement properties, as the comment above the section describes. */
function genPlacementCase(): fc.Arbitrary<PlacementCase> {
  return fc
    .record({ base: genMappingParams(), grids: genWristGrids(), fromTransform: fc.boolean() })
    .chain(({ base, grids, fromTransform }) => {
      const params: MappingParams = fromTransform
        ? { ...base, ...computeComfortTransform(grids, base.frameAspect, base.playAspect, TUNING) }
        : base;
      const source: CentreSource = fromTransform ? 'computeComfortTransform' : 'genMappingParams';
      const mapping = makeMapping(params);
      const valid = activeWrists(grids).flatMap((wrist) => validCells(grids[wrist] ?? EMPTY, TUNING));
      const anchors: fc.Arbitrary<[CellIndex, number][]> =
        valid.length === 0
          ? fc.constant([])
          : fc.array(fc.tuple(fc.constantFrom(...valid), fc.nat()), { maxLength: ANCHORS_MAX });
      return fc.tuple(genDemand(params.playAspect), anchors).map(([demand, picks]) => {
        const slots = [...demand.slots];
        for (const [cell, at] of picks) {
          slots.splice(at % (slots.length + 1), 0, mapping.toScreen(cellCentre(cell)));
        }
        return { params, source, grids, demand: { ...demand, slots } };
      });
    });
}

// The oracle (design section 10.3), written apart from placement.ts. It must decide a
// tangent case the way the implementation does, so it takes the ellipse the same way:
// the centre is toCamera of the slot, the extremes on each axis are toCamera of the slot
// minus and plus (R, 0) and (0, R), the frame test compares those extreme coordinates
// themselves with 0 and 1, and each semi-axis is the larger of the two distances from the
// centre to its extremes. The cell and overlap tests are the same expressions. A semi-axis
// in closed form, such as R / (g k a), differs from the toCamera one in the last bit for
// most inputs, and a frame test on the centre plus or minus a semi-axis need not round back
// to the mapped point; at a tangency either can change the verdict. The rest is its own
// code: it lists, wrist by wrist, the cells that are not valid and that the ellipse meets,
// and makes its own pass over the usable slots.

/** The oracle's verdict on one slot: the active wrists whose cells alone cover its disc, right first, and the ellipse. */
interface OracleVerdict {
  readonly wrists: readonly WristId[];
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

/** A cell that is not valid, with its closed rectangle as cellRectCamera computes it. */
interface BlockedCell {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Each active wrist, right first, with the cells of its grid that are not valid. */
type BlockedByWrist = readonly { readonly wrist: WristId; readonly cells: readonly BlockedCell[] }[];

/** The cells of each active wrist's grid that are not valid: found once for an input, then tested against every slot. */
function blockedByWrist(grids: WristGrids): BlockedByWrist {
  return activeWrists(grids).map((wrist) => {
    const grid = grids[wrist] ?? EMPTY;
    const cells: BlockedCell[] = [];
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        if (!isCellValid(grid, col, row, TUNING)) cells.push(cellRectCamera(col, row, TUNING));
      }
    }
    return { wrist, cells };
  });
}

/** Whether the closed ellipse meets the cell's closed rectangle (design section 9.2 step 3). */
function meetsCell({ x0, y0, x1, y1 }: BlockedCell, cx: number, cy: number, rx: number, ry: number): boolean {
  const u = Math.max(x0 - cx, 0, cx - x1) / rx;
  const v = Math.max(y0 - cy, 0, cy - y1) / ry;
  return u * u + v * v <= 1;
}

/** The oracle's verdict on a slot (Req 14.2, 14.3). */
function oracleVerdict(slot: Vec2, blocked: BlockedByWrist, mapping: Mapping, r: number, m: number): OracleVerdict {
  const R = r + m;
  const centre = mapping.toCamera(slot);
  const cx = centre.x;
  const cy = centre.y;
  const west = mapping.toCamera({ x: slot.x - R, y: slot.y });
  const east = mapping.toCamera({ x: slot.x + R, y: slot.y });
  const north = mapping.toCamera({ x: slot.x, y: slot.y - R });
  const south = mapping.toCamera({ x: slot.x, y: slot.y + R });
  const xLo = Math.min(west.x, east.x);
  const xHi = Math.max(west.x, east.x);
  const yLo = Math.min(north.y, south.y);
  const yHi = Math.max(north.y, south.y);
  const rx = Math.max(xHi - cx, cx - xLo);
  const ry = Math.max(yHi - cy, cy - yLo);
  const inFrame = xLo >= 0 && xHi <= 1 && yLo >= 0 && yHi <= 1;
  if (!inFrame) return { wrists: [], cx, cy, rx, ry };
  const wrists = blocked
    .filter(({ cells }) => !cells.some((cell) => meetsCell(cell, cx, cy, rx, ry)))
    .map(({ wrist }) => wrist);
  return { wrists, cx, cy, rx, ry };
}

/** What placeTargets must return, from the oracle's verdicts (Req 14.4-14.6). */
function oracleResult(
  slots: readonly Vec2[],
  verdicts: readonly OracleVerdict[],
  n: number,
  r: number,
  m: number,
): PlacementResult {
  const reach = r + m;
  const usable = slots.filter((_, i) => (verdicts[i]?.wrists.length ?? 0) > 0);
  const chosen: Vec2[] = [];
  for (const slot of usable) {
    if (chosen.length === n) break;
    if (chosen.every((other) => dist(slot, other) > reach + reach)) chosen.push(slot);
  }
  if (chosen.length === n) return { kind: 'simultaneous', slots: chosen };
  if (usable.length === 0) return { kind: 'none' };
  const targetSlots = Array.from({ length: n }, (_, i) => usable[i % usable.length]).filter(
    (slot): slot is Vec2 => slot !== undefined,
  );
  return { kind: 'sequential', slots: usable, targetSlots };
}

/** The start of each column and of each row in camera space, as cellRectCamera computes them. */
const COLUMN_STARTS = Array.from({ length: COLS }, (_, col) => cellRectCamera(col, 0, TUNING).x0);
const ROW_STARTS = Array.from({ length: ROWS }, (_, row) => cellRectCamera(0, row, TUNING).y0);

/**
 * The index of the cell that holds v on one axis, for v in 0..1: the last cell that starts
 * at or before v, so a point on an edge belongs to the cell after it and 1 to the last cell
 * (Req 11.2).
 */
function cellOn(starts: readonly number[], v: number): number {
  let i = 0;
  while (i + 1 < starts.length && (starts[i + 1] ?? Infinity) <= v) i++;
  return i;
}

/**
 * The sampled layer (design section 10.3): points on the boundary of the disc of radius
 * reach around the slot and on a lattice inside it, each mapped with toCamera, that do not
 * lie in the frame and in a valid cell of the grid. Each is described for the failure
 * message, with the distance of its cell's closed rectangle from the ellipse's centre in
 * radii: 1 means tangent. Empty when every point is covered.
 */
function uncoveredPoints(slot: Vec2, grid: ComfortGrid, mapping: Mapping, reach: number, verdict: OracleVerdict): string[] {
  const points: Vec2[] = [];
  for (let j = 0; j < BOUNDARY_POINTS; j++) {
    const angle = (FULL_TURN * j) / BOUNDARY_POINTS;
    points.push({ x: slot.x + reach * Math.cos(angle), y: slot.y + reach * Math.sin(angle) });
  }
  const steps = Math.floor(reach / LATTICE_SPACING);
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      const p = { x: slot.x + i * LATTICE_SPACING, y: slot.y + j * LATTICE_SPACING };
      if (dist(p, slot) <= reach) points.push(p);
    }
  }
  const problems: string[] = [];
  for (const p of points) {
    const q = mapping.toCamera(p);
    const at = `point (${p.x}, ${p.y}) of the disc around (${slot.x}, ${slot.y}) maps to (${q.x}, ${q.y})`;
    if (!(q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1)) {
      problems.push(`${at}, outside the frame`);
      continue;
    }
    const col = cellOn(COLUMN_STARTS, q.x);
    const row = cellOn(ROW_STARTS, q.y);
    if (isCellValid(grid, col, row, TUNING)) continue;
    const { x0, y0, x1, y1 } = cellRectCamera(col, row, TUNING);
    const u = Math.max(x0 - verdict.cx, 0, verdict.cx - x1) / verdict.rx;
    const v = Math.max(y0 - verdict.cy, 0, verdict.cy - y1) / verdict.ry;
    problems.push(`${at}, in cell (${col}, ${row}), not valid, ${Math.sqrt(u * u + v * v)} radii from the centre`);
  }
  return problems;
}

/** The slots a result holds: for sequential, its usable slots, which include every target slot. */
const resultSlots = (result: PlacementResult): readonly Vec2[] => (result.kind === 'none' ? [] : result.slots);

// Req 14.8, with the two layers of design section 10.3. Layer 1: the oracle decides for
// each slot which wrists cover it, so what isSlotUsable must return, and what placeTargets
// must return for the demand. Layer 2: every sampled point of the disc of each returned
// slot maps into the frame and into a valid cell of the wrist isSlotUsable returned. The
// messages start with "oracle" or "sampled layer", so a failure says which layer found it.
it('placement_covers_every_point', () => {
  fc.assert(
    fc.property(genPlacementCase(), ({ params, grids, demand }) => {
      const mapping = makeMapping(params);
      const { slots, n, r, m } = demand;
      const blocked = blockedByWrist(grids);
      const verdicts = slots.map((slot) => oracleVerdict(slot, blocked, mapping, r, m));
      const wrists = slots.map((slot) => isSlotUsable(slot, grids, mapping, r, m, TUNING));
      expect(wrists, 'oracle: isSlotUsable').toEqual(verdicts.map((verdict) => verdict.wrists[0] ?? null));
      const result = placeTargets(demand, grids, mapping, TUNING);
      const expected = oracleResult(slots, verdicts, n, r, m);
      expect(result, 'oracle: placeTargets').toEqual(expected);
      const expectedSlots = [...resultSlots(expected), ...(expected.kind === 'sequential' ? expected.targetSlots : [])];
      [...resultSlots(result), ...(result.kind === 'sequential' ? result.targetSlots : [])].forEach((slot, i) =>
        expect(slot, 'oracle: the caller slot objects').toBe(expectedSlots[i]),
      );
      const discRadius = demand.r + demand.m;
      const problems = resultSlots(result).flatMap((slot) => {
        const i = slots.indexOf(slot);
        const wrist = wrists[i] ?? null;
        const grid = wrist === null ? undefined : grids[wrist];
        const verdict = verdicts[i];
        if (grid === undefined || verdict === undefined) return [`slot (${slot.x}, ${slot.y}) has no wrist`];
        return uncoveredPoints(slot, grid, mapping, discRadius, verdict);
      });
      expect(problems, 'sampled layer').toEqual([]);
    }),
    // includeErrorInReport puts the error that failed the property into fast-check's report,
    // so the report says whether the oracle or the sampled layer found the failure.
    { numRuns: PLACEMENT_RUNS, includeErrorInReport: true },
  );
}, PROPERTY_TIMEOUT_MS);

/** An input of placement_monotone_in_cells: a placement input, and one active wrist's grid after promote or demote. */
interface MonotoneCase extends PlacementCase {
  readonly wrist: WristId;
  readonly grow: boolean;
  readonly after: ComfortGrid;
}

/** The most cells a targeted promotion changes in one grid. A test parameter. */
const TARGETED_CELLS_MAX = 4;
/**
 * How often a monotone input changes cells next to its slots, against promote and demote of
 * testgen.ts, which choose their cells over the whole grid: 3 to 1. A test parameter.
 */
const TARGETED_WEIGHT = 3;

/**
 * The cells whose columns and rows the disc of the given radius around the slot covers in
 * camera space, from the camera x and y of its four mapped extreme points. Those are the
 * cells the disc can meet, and so the only ones whose change can change the slot's verdict.
 */
function cellsAround(slot: Vec2, mapping: Mapping, reach: number): CellIndex[] {
  const west = mapping.toCamera({ x: slot.x - reach, y: slot.y });
  const east = mapping.toCamera({ x: slot.x + reach, y: slot.y });
  const north = mapping.toCamera({ x: slot.x, y: slot.y - reach });
  const south = mapping.toCamera({ x: slot.x, y: slot.y + reach });
  const col0 = cellOn(COLUMN_STARTS, Math.min(west.x, east.x));
  const col1 = cellOn(COLUMN_STARTS, Math.max(west.x, east.x));
  const row0 = cellOn(ROW_STARTS, Math.min(north.y, south.y));
  const row1 = cellOn(ROW_STARTS, Math.max(north.y, south.y));
  const cells: CellIndex[] = [];
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) cells.push({ col, row });
  }
  return cells;
}

/** The cells around any of the input's slots, each once. */
function cellsAroundSlots({ params, demand }: PlacementCase): CellIndex[] {
  const mapping = makeMapping(params);
  const reach = demand.r + demand.m;
  const seen = new Set<number>();
  const cells: CellIndex[] = [];
  for (const slot of demand.slots) {
    for (const cell of cellsAround(slot, mapping, reach)) {
      const key = cell.row * COLS + cell.col;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push(cell);
    }
  }
  return cells;
}

/**
 * One active wrist's grid after a change. Generic: promote or demote of testgen.ts, which
 * choose their cells over the whole grid, so they seldom reach a cell inside a usable
 * slot's disc. Targeted: from the cells around the input's slots only, where Req 14.9 can
 * be broken. A targeted promotion adds 1 to cellValidSamples samples to each of 1 to
 * TARGETED_CELLS_MAX of them, so a cell with exactly cellValidSamples samples can go past
 * it; a targeted demotion leaves one valid cell of them with 0 to cellValidSamples - 1
 * samples, and falls back to demote when none of them is valid. genGrid never marks a grid
 * all-valid, and these inputs use no other grids, so demote, which refuses a grid marked
 * all-valid, never throws here.
 */
function genChangedGrid(input: PlacementCase, wrist: WristId, grow: boolean, targeted: boolean): fc.Arbitrary<ComfortGrid> {
  const grid = input.grids[wrist] ?? EMPTY;
  if (!targeted) return grow ? promote(grid) : demote(grid);
  const around = cellsAroundSlots(input);
  if (grow) {
    const addition = fc.tuple(fc.constantFrom(...around), fc.integer({ min: 1, max: NEEDED }));
    return fc.array(addition, { minLength: 1, maxLength: TARGETED_CELLS_MAX }).map((additions) => {
      let result = grid;
      for (const [cell, samples] of additions) {
        for (let i = 0; i < samples; i++) result = addSample(result, cellCentre(cell));
      }
      return result;
    });
  }
  const valid = around.filter(({ col, row }) => isCellValid(grid, col, row, TUNING));
  if (valid.length === 0) return demote(grid);
  return fc
    .tuple(fc.constantFrom(...valid), fc.integer({ min: 0, max: NEEDED - 1 }))
    .map(([cell, samples]) => ({
      ...grid,
      counts: grid.counts.map((count, i) => (i === cell.row * COLS + cell.col ? samples : count)),
    }));
}

/** A placement input with one active wrist's grid after a generic or a targeted change (genChangedGrid), promote or demote. */
function genMonotoneCase(): fc.Arbitrary<MonotoneCase> {
  return genPlacementCase().chain((input) =>
    fc
      .tuple(
        fc.constantFrom(...activeWrists(input.grids)),
        fc.boolean(),
        fc.oneof({ arbitrary: fc.constant(false), weight: 1 }, { arbitrary: fc.constant(true), weight: TARGETED_WEIGHT }),
      )
      .chain(([wrist, grow, targeted]) =>
        genChangedGrid(input, wrist, grow, targeted).map((after) => ({ ...input, wrist, grow, after })),
      ),
  );
}

// Req 14.9: promote never makes a usable slot unusable, and demote never makes an
// unusable slot usable. The mapping's gain and centre come from the grids before the
// change and stay fixed (design section 10.3): recomputed, they would move the mapping.
// Usability is compared as true or false, because the wrist can change, for example from
// left to right once the right wrist's grid is promoted.
it('placement_monotone_in_cells', () => {
  fc.assert(
    fc.property(genMonotoneCase(), ({ params, grids, demand, wrist, grow, after }) => {
      const mapping = makeMapping(params);
      const changed: WristGrids = { ...grids, [wrist]: after };
      for (const slot of demand.slots) {
        const before = isSlotUsable(slot, grids, mapping, demand.r, demand.m, TUNING) !== null;
        const now = isSlotUsable(slot, changed, mapping, demand.r, demand.m, TUNING) !== null;
        if (grow) expect(before && !now, 'promote made a usable slot unusable').toBe(false);
        else expect(!before && now, 'demote made an unusable slot usable').toBe(false);
      }
    }),
    { numRuns: PLACEMENT_RUNS, includeErrorInReport: true },
  );
}, PROPERTY_TIMEOUT_MS);

// Req 14.10: in every simultaneous result the n expanded circles are pairwise disjoint.
// Hit circles are closed (Req 17.3), so disjoint means more than 2(r + m) apart.
it('placement_simultaneous_disjoint', () => {
  fc.assert(
    fc.property(genPlacementCase(), ({ params, grids, demand }) => {
      const result = placeTargets(demand, grids, makeMapping(params), TUNING);
      if (result.kind !== 'simultaneous') return;
      expect(result.slots).toHaveLength(demand.n);
      const expanded = demand.r + demand.m;
      result.slots.forEach((a, i) => {
        for (const b of result.slots.slice(i + 1)) expect(dist(a, b)).toBeGreaterThan(expanded + expanded);
      });
    }),
    { numRuns: PLACEMENT_RUNS, includeErrorInReport: true },
  );
}, PROPERTY_TIMEOUT_MS);

// A property is only as strong as its inputs. These are drawn as for the properties, from
// a fixed seed, so the check is the same on every run.
// For placement_monotone_in_cells, each half needs inputs of its own kind, and the change
// has to reach a cell inside the disc of the slot it is tested on, because only such a
// change can break Req 14.9: promote on a usable slot, demote on a usable and on an
// unusable one. With promote and demote of testgen.ts alone, which choose their cells over
// the whole grid, few changes reached a usable slot's disc; a mutation that made a cell
// with more than cellValidSamples samples count as not valid then failed this property in
// about one run in four.
it('the placement inputs reach a centre from computeComfortTransform outside the play area, every result from each source, simultaneous with n of 2 or more, sequential with more targets than usable slots, a promote and a demote that change a cell inside the disc of a usable slot, a demote that does so for an unusable slot, and a demote that makes a usable slot unusable', () => {
  const cases = fc.sample(genPlacementCase(), SAMPLE);
  const outcomes = cases.map((input) => {
    const result = placeTargets(input.demand, input.grids, makeMapping(input.params), TUNING);
    const { centre, playAspect } = input.params;
    return {
      source: input.source,
      kind: result.kind,
      n: input.demand.n,
      usable: result.kind === 'sequential' ? result.slots.length : 0,
      centreOutside: centre.x < 0 || centre.x > playAspect || centre.y < 0 || centre.y > 1,
    };
  });
  const reached = (source: CentreSource, kind: PlacementResult['kind']): boolean =>
    outcomes.some((o) => o.source === source && o.kind === kind);
  const changes = fc.sample(genMonotoneCase(), SAMPLE).flatMap((input) => {
    const mapping = makeMapping(input.params);
    const changed: WristGrids = { ...input.grids, [input.wrist]: input.after };
    const { r, m } = input.demand;
    const was = input.grids[input.wrist] ?? EMPTY;
    const touched = new Set(input.after.counts.flatMap((count, i) => (count === was.counts[i] ? [] : [i])));
    return input.demand.slots.map((slot) => ({
      grow: input.grow,
      before: isSlotUsable(slot, input.grids, mapping, r, m, TUNING) !== null,
      now: isSlotUsable(slot, changed, mapping, r, m, TUNING) !== null,
      inDisc: cellsAround(slot, mapping, r + m).some(({ col, row }) => touched.has(row * COLS + col)),
    }));
  });
  expect({
    transformCentreOutside: outcomes.some((o) => o.source === 'computeComfortTransform' && o.centreOutside),
    paramsSimultaneous: reached('genMappingParams', 'simultaneous'),
    paramsSequential: reached('genMappingParams', 'sequential'),
    paramsNone: reached('genMappingParams', 'none'),
    transformSimultaneous: reached('computeComfortTransform', 'simultaneous'),
    transformSequential: reached('computeComfortTransform', 'sequential'),
    transformNone: reached('computeComfortTransform', 'none'),
    simultaneousSeveral: outcomes.some((o) => o.kind === 'simultaneous' && o.n >= 2),
    sequentialWrapping: outcomes.some((o) => o.kind === 'sequential' && o.n > o.usable),
    promoteInUsableDisc: changes.some((c) => c.grow && c.before && c.inDisc),
    demoteInUsableDisc: changes.some((c) => !c.grow && c.before && c.inDisc),
    demoteInUnusableDisc: changes.some((c) => !c.grow && !c.before && c.inDisc),
    demoteMadeUnusable: changes.some((c) => !c.grow && c.before && !c.now),
  }).toEqual({
    transformCentreOutside: true,
    paramsSimultaneous: true,
    paramsSequential: true,
    paramsNone: true,
    transformSimultaneous: true,
    transformSequential: true,
    transformNone: true,
    simultaneousSeveral: true,
    sequentialWrapping: true,
    promoteInUsableDisc: true,
    demoteInUsableDisc: true,
    demoteInUnusableDisc: true,
    demoteMadeUnusable: true,
  });
}, PROPERTY_TIMEOUT_MS);

// Regression: seed 29, input 340 of placement_covers_every_point's inputs (found while
// checking those inputs over 120 seeds; recorded in docs/bugs-found.md). The numbers
// below are that input exactly: the mapping, the left wrist's grid as (column, row,
// samples) of every cell that holds a sample, and the demand.
//
// Slot 3 is the centre of cell (3, 22) mapped to screen. Its disc has a mapped extreme at
// camera x = 0.15625, exactly the edge x = 5 / 32 of cell (5, 22), which holds no sample.
// The centre is 0.10937499999999989 and the extreme on the other side is 0.0625, so the
// distances from the centre to its extremes are 0.04687499999999989 and
// 0.04687500000000011, one ULP apart. placement.ts took the semi-axis from the +R side
// only, so the gap of 0.04687500000000011 to cell (5, 22) came to 1.0000000000000047
// radii, the cell was not met, and the slot was accepted. The disc's point at the extreme
// lies on the cell's edge, which belongs to the cell: a point of an accepted disc in a
// cell that is not valid, against Req 14.2. The fix takes each semi-axis as the larger of
// the two distances, so the gap is at most 1 radius and the cell is met.
const REGRESSION_MAPPING: MappingParams = {
  playAspect: 2.4,
  frameAspect: 1.0161218350811259,
  gain: 1.6,
  centre: { x: 1e-323, y: 1 },
};
/** Column, row and samples of each cell of the left grid that holds a sample. */
const REGRESSION_LEFT_CELLS: readonly (readonly [number, number, number])[] = [
  [1, 5, 2], [15, 9, 6], [16, 9, 6], [17, 9, 6], [18, 9, 6], [19, 9, 6], [20, 9, 6], [21, 9, 6],
  [1, 20, 7], [2, 20, 7], [3, 20, 7], [4, 20, 7], [1, 21, 7], [2, 21, 7], [3, 21, 7], [4, 21, 7],
  [10, 21, 6], [11, 21, 6], [1, 22, 7], [2, 22, 7], [3, 22, 7], [4, 22, 7], [10, 22, 6], [11, 22, 6],
  [1, 23, 7], [2, 23, 7], [3, 23, 7], [4, 23, 7], [5, 23, 1], [10, 23, 6], [11, 23, 6],
];
const REGRESSION_DEMAND: Demand = {
  slots: [
    { x: 0.3257823742580179, y: 0 },
    { x: 1.26, y: -0.193653581873934 },
    { x: 0.4769252685336323, y: 0.9974214984079752 },
    { x: 3.4200000000000004, y: 1.8533450438705228 },
    { x: 1.4409462904479904, y: 1 },
    { x: 3.66, y: 2.010806476620097 },
  ],
  n: 1,
  r: 0.13,
  m: 0.05,
};

it('regression: a slot whose disc has a mapped extreme exactly on the edge of a cell that is not valid is unusable, though the semi-axis from the +R side is one ULP short (seed 29, input 340)', () => {
  const mapping = makeMapping(REGRESSION_MAPPING);
  const counts = [...EMPTY.counts];
  for (const [col, row, samples] of REGRESSION_LEFT_CELLS) counts[row * COLS + col] = samples;
  const left: ComfortGrid = { ...EMPTY, counts };
  const grids: WristGrids = { left };
  const { r, m } = REGRESSION_DEMAND;
  const slot = REGRESSION_DEMAND.slots[3] ?? { x: NaN, y: NaN };
  const reach = r + m;

  // The construction is as described above. Cell (5, 22) is not valid, the cells around the
  // slot's centre cell (3, 22) are, and the extreme lies exactly on the edge of cell (5, 22).
  const edge = cellRectCamera(5, 22, TUNING).x0;
  const centre = mapping.toCamera(slot);
  const west = mapping.toCamera({ x: slot.x - reach, y: slot.y });
  const east = mapping.toCamera({ x: slot.x + reach, y: slot.y });
  expect(isCellValid(left, 5, 22, TUNING)).toBe(false);
  expect(cellsOf(centre).map(({ col, row }) => [col, row])).toEqual([[3, 22]]);
  expect(isCellValid(left, 3, 22, TUNING)).toBe(true);
  expect(west.x).toBe(edge);
  expect(centre.x - east.x).toBeLessThan(west.x - centre.x);
  // The point of the disc at that extreme maps onto the edge, so it lies in cell (5, 22).
  expect(cellsOf(mapping.toCamera({ x: slot.x - reach, y: slot.y })).map(({ col, row }) => [col, row])).toEqual([
    [5, 22],
  ]);

  expect(isSlotUsable(slot, grids, mapping, r, m, TUNING)).toBeNull();
  // The other five slots are unusable as well, so the demand has no usable slot.
  expect(placeTargets(REGRESSION_DEMAND, grids, mapping, TUNING)).toEqual({ kind: 'none' });
});

// Regression, the same defect on the y axis. Found by searching for the case of the one
// above on y after the fix: a mutation that took only ry from the +R side survived every
// other test, because random inputs seldom give a gap that falls between the two distances.
// The mapping has gain reachGainMax, and the disc has radius hitRadiusMax + MARGIN_MAX
// (0.18). Cell (16, 12), the middle cell, is the only one that is not valid. It lies above
// the disc: the slot's camera centre is 0.6335787785319612, the cell's edge at
// y = 13 / 24 is 0.5416666666666666, and the gap between them, 0.09191211186529458, falls
// between the distance to the extreme on the +R side, 0.09191211186529447, and the one on
// the -R side, 0.09191211186529469. The -R extreme maps to y = 0.5416666666666665, inside
// cell (16, 12). A semi-axis from the +R side alone would put the cell 1.000000000000001
// radii away and accept the slot; the larger of the two puts it 0.9999999999999988 away.
const Y_REGRESSION_MAPPING: MappingParams = {
  playAspect: 1.2239953768539125,
  frameAspect: 1.0000000000000027,
  gain: TUNING.reachGainMax,
  centre: { x: 0, y: 0.9999999999999981 },
};
const Y_REGRESSION_SLOT: Vec2 = { x: 0.9485964170617822, y: 0.4615996917902612 };

it('regression: a non-valid cell above the disc, whose gap falls between the two distances to the extremes on y, makes the slot unusable', () => {
  const mapping = makeMapping(Y_REGRESSION_MAPPING);
  const grids: WristGrids = { right: allValidExcept(MIDDLE) };
  const r = TUNING.hitRadiusMax;
  const m = MARGIN_MAX;
  const reach = r + m;
  const centre = mapping.toCamera(Y_REGRESSION_SLOT);
  const north = mapping.toCamera({ x: Y_REGRESSION_SLOT.x, y: Y_REGRESSION_SLOT.y - reach });
  const south = mapping.toCamera({ x: Y_REGRESSION_SLOT.x, y: Y_REGRESSION_SLOT.y + reach });
  const gap = centre.y - MIDDLE_RECT.y1;

  // The construction is as described above.
  expect(gap).toBeGreaterThan(south.y - centre.y);
  expect(gap).toBeLessThanOrEqual(centre.y - north.y);
  expect(cellsOf(north).map(({ col, row }) => [col, row])).toEqual([[MIDDLE.col, MIDDLE.row]]);
  expect(cellsOf(centre).map(({ col }) => col)).toEqual([MIDDLE.col]);

  expect(isSlotUsable(Y_REGRESSION_SLOT, grids, mapping, r, m, TUNING)).toBeNull();
});

describe('marrow/core', () => {
  it('exports placeTargets, isSlotUsable, Demand and PlacementResult (design section 6)', () => {
    expect(core.placeTargets).toBe(placeTargets);
    expect(core.isSlotUsable).toBe(isSlotUsable);
    // Checked by the type checker (npm run typecheck). At runtime these lines do nothing.
    expectTypeOf<core.Demand>().toEqualTypeOf<Demand>();
    expectTypeOf<core.PlacementResult>().toEqualTypeOf<PlacementResult>();
  });
});
