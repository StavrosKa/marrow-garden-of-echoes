import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  addSample,
  cellRectCamera,
  createGrid,
  markAllValid,
  validCells,
  type CellIndex,
  type ComfortGrid,
} from './comfortGrid';
import type { Vec2, WristId } from './frame';
import { dist } from './geometry';
import * as core from './index';
import { makeMapping, type Mapping } from './mapping';
import { isSlotUsable, placeTargets, type Demand, type PlacementResult } from './placement';
import type { WristGrids } from './reachGain';
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

describe('marrow/core', () => {
  it('exports placeTargets, isSlotUsable, Demand and PlacementResult (design section 6)', () => {
    expect(core.placeTargets).toBe(placeTargets);
    expect(core.isSlotUsable).toBe(isSlotUsable);
    // Checked by the type checker (npm run typecheck). At runtime these lines do nothing.
    expectTypeOf<core.Demand>().toEqualTypeOf<Demand>();
    expectTypeOf<core.PlacementResult>().toEqualTypeOf<PlacementResult>();
  });
});
