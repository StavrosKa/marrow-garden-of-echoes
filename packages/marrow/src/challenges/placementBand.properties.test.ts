import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addSample,
  createGrid,
  isCellValid,
  makeMapping,
  placeTargets,
  TUNING,
  type ComfortGrid,
  type Mapping,
  type PlacementResult,
  type Vec2,
} from '../core';
import { inRestingBand, planPlacement, type BandInput, type BandPlacement } from './placementBand';

// The properties of requirement 10 (garden-level): placement with the resting band. Generators are
// written in this file, from marrow's public entry point. Each property runs generated cases through
// planPlacement and judges the result. Problems are collected and checked once per run, as in
// attention.properties.test.ts. Every number comes from TUNING or is a geometry constant below.

const RUNS = 300;
/** Fixed, so the non-vacuity counts are the same on every run. */
const SEED = 20260101;
/** How many problems of a failing run are shown. */
const SHOWN = 5;
const HALF = 0.5;
const WRISTS = ['right', 'left'] as const;
const COLS = TUNING.gridCols;
const ROWS = TUNING.gridRows;
/** Sample directions on each ring of a circle. The samples are not exhaustive. */
const DIRECTIONS = 16;
/** Radii of the sample rings, as fractions of the circle's radius (the centre is always sampled). */
const RINGS = [HALF, 1];

/**
 * The minimum counts that make each property non-vacuous, with the seed above. The first real run
 * (300 cases, seed SEED) counted 45 placed cases, 18 cases with band slots and 5 cases with a band
 * choice. Each minimum is set below its count, with a margin.
 */
const MIN_PLACED_CASES = 20;
const MIN_BAND_CASES = 9;
const MIN_CHOICE_CASES = 2;

type WristGrids = Parameters<typeof placeTargets>[1];

interface Cell {
  readonly col: number;
  readonly row: number;
}

interface Case {
  readonly mapping: Mapping;
  readonly grids: WristGrids;
  readonly input: BandInput;
  readonly bandY: number;
}

interface Direction {
  readonly angle: number;
  readonly t: number;
}

/**
 * A uniform number in [min, max]. fc.double with a range mostly yields values near 0 (checked with
 * fc.sample), so the number is scaled from an integer instead.
 */
const FINE = 1_000_000;
const genRange = (min: number, max: number): fc.Arbitrary<number> =>
  fc.integer({ min: 0, max: FINE }).map((step) => min + ((max - min) * step) / FINE);

const genMapping: fc.Arbitrary<Mapping> = fc
  .record({
    playAspect: genRange(1, 2.5),
    frameAspect: genRange(1, 2.5),
    gain: genRange(TUNING.reachGainMin, TUNING.reachGainMax),
    centre: fc.record({ x: genRange(0, 2.5), y: genRange(0, 1) }),
  })
  .map((params) => makeMapping(params));

/**
 * The valid cells of a wrist: one rectangle of cells, given by two opposite corners. A region of
 * scattered cells almost never holds a whole hit disc, so the regions are contiguous. Most of them
 * lie in the lower half of the frame, where the band is, so that band slots are often needed.
 */
const genCells = (minRow: number): fc.Arbitrary<Cell[]> =>
  fc
    .record({
      c0: fc.integer({ min: 0, max: COLS - 1 }),
      c1: fc.integer({ min: 0, max: COLS - 1 }),
      r0: fc.integer({ min: minRow, max: ROWS - 1 }),
      r1: fc.integer({ min: minRow, max: ROWS - 1 }),
    })
    .map(({ c0, c1, r0, r1 }) => {
      const cells: Cell[] = [];
      for (let row = Math.min(r0, r1); row <= Math.max(r0, r1); row++) {
        for (let col = Math.min(c0, c1); col <= Math.max(c0, c1); col++) cells.push({ col, row });
      }
      return cells;
    });
const genValidCells: fc.Arbitrary<Cell[]> = fc.oneof(
  { weight: 7, arbitrary: genCells(Math.floor(ROWS / 2)) },
  { weight: 3, arbitrary: genCells(0) },
);

