// The generators reach their corner cases (as marrow's testgen.test.ts does for marrow's).
// A fixed seed makes each check repeatable, and each sample is large enough that a corner
// case drawn with a few percent chance is certain to appear.
import fc from 'fast-check';
import { TUNING as MARROW_TUNING, isCellValid } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { resolveLayerTable, validateLayerTable } from './layers';
import { isCulled, worldToScreen } from './projection';
import {
  ASPECT_MIN,
  DISTANCE_FLOOR,
  EXTENSION_MAX,
  EXTENSION_MIN,
  ROUND_TRIP_TOLERANCE,
  edgeShapeBounds,
  genCulledView,
  genDemand,
  genEdgeShape,
  genFrame,
  genFramePositive,
  genGrid,
  genGrids,
  genHead,
  genLayerRef,
  genLayerTable,
  genMappingParams,
  genSlots,
  genSpread,
  genTravelFromAnchor,
  genTravelRange,
  genView,
  genWorldPoint,
} from './testgen';
import { TUNING } from './tuning';

const SEED = 20260119;
const SAMPLE = 2000;

const sample = <T>(arbitrary: fc.Arbitrary<T>, runs: number = SAMPLE): T[] =>
  fc.sample(arbitrary, { numRuns: runs, seed: SEED });

// Boundaries and levels, derived from tuning or fixed by the requirements.
const ONE = TUNING.nearPlane / TUNING.nearPlane;
const ZERO = TUNING.nearPlane - TUNING.nearPlane;
const SCENE_SCALE_MID = 0.6;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= DISTANCE_FLOOR;

describe('testgen test parameters', () => {
  it('the parameters of design 5.1 have their values', () => {
    expect(ROUND_TRIP_TOLERANCE).toBe(1e-9);
    expect(ASPECT_MIN).toBe(1.0);
    expect(DISTANCE_FLOOR).toBe(1e-12);
    expect(EXTENSION_MIN).toBeLessThan(EXTENSION_MAX);
  });
});

describe('testgen genSpread', () => {
  it('genSpread reaches both ends, the middle and near the ends, and stays in range', () => {
    const lo = ZERO;
    const hi = TUNING.nearPlane;
    const values = sample(genSpread(lo, hi));
    expect(values.every((v) => v >= lo && v <= hi)).toBe(true);
    expect(values).toContain(lo);
    expect(values).toContain(hi);
    const middle = values.filter((v) => v > hi / 4 && v < (3 * hi) / 4);
    expect(middle.length).toBeGreaterThan(SAMPLE / 10);
    expect(values.some((v) => v > lo && v < hi * 1e-4)).toBe(true);
    // No subnormal draws: a product with one underflows to 0.
    expect(values.every((v) => v === 0 || v > Number.MIN_VALUE * 1e10)).toBe(true);
  });
});

describe('testgen genFrame', () => {
  it('genFrame reaches both aspect ends and sceneScale 0, the middle scale, 1 and in between', () => {
    const frames = sample(genFrame());
    expect(frames.every((f) => f.aspect >= ASPECT_MIN && f.aspect <= TUNING.maxAspect)).toBe(true);
    expect(frames.some((f) => f.aspect === ASPECT_MIN)).toBe(true);
    expect(frames.some((f) => f.aspect === TUNING.maxAspect)).toBe(true);
    // sceneScale includes 0, as its comment says.
    expect(frames.some((f) => f.sceneScale === ZERO)).toBe(true);
    expect(frames.some((f) => f.sceneScale === SCENE_SCALE_MID)).toBe(true);
    expect(frames.some((f) => f.sceneScale === ONE)).toBe(true);
    expect(frames.some((f) => f.sceneScale > ZERO && f.sceneScale < ONE && f.sceneScale !== SCENE_SCALE_MID)).toBe(true);
    expect(frames.every((f) => f.sceneScale >= ZERO && f.sceneScale <= ONE)).toBe(true);
  });

  it('genFramePositive never draws sceneScale 0 and reaches 1', () => {
    const frames = sample(genFramePositive());
    expect(frames.every((f) => f.sceneScale > ZERO && f.sceneScale <= ONE)).toBe(true);
    expect(frames.some((f) => f.sceneScale === ONE)).toBe(true);
    expect(frames.some((f) => f.aspect === ASPECT_MIN)).toBe(true);
    expect(frames.some((f) => f.aspect === TUNING.maxAspect)).toBe(true);
  });
});