/** A grid with each listed cell valid: cellValidSamples samples at the centre of each. */
function gridWith(cells: readonly Cell[]): ComfortGrid {
  let grid = createGrid(TUNING);
  for (const { col, row } of cells) {
    const centre = { x: (col + HALF) / COLS, y: (row + HALF) / ROWS };
    for (let i = 0; i < TUNING.cellValidSamples; i++) grid = addSample(grid, centre);
  }
  return grid;
}

/** Grids for the right wrist, the left, or both. A wrist with no grid is not active. */
const genGrids: fc.Arbitrary<WristGrids> = fc
  .record({
    right: genValidCells,
    left: genValidCells,
    active: fc.constantFrom<'right' | 'left' | 'both'>('right', 'left', 'both'),
  })
  .map(({ right, left, active }) => {
    const grids: { right?: ComfortGrid; left?: ComfortGrid } = {};
    if (active !== 'left') grids.right = gridWith(right);
    if (active !== 'right') grids.left = gridWith(left);
    return grids;
  });

/**
 * Camera points for the slots: some in the frame, some just outside it, and more of them low in the
 * frame. Each one is mapped to screen space with the case's mapping, so the slots sit where the
 * mapping puts them, as in a real frame.
 */
const genCamera: fc.Arbitrary<Vec2> = fc.record({
  x: genRange(-0.2, 1.2),
  y: fc.oneof(genRange(0.6, 1.2), genRange(-0.2, 1.2)),
});

const genCase: fc.Arbitrary<Case> = fc
  .record({
    mapping: genMapping,
    grids: genGrids,
    cameras: fc.array(genCamera, { minLength: 1, maxLength: 30 }),
    n: fc.integer({ min: 1, max: 5 }),
    r: genRange(TUNING.hitRadiusMin, TUNING.hitRadiusMax),
    m: genRange(0, 0.06),
    bandY: genRange(0.5, 1),
  })
  .map(({ mapping, grids, cameras, n, r, m, bandY }) => ({
    mapping,
    grids,
    input: { slots: cameras.map((cam) => mapping.toScreen(cam)), n, r, m },
    bandY,
  }));

/** A head offset as a displacement: its length is at most the parallax margin m, which covers the whole head square. */
const genDirection: fc.Arbitrary<Direction> = fc.record({
  angle: genRange(0, 2 * Math.PI),
  t: genRange(0, 1),
});

function displacement(dir: Direction, m: number): Vec2 {
  return { x: m * dir.t * Math.cos(dir.angle), y: m * dir.t * Math.sin(dir.angle) };
}

/** The slots a result shows targets at: the chosen ones, or for a sequential result the target slots. */
function shownSlots(result: PlacementResult): readonly Vec2[] {
  if (result.kind === 'simultaneous') return result.slots;
  if (result.kind === 'sequential') return result.targetSlots;
  return [];
}

/** The slots a result uses (the usable list for a sequential result). */
function usedSlots(result: PlacementResult): readonly Vec2[] {
  return result.kind === 'none' ? [] : result.slots;
}

/** The centre and sample points of a circle: the centre, then rings in each direction. */
function circleSamples(centre: Vec2, radius: number): Vec2[] {
  const points: Vec2[] = [centre];
  for (const ring of RINGS) {
    for (let i = 0; i < DIRECTIONS; i++) {
      const angle = (2 * Math.PI * i) / DIRECTIONS;
      points.push({
        x: centre.x + radius * ring * Math.cos(angle),
        y: centre.y + radius * ring * Math.sin(angle),
      });
    }
  }
  return points;
}

/**
 * Whether the camera point lies in valid cells of this grid. Every closed cell that holds the point
 * must be valid. A cell is checked through its closed rectangle, so a point on an edge needs both
 * cells. Candidate cells are the ones within one step of floor(x * cols), so no rounding in
 * cellIndex is needed here.
 */
function coveredBy(grid: ComfortGrid, c: Vec2): boolean {
  const colAt = Math.floor(c.x * COLS);
  const rowAt = Math.floor(c.y * ROWS);
  for (let row = rowAt - 1; row <= rowAt + 1; row++) {
    for (let col = colAt - 1; col <= colAt + 1; col++) {
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;
      const holds =
        c.x >= col / COLS && c.x <= (col + 1) / COLS && c.y >= row / ROWS && c.y <= (row + 1) / ROWS;
      if (holds && !isCellValid(grid, col, row, TUNING)) return false;
    }
  }
  return true;
}