describe('testgen genHead', () => {
  it('genHead reaches every corner of the square, the centre, the axes and the inside', () => {
    const heads = sample(genHead());
    const has = (x: number, y: number): boolean => heads.some((h) => h.x === x && h.y === y);
    for (const x of [-ONE, ZERO, ONE]) for (const y of [-ONE, ZERO, ONE]) expect(has(x, y)).toBe(true);
    expect(heads.every((h) => Math.abs(h.x) <= ONE && Math.abs(h.y) <= ONE)).toBe(true);
    expect(heads.some((h) => Math.abs(h.x) > ZERO && Math.abs(h.x) < ONE && Math.abs(h.y) > ZERO && Math.abs(h.y) < ONE)).toBe(true);
  });
});

describe('testgen genLayerRef, genView, genWorldPoint', () => {
  it('genLayerRef keeps depth - anchor above nearPlane and reaches factor 0, 1 and the near plane', () => {
    const layers = sample(genLayerRef());
    expect(layers.every((l) => l.depth - l.anchor > TUNING.nearPlane)).toBe(true);
    expect(layers.every((l) => l.factor >= ZERO && l.factor <= ONE)).toBe(true);
    expect(layers.some((l) => l.factor === ZERO)).toBe(true);
    expect(layers.some((l) => l.factor === ONE)).toBe(true);
    // A layer just beyond the near plane (the smallest gap), and one far away.
    expect(layers.some((l) => l.depth - l.anchor - TUNING.nearPlane < ONE / 100)).toBe(true);
    expect(layers.some((l) => l.depth - l.anchor > ONE * 1000)).toBe(true);
  });

  it('genView is never culled and reaches travel before the anchor, at it and after it', () => {
    const views = sample(genLayerRef().chain((layer) => fc.tuple(fc.constant(layer), genView(layer))));
    expect(views.every(([layer, view]) => !isCulled(layer, view.travel))).toBe(true);
    expect(views.some(([layer, view]) => view.travel < layer.anchor)).toBe(true);
    expect(views.some(([layer, view]) => view.travel === layer.anchor)).toBe(true);
    expect(views.some(([layer, view]) => view.travel > layer.anchor)).toBe(true);
    // The head offset is in the square.
    expect(views.every(([, view]) => Math.abs(view.head.x) <= ONE && Math.abs(view.head.y) <= ONE)).toBe(true);
  });

  it('genTravelFromAnchor is at or after the anchor and never culled', () => {
    const travels = sample(genLayerRef().chain((layer) => fc.tuple(fc.constant(layer), genTravelFromAnchor(layer))));
    expect(travels.every(([layer, travel]) => travel >= layer.anchor && !isCulled(layer, travel))).toBe(true);
    expect(travels.some(([layer, travel]) => travel === layer.anchor)).toBe(true);
  });

  it('genCulledView is culled: exactly at the near plane, beyond it, and NaN', () => {
    const views = sample(genLayerRef().chain((layer) => fc.tuple(fc.constant(layer), genCulledView(layer))));
    expect(views.every(([layer, view]) => isCulled(layer, view.travel))).toBe(true);
    expect(views.some(([layer, view]) => layer.depth - view.travel === TUNING.nearPlane)).toBe(true);
    expect(views.some(([layer, view]) => layer.depth - view.travel < TUNING.nearPlane)).toBe(true);
    expect(views.some(([, view]) => Number.isNaN(view.travel))).toBe(true);
  });

  it('genWorldPoint reaches points inside the viewport and outside it, and projects when it is not culled', () => {
    const cases = sample(genLayerRef().chain((layer) => fc.tuple(fc.constant(layer), genView(layer), genWorldPoint(layer), genFrame())));
    expect(cases.some(([, , p, f]) => p.x >= ZERO && p.x <= f.aspect && p.y >= ZERO && p.y <= ONE)).toBe(true);
    expect(cases.some(([, , p]) => p.x < ZERO)).toBe(true);
    expect(cases.some(([, , p, f]) => p.x > f.aspect)).toBe(true);
    expect(cases.some(([, , p]) => p.y < ZERO)).toBe(true);
    expect(cases.some(([, , p]) => p.y > ONE)).toBe(true);
    expect(cases.every(([, view, point, frame]) => worldToScreen(point, view, frame) !== null)).toBe(true);
  });
});