/** Whether the camera point is reachable: in the closed frame, and covered by one wrist's grid alone. */
function reachable(c: Vec2, grids: WristGrids): boolean {
  if (!(c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1)) return false;
  return WRISTS.some((wrist) => {
    const grid = grids[wrist];
    return grid !== undefined && coveredBy(grid, c);
  });
}

/** Whether every sample of the screen circle maps to a reachable camera point. */
function circleReachable(centre: Vec2, radius: number, mapping: Mapping, grids: WristGrids): boolean {
  return circleSamples(centre, radius).every((q) => reachable(mapping.toCamera(q), grids));
}

/** Whether two slot lists hold the same objects in the same order. */
function sameSlots(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  return a.length === b.length && a.every((slot, i) => slot === b[i]);
}

/** A text form of a placement by the caller's indices, for the determinism check. */
function shapeOf(placed: BandPlacement, slots: readonly Vec2[]): string {
  const at = (list: readonly Vec2[]): string => list.map((slot) => slots.indexOf(slot)).join(',');
  const { result, bandSlotsUsed } = placed;
  if (result.kind === 'none') return `none|${bandSlotsUsed}`;
  if (result.kind === 'simultaneous') return `simultaneous:${at(result.slots)}|${bandSlotsUsed}`;
  return `sequential:${at(result.slots)}/${at(result.targetSlots)}|${bandSlotsUsed}`;
}

describe('resting band properties (placementBand.properties.test.ts)', () => {
  it('every placed slot and its full hit area lie in the reachable region for every allowed head offset', () => {
    let placedCases = 0;
    fc.assert(
      fc.property(genCase, genDirection, (c, dir) => {
        const { input, mapping, grids, bandY } = c;
        const { r, m } = input;
        const shown = shownSlots(planPlacement(input, grids, mapping, TUNING, bandY).result);
        if (shown.length > 0) placedCases++;
        const offsets: readonly (readonly [string, Vec2])[] = [
          ['rest', { x: 0, y: 0 }],
          [`(${displacement(dir, m).x}, ${displacement(dir, m).y}) with |d| = m`, displacement(dir, m)],
        ];
        const problems: string[] = [];
        for (const slot of shown) {
          // The disc of radius r + m at rest is what the planner checks. It must be reachable.
          if (!circleReachable(slot, r + m, mapping, grids)) {
            problems.push(`slot (${slot.x}, ${slot.y}): the disc of radius r + m at rest is not reachable`);
          }
          // The hit area at each allowed head offset is the disc of radius r around the displaced slot.
          for (const [label, d] of offsets) {
            const centre = { x: slot.x + d.x, y: slot.y + d.y };
            if (!circleReachable(centre, r, mapping, grids)) {
              problems.push(`slot (${slot.x}, ${slot.y}): the hit area at head offset ${label} is not reachable`);
            }
          }
        }
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS, seed: SEED },
    );
    expect(placedCases).toBeGreaterThanOrEqual(MIN_PLACED_CASES);
  });

  it('no band slot is used unless the out-of-band slots cannot give n simultaneous targets', () => {
    let bandCases = 0;
    fc.assert(
      fc.property(genCase, (c) => {
        const { input, mapping, grids, bandY } = c;
        const { r, m, n } = input;
        const placed = planPlacement(input, grids, mapping, TUNING, bandY);
        const bandSet = new Set(input.slots.filter((slot) => inRestingBand(slot, r, mapping, bandY)));
        const outOfBand = input.slots.filter((slot) => !bandSet.has(slot));
        const outResult = placeTargets({ slots: outOfBand, n, r, m }, grids, mapping, TUNING);
        const inBand = usedSlots(placed.result).filter((slot) => bandSet.has(slot)).length;
        const problems: string[] = [];
        if (inBand !== placed.bandSlotsUsed) {
          problems.push(`bandSlotsUsed = ${placed.bandSlotsUsed}, but the result uses ${inBand} band slots`);
        }
        if (outResult.kind === 'simultaneous') {
          const kept =
            placed.result.kind === 'simultaneous' && sameSlots(placed.result.slots, outResult.slots);
          if (!kept || placed.bandSlotsUsed !== 0) {
            problems.push('the out-of-band simultaneous result is not returned unchanged');
          }
        }
        if (placed.bandSlotsUsed > 0) {
          bandCases++;
          if (outResult.kind === 'simultaneous') {
            problems.push('a band slot is used although the out-of-band slots give simultaneous');
          }
          const reachesSimultaneous = placed.result.kind === 'simultaneous';
          if (!reachesSimultaneous && outResult.kind !== 'none') {
            problems.push('a band slot is used although the out-of-band slots are usable');
          }
        }
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS, seed: SEED },
    );
    expect(bandCases).toBeGreaterThanOrEqual(MIN_BAND_CASES);
  });

  it('the band slots used are the nearest to the upper edge, and no more than needed', () => {
    let choiceCases = 0;
    fc.assert(
      fc.property(genCase, (c) => {
        const { input, mapping, grids, bandY } = c;
        const { r, m, n } = input;
        const placed = planPlacement(input, grids, mapping, TUNING, bandY);
        if (placed.bandSlotsUsed === 0) return;
        const band = input.slots
          .map((slot, index) => ({ slot, index, top: mapping.toCamera({ x: slot.x, y: slot.y - r }).y }))
          .filter((entry) => inRestingBand(entry.slot, r, mapping, bandY))
          .sort((a, b) => a.top - b.top || a.index - b.index)
          .map((entry) => entry.slot);
        const outOfBand = input.slots.filter((slot) => !inRestingBand(slot, r, mapping, bandY));
        // The prefix of k band slots, in the order of their top points, with the out-of-band slots first.
        const prefix = (k: number): PlacementResult =>
          placeTargets({ slots: [...outOfBand, ...band.slice(0, k)], n, r, m }, grids, mapping, TUNING);
        const wanted = placed.result.kind === 'simultaneous' ? 'simultaneous' : 'usable';
        let k = 0;
        for (let j = 1; j <= band.length && k === 0; j++) {
          const found = prefix(j);
          const matches = wanted === 'simultaneous' ? found.kind === 'simultaneous' : found.kind !== 'none';
          if (matches) k = j;
        }
        const problems: string[] = [];
        if (k === 0) {
          problems.push('band slots are used, but no prefix of the band order gives the same placement');
        } else {
          const expected = prefix(k);
          if (!sameSlots(usedSlots(placed.result), usedSlots(expected))) {
            problems.push(`the band slots used are not the first ${k} in the band order`);
          }
          if (placed.result.kind === 'sequential' && expected.kind === 'sequential') {
            if (!sameSlots(placed.result.targetSlots, expected.targetSlots)) {
              problems.push('the sequential targets differ from the prefix of the band order');
            }
          }
        }
        if (placed.result.kind === 'simultaneous' && band.length >= 2) choiceCases++;
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS, seed: SEED },
    );
    expect(choiceCases).toBeGreaterThanOrEqual(MIN_CHOICE_CASES);
  });

  it('the same input gives the same placement', () => {
    fc.assert(
      fc.property(genCase, (c) => {
        const { input, mapping, grids, bandY } = c;
        const before = input.slots.map((slot) => ({ x: slot.x, y: slot.y }));
        const first = planPlacement(input, grids, mapping, TUNING, bandY);
        const again = planPlacement(input, grids, mapping, TUNING, bandY);
        const copy = input.slots.map((slot) => ({ x: slot.x, y: slot.y }));
        const fromCopy = planPlacement({ ...input, slots: copy }, grids, mapping, TUNING, bandY);
        const problems: string[] = [];
        const unchanged =
          input.slots.length === before.length &&
          input.slots.every((slot, i) => slot.x === before[i]?.x && slot.y === before[i]?.y);
        if (!unchanged) problems.push('the input slots were changed');
        if (shapeOf(first, input.slots) !== shapeOf(again, input.slots)) {
          problems.push('two runs on the same input differ');
        }
        if (shapeOf(first, input.slots) !== shapeOf(fromCopy, copy)) {
          problems.push('a run on equal copies of the slots differs');
        }
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});