describe('testgen genLayerTable', () => {
  const tables = sample(genLayerTable());

  it('genLayerTable passes validateLayerTable, with every layer count, interaction place and backdrop count', () => {
    expect(tables.map((entries) => validateLayerTable(entries)).filter((issues) => issues.length > ZERO)).toEqual([]);
    const counts = new Set(tables.map((entries) => entries.length));
    expect([...counts].sort()).toEqual(
      Array.from({ length: TUNING.layersMax - TUNING.layersMin + ONE }, (_, i) => TUNING.layersMin + i),
    );
    // The interaction layer is first and in every later place up to the one before the nearest layer,
    // and never the nearest (the largest factor of the others must be above its own).
    const places = tables.map((entries) => ({ at: entries.findIndex((entry) => entry.interaction === true), n: entries.length }));
    expect(places.every(({ at, n }) => at >= ZERO && at <= n - ONE - ONE)).toBe(true);
    const interactionAt = new Set(places.map(({ at }) => at));
    for (let at = ZERO; at <= TUNING.layersMax - ONE - ONE; at++) expect(interactionAt.has(at)).toBe(true);
    const backdrops = new Set(tables.map((entries) => entries.filter((entry) => entry.backdrop).length));
    expect([...backdrops].sort()).toEqual([ZERO, ONE, ONE + ONE]);
  });

  it('genLayerTable keeps a gap between depths so that a layer can be culled alone, and every anchor below the nearest cull', () => {
    for (const entries of tables) {
      const layers = resolveLayerTable(entries);
      layers.forEach((layer, i) => {
        const before = layers[i - ONE];
        if (before !== undefined) expect(before.depth - layer.depth).toBeGreaterThanOrEqual(ONE);
        expect(layer.depth - layer.anchor).toBeGreaterThan(TUNING.nearPlane);
      });
    }
  });

  it('genLayerTable reaches factors 0 and 1 and equal neighbouring factors', () => {
    const factors = tables.flatMap((entries) => resolveLayerTable(entries).map((layer) => layer.factor));
    expect(factors).toContain(ZERO);
    expect(factors).toContain(ONE);
    const equalNeighbours = tables.some((entries) => {
      const layers = resolveLayerTable(entries);
      return layers.some((layer, i) => i > ZERO && layer.factor === layers[i - ONE]!.factor);
    });
    expect(equalNeighbours).toBe(true);
  });

  it('genTravelRange stays before the cull distance of every backdrop layer and reaches from < anchor, from = to', () => {
    const cases = sample(
      genLayerTable().chain((entries) => {
        const layers = resolveLayerTable(entries);
        return fc.tuple(fc.constant(layers), genTravelRange(layers));
      }),
    );
    for (const [layers, range] of cases) {
      expect(range.from).toBeLessThanOrEqual(range.to);
      for (const layer of layers.filter((candidate) => candidate.backdrop)) expect(isCulled(layer, range.to)).toBe(false);
    }
    expect(cases.some(([layers, range]) => layers.some((layer) => range.from < layer.anchor))).toBe(true);
    expect(cases.some(([layers, range]) => layers.some((layer) => range.to > layer.anchor))).toBe(true);
    expect(cases.some(([, range]) => range.from === range.to)).toBe(true);
    expect(cases.some(([, range]) => range.from < range.to)).toBe(true);
  });
});

describe('testgen genEdgeShape', () => {
  it('genEdgeShape touches at least one edge, every edge in some sample, and both ends of the extension', () => {
    const shapes = sample(genEdgeShape());
    expect(shapes.every((s) => s.touches.left || s.touches.top || s.touches.right || s.touches.bottom)).toBe(true);
    for (const edge of ['left', 'top', 'right', 'bottom'] as const) expect(shapes.some((s) => s.touches[edge])).toBe(true);
    for (const edge of ['left', 'top', 'right', 'bottom'] as const) expect(shapes.some((s) => !s.touches[edge])).toBe(true);
    expect(shapes.some((s) => s.touches.left && s.touches.top && s.touches.right && s.touches.bottom)).toBe(true);
    expect(shapes.some((s) => s.extension === EXTENSION_MIN)).toBe(true);
    expect(shapes.some((s) => s.extension === EXTENSION_MAX)).toBe(true);
    // The interior sides stay inside the unit square.
    expect(shapes.every((s) => s.interior.x0 > ZERO && s.interior.y0 > ZERO && s.interior.x1 < ONE && s.interior.y1 < ONE)).toBe(true);
  });

  it('edgeShapeBounds puts each touching side past its edge by the overscan times the extension', () => {
    const overscan = { x: TUNING.limitX, y: TUNING.limitY };
    for (const shape of sample(genEdgeShape(), 200)) {
      const bounds = edgeShapeBounds(shape, overscan);
      if (shape.touches.left) expect(bounds.x0).toBe(-overscan.x * shape.extension);
      else expect(bounds.x0).toBe(shape.interior.x0);
      if (shape.touches.right) expect(bounds.x1).toBe(ONE + overscan.x * shape.extension);
      else expect(bounds.x1).toBe(shape.interior.x1);
      if (shape.touches.top) expect(bounds.y0).toBe(-overscan.y * shape.extension);
      else expect(bounds.y0).toBe(shape.interior.y0);
      if (shape.touches.bottom) expect(bounds.y1).toBe(ONE + overscan.y * shape.extension);
      else expect(bounds.y1).toBe(shape.interior.y1);
    }
  });
});

describe('testgen grids, mappings, slots and demands', () => {
  it('genGrid reaches an all-valid grid, an empty grid and a partial one, of marrow size', () => {
    const grids = sample(genGrid(), 300);
    const validCount = (grid: (typeof grids)[number]): number => {
      let count = ZERO;
      for (let row = ZERO; row < grid.rows; row++) {
        for (let col = ZERO; col < grid.cols; col++) if (isCellValid(grid, col, row, MARROW_TUNING)) count += ONE;
      }
      return count;
    };
    expect(grids.every((g) => g.cols === MARROW_TUNING.gridCols && g.rows === MARROW_TUNING.gridRows)).toBe(true);
    const counts = grids.map(validCount);
    expect(counts).toContain(MARROW_TUNING.gridCols * MARROW_TUNING.gridRows);
    expect(counts).toContain(ZERO);
    expect(counts.some((c) => c > ZERO && c < MARROW_TUNING.gridCols * MARROW_TUNING.gridRows)).toBe(true);
  });

  it('genGrids reaches a right grid alone, a left grid alone and both, and never none', () => {
    const grids = sample(genGrids(), 200);
    expect(grids.every((g) => g.right !== undefined || g.left !== undefined)).toBe(true);
    expect(grids.some((g) => g.right !== undefined && g.left === undefined)).toBe(true);
    expect(grids.some((g) => g.right === undefined && g.left !== undefined)).toBe(true);
    expect(grids.some((g) => g.right !== undefined && g.left !== undefined)).toBe(true);
  });

  it('genMappingParams reaches both ends of the reach gain, the play aspect, a 4:3 camera and a centre in the play area', () => {
    const aspect = TUNING.maxAspect;
    const params = sample(genMappingParams(aspect));
    expect(params.every((p) => p.playAspect === aspect)).toBe(true);
    expect(params.some((p) => p.gain === MARROW_TUNING.reachGainMin)).toBe(true);
    expect(params.some((p) => p.gain === MARROW_TUNING.reachGainMax)).toBe(true);
    expect(params.every((p) => p.gain >= MARROW_TUNING.reachGainMin && p.gain <= MARROW_TUNING.reachGainMax)).toBe(true);
    expect(params.every((p) => p.centre.x >= ZERO && p.centre.x <= aspect && p.centre.y >= ZERO && p.centre.y <= ONE)).toBe(true);
    expect(params.some((p) => p.frameAspect === ASPECT_MIN)).toBe(true);
    expect(params.some((p) => p.frameAspect === TUNING.maxAspect)).toBe(true);
    expect(params.some((p) => p.frameAspect > ASPECT_MIN && p.frameAspect < TUNING.maxAspect)).toBe(true);
  });

  it('genSlots reaches one slot and the most slots, inside the play area with its edges', () => {
    const aspect = TUNING.maxAspect;
    const lists = sample(genSlots(aspect));
    expect(lists.some((l) => l.length === ONE)).toBe(true);
    const longest = Math.max(...lists.map((l) => l.length));
    expect(longest).toBeGreaterThan(MARROW_TUNING.hitRadiusMax * 100);
    const slots = lists.flat();
    expect(slots.every((s) => s.x >= ZERO && s.x <= aspect && s.y >= ZERO && s.y <= ONE)).toBe(true);
    expect(slots.some((s) => s.x === ZERO)).toBe(true);
    expect(slots.some((s) => s.x === aspect)).toBe(true);
    expect(slots.some((s) => s.y === ZERO)).toBe(true);
    expect(slots.some((s) => s.y === ONE)).toBe(true);
  });

  it('genDemand reaches n from 1 up and both ends of the hit radius, with the given margin', () => {
    const margin = TUNING.limitX;
    const demands = sample(genDemand(TUNING.maxAspect, margin));
    expect(demands.every((d) => d.m === margin)).toBe(true);
    expect(demands.some((d) => d.n === ONE)).toBe(true);
    expect(Math.max(...demands.map((d) => d.n))).toBeGreaterThan(ONE + ONE);
    expect(demands.some((d) => d.r === MARROW_TUNING.hitRadiusMin)).toBe(true);
    expect(demands.some((d) => d.r === MARROW_TUNING.hitRadiusMax)).toBe(true);
    expect(demands.every((d) => d.r >= MARROW_TUNING.hitRadiusMin && d.r <= MARROW_TUNING.hitRadiusMax)).toBe(true);
    expect(near(demands[ZERO]!.m, margin)).toBe(true);
  });
});
