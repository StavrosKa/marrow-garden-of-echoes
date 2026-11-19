// fast-check generators for the world-view core property tests (design 9.1, 9.3). Test code
// only: reached by relative import, never exported from the entry point. Generator ranges are
// test parameters, not tuning values (design 5.1). Every number of tuning is read from TUNING
// (world-view) or from marrow's TUNING.
//
// The grid, mapping, slot and demand generators are written again here from the public API of
// marrow/core, because marrow's own testgen.ts is not exported (design 9.3).
import fc from 'fast-check';
import {
  TUNING as MARROW_TUNING,
  addSample,
  createGrid,
  makeMapping,
  markAllValid,
  type ComfortGrid,
  type Demand,
  type Mapping,
  type MappingParams,
  type Vec2,
  type WristId,
} from 'marrow/core';
import type { LayerDef, LayerTableEntry } from './layers';
import { TUNING } from './tuning';
import type { LayerRef, ProjectionFrame, Rect, View, WorldPoint } from './types';

// --- Test parameters of design 5.1 ---

/** Relative tolerance of the projection round trip (Req 2.6). */
export const ROUND_TRIP_TOLERANCE = 1e-9;
/** The narrowest play-area aspect the properties draw (Req 2.6: aspect from 1.0 to 2.4). */
export const ASPECT_MIN = 1.0;
/**
 * The absolute floor of the distance assertions of property 3 and of the edge assertions of
 * property 6: `m` is 0 when `sceneScale` is 0, and a screen image computed in floating point can
 * differ from the exact value by a few ulps (design Appendix D, item 2).
 */
export const DISTANCE_FLOOR = 1e-12;

// --- Test parameters of the generators below ---

/** A scene scale between the ends that occurs in a scene of reduced parallax. */
const SCENE_SCALE_MID = 0.6;
/** The head offset limit on each axis (Req 2.6: -1..1). */
const HEAD_LIMIT = 1;
/** The largest anchor of a layer or a point. */
const ANCHOR_MAX = 12;
/** How far below the anchor a travel distance can lie. */
const TRAVEL_BELOW = 5;
/** How far a drawn travel stays from the cull distance, so that no drawn view is culled. */
const TRAVEL_CLEARANCE = 1e-3;
/** How far beyond the cull distance a culled travel can lie. */
const CULL_BEYOND = 5;
/** The largest `depth - anchor - nearPlane` of a layer reference. */
const DEPTH_SPAN = 4000;
/** How far outside the viewport a world point can lie, in layer units. */
const POINT_REACH = 1;
/** The least distance between the depths of two layers of a table, so that a layer can be culled alone. */
const DEPTH_GAP_MIN = 1;
/** The largest extra distance between the depths of two layers of a table. */
const DEPTH_GAP_MAX = 2000;
/** The most backdrop layers of a table. */
const BACKDROPS_MAX = 2;
/** The nearest interior side of a shape, as a fraction of the viewport (it does not touch the edge). */
const INTERIOR_NEAR = 0.01;
/** The middle of the viewport, where the interior sides of a shape stop. */
const INTERIOR_MIDDLE = 0.5;
/** The range of the factor by which a shape extends past the edge it touches, times `edgeOverscan`. */
export const EXTENSION_MIN = 1;
export const EXTENSION_MAX = 3;
/** The most slots a demand holds. */
const SLOTS_MAX = 15;
/** The most targets a demand asks for. */
const DEMAND_N_MAX = 4;
/** The largest number of blocks of cells a grid is built from. */
const GRID_BLOCKS_MAX = 4;
/** The camera aspect of the mapping when it is not drawn (a 4:3 camera). */
const CAMERA_ASPECT = 4 / 3;
/** The unit of the screen's y axis, and the width of the unit square of a shape. Geometry. */
const UNIT = 1;
/** How near an end genSpread's near-end draws lie, as a share of the range's width: 2^-20. */
const NEAR_END_SHARE = 2 ** -20;
/** How many steps genSpread divides its range into, finer than the spacing of doubles used here. */
const EVEN_STEPS = Number.MAX_SAFE_INTEGER;

// --- Numbers in a range ---

/** A number spread evenly over lo..hi: k / EVEN_STEPS of the way, for a whole k drawn with noBias. */
function genEven(lo: number, hi: number): fc.Arbitrary<number> {
  return fc.noBias(fc.integer({ min: 0, max: EVEN_STEPS })).map((k) => {
    const t = k / EVEN_STEPS;
    return Math.min(hi, Math.max(lo, lo * (UNIT - t) + hi * t));
  });
}

/** A number within (hi - lo) * NEAR_END_SHARE of lo or of hi; often the end itself. */
function genNearEnd(lo: number, hi: number): fc.Arbitrary<number> {
  const width = (hi - lo) * NEAR_END_SHARE;
  // The offset is a share of the width on an even grid, so it is never a subnormal double
  // (fc.double would draw those, and a product with them underflows to 0).
  return fc
    .tuple(fc.boolean(), fc.noBias(fc.integer({ min: 0, max: EVEN_STEPS })))
    .map(([nearHi, k]) => {
      const offset = width * (k / EVEN_STEPS);
      return nearHi ? hi - offset : lo + offset;
    });
}

/**
 * A number in lo..hi, both included, that covers the whole range: lo or hi exactly (weight 1),
 * a number spread evenly between them (weight 3), or one near an end (weight 1). Use this, not
 * fc.double, for a number in a range: fc.double spreads its draws over bit patterns, so a range
 * that starts at 0 is dominated by tiny numbers.
 */
export function genSpread(lo: number, hi: number): fc.Arbitrary<number> {
  return fc.oneof(
    { arbitrary: fc.constantFrom(lo, hi), weight: 1 },
    { arbitrary: genEven(lo, hi), weight: 3 },
    { arbitrary: genNearEnd(lo, hi), weight: 1 },
  );
}

// --- Frames, layers, views, points ---

/**
 * A projection frame: aspect in ASPECT_MIN..maxAspect, and a sceneScale that INCLUDES 0:
 * exactly 0, the middle scale, exactly 1, or any number in 0..1. At 0 no layer shifts and the
 * parallax margin is 0.
 */
export function genFrame(): fc.Arbitrary<ProjectionFrame> {
  return fc.record({
    aspect: genSpread(ASPECT_MIN, TUNING.maxAspect),
    sceneScale: fc.oneof(
      fc.constantFrom(0, SCENE_SCALE_MID, UNIT),
      genSpread(0, UNIT),
    ),
  });
}

/** Like genFrame, but the sceneScale EXCLUDES 0: it lies in (0, 1]. For assertions that need a shift. */
export function genFramePositive(): fc.Arbitrary<ProjectionFrame> {
  return fc.record({
    aspect: genSpread(ASPECT_MIN, TUNING.maxAspect),
    sceneScale: fc
      .oneof(fc.constantFrom(SCENE_SCALE_MID, UNIT), genSpread(0, UNIT))
      .filter((scale) => scale > 0),
  });
}

/** A head offset: each axis -1, 0 or 1, or any number in -1..1 (the corners of the square are drawn often). */
export function genHead(): fc.Arbitrary<Vec2> {
  const axis = fc.oneof(fc.constantFrom(-HEAD_LIMIT, 0, HEAD_LIMIT), genSpread(-HEAD_LIMIT, HEAD_LIMIT));
  return fc.record({ x: axis, y: axis });
}

/** A layer reference with `depth - anchor > nearPlane` and a factor in 0..1, both ends drawn often. */
export function genLayerRef(): fc.Arbitrary<LayerRef> {
  return fc
    .record({
      anchor: genSpread(0, ANCHOR_MAX),
      extra: genSpread(0, DEPTH_SPAN),
      factor: genSpread(0, UNIT),
    })
    .map(({ anchor, extra, factor }) => ({ depth: anchor + TUNING.nearPlane + extra, anchor, factor }))
    .filter((layer) => layer.depth - layer.anchor > TUNING.nearPlane);
}

/** The farthest travel at which a layer is not culled and keeps TRAVEL_CLEARANCE from the cull distance. */
export function drawnTravelMax(layer: LayerRef): number {
  return layer.depth - TUNING.nearPlane - TRAVEL_CLEARANCE;
}

/**
 * A view of a layer that is not culled: travel from TRAVEL_BELOW before the anchor up to just
 * before the cull distance, and a head from genHead.
 */
export function genView(layer: LayerRef): fc.Arbitrary<View> {
  return fc.record({
    // Exactly at the anchor (the rest view, scale 1) is drawn on its own: it is no end of the range.
    travel: fc.oneof(fc.constant(layer.anchor), genSpread(layer.anchor - TRAVEL_BELOW, drawnTravelMax(layer))),
    head: genHead(),
  });
}

/**
 * A travel distance at which a layer is not culled and its depth scale is at least 1: from the
 * anchor up to just before the cull distance (Req 4.6).
 */
export function genTravelFromAnchor(layer: LayerRef): fc.Arbitrary<number> {
  // The anchor is never culled (depth - anchor > nearPlane), even when the clearance would pass it.
  return genSpread(layer.anchor, Math.max(layer.anchor, drawnTravelMax(layer)));
}

/**
 * A view of a layer that is culled: travel exactly at the cull distance (`depth - travel` equals
 * nearPlane), beyond it, or NaN.
 */
export function genCulledView(layer: LayerRef): fc.Arbitrary<View> {
  const cullAt = layer.depth - TUNING.nearPlane;
  return fc.record({
    travel: fc.oneof(
      fc.constant(cullAt),
      genSpread(cullAt, layer.depth + CULL_BEYOND),
      fc.constant(NaN),
    ),
    head: genHead(),
  });
}

/** A world point of a layer, in layer units, inside or a little outside the viewport of any aspect. */
export function genWorldPoint(layer: LayerRef): fc.Arbitrary<WorldPoint> {
  return fc
    .record({
      x: genSpread(-POINT_REACH, TUNING.maxAspect + POINT_REACH),
      y: genSpread(-POINT_REACH, UNIT + POINT_REACH),
    })
    .map(({ x, y }) => ({ ...layer, x, y }));
}

// --- Layer tables ---

/**
 * A valid layer table (it passes `validateLayerTable`): layersMin..layersMax layers, depth
 * strictly decreasing with at least DEPTH_GAP_MIN between layers, every depth more than nearPlane
 * above its anchor, factors not decreasing along the table, exactly one interaction layer
 * (without a factor) that is not the nearest, and backdrop flags (with a fill) on a prefix of
 * layers that ends before the interaction layer.
 */
export function genLayerTable(): fc.Arbitrary<LayerTableEntry[]> {
  const low = TUNING.interactionFactor;
  return fc.integer({ min: TUNING.layersMin, max: TUNING.layersMax }).chain((n) =>
    fc
      .integer({ min: 0, max: n - 2 })
      .chain((interactionIndex) =>
        fc.record({
          interactionIndex: fc.constant(interactionIndex),
          before: fc.array(genSpread(0, low), { minLength: interactionIndex, maxLength: interactionIndex }),
          after: fc.array(genSpread(low, UNIT), {
            minLength: n - 1 - interactionIndex,
            maxLength: n - 1 - interactionIndex,
          }),
          backdrops: fc.integer({ min: 0, max: Math.min(BACKDROPS_MAX, interactionIndex) }),
          nearest: genSpread(0, DEPTH_GAP_MAX),
          gaps: fc.array(genSpread(DEPTH_GAP_MIN, DEPTH_GAP_MAX), { minLength: n - 1, maxLength: n - 1 }),
          anchors: fc.array(genSpread(0, ANCHOR_MAX), { minLength: n, maxLength: n }),
        }),
      )
      .map(({ interactionIndex, before, after, backdrops, nearest, gaps, anchors }) => {
        const sortedBefore = [...before].sort((a, b) => a - b);
        const sortedAfter = [...after].sort((a, b) => a - b);
        // The interaction factor must be below the largest factor of the others.
        const last = sortedAfter.length - 1;
        if (sortedAfter[last]! <= low) sortedAfter[last] = UNIT;
        const factors = [...sortedBefore, undefined, ...sortedAfter];
        // Depths from the nearest layer (the last of the table) to the farthest.
        const floor = ANCHOR_MAX + TUNING.nearPlane + DEPTH_GAP_MIN + nearest;
        const depths: number[] = [];
        let depth = floor;
        for (let i = n - 1; i >= 0; i--) {
          depths[i] = depth;
          depth += gaps[i - 1] ?? 0;
        }
        return Array.from({ length: n }, (_, i): LayerTableEntry => {
          const isInteraction = i === interactionIndex;
          const factor = factors[i];
          const backdrop = i < backdrops;
          return {
            id: `layer-${i}`,
            depth: depths[i]!,
            anchor: anchors[i]!,
            backdrop,
            ...(isInteraction ? { interaction: true } : { factor }),
            ...(backdrop ? { fill: { colour: 'fill' } } : {}),
          };
        });
      }),
  );
}

/**
 * A range of travel distances in which no backdrop layer of the table is culled: `from` from
 * TRAVEL_BELOW before zero (so below an anchor and above it), `to` from `from` to just before the
 * nearest cull distance of a backdrop layer.
 */
export function genTravelRange(layers: readonly LayerDef[]): fc.Arbitrary<{ from: number; to: number }> {
  const drawn = layers.filter((layer) => layer.backdrop);
  const hi = Math.min(...(drawn.length > 0 ? drawn : layers).map(drawnTravelMax));
  return genSpread(-TRAVEL_BELOW, hi).chain((from) =>
    genSpread(from, hi).map((to) => ({ from, to })),
  );
}

// --- Shapes that touch a viewport edge ---

/** Which edges of the unit square a shape touches, and the sides it keeps inside the viewport. */
export interface EdgeShape {
  readonly touches: { readonly left: boolean; readonly top: boolean; readonly right: boolean; readonly bottom: boolean };
  /** The positions of the sides that do not touch an edge, in unit coordinates. */
  readonly interior: Rect;
  /** The factor by which a touching side extends past its edge, times the overscan. */
  readonly extension: number;
}

/**
 * A rectangle in unit coordinates that touches at least one viewport edge at rest. Sides that
 * touch extend past the edge by `edgeOverscan` times `extension` in EXTENSION_MIN..EXTENSION_MAX;
 * the other sides lie inside the viewport.
 */
export function genEdgeShape(): fc.Arbitrary<EdgeShape> {
  return fc
    .record({
      touches: fc.record({ left: fc.boolean(), top: fc.boolean(), right: fc.boolean(), bottom: fc.boolean() }),
      interior: fc.record({
        x0: genSpread(INTERIOR_NEAR, INTERIOR_MIDDLE),
        y0: genSpread(INTERIOR_NEAR, INTERIOR_MIDDLE),
        x1: genSpread(INTERIOR_MIDDLE, UNIT - INTERIOR_NEAR),
        y1: genSpread(INTERIOR_MIDDLE, UNIT - INTERIOR_NEAR),
      }),
      extension: genSpread(EXTENSION_MIN, EXTENSION_MAX),
    })
    .filter(({ touches }) => touches.left || touches.top || touches.right || touches.bottom);
}

/**
 * The bounds of an edge shape in unit coordinates, where each touching side extends past its
 * edge by `overscan` times `extension` (the shape's own factor unless one is given).
 */
export function edgeShapeBounds(shape: EdgeShape, overscan: Vec2, extension: number = shape.extension): Rect {
  return {
    x0: shape.touches.left ? -overscan.x * extension : shape.interior.x0,
    y0: shape.touches.top ? -overscan.y * extension : shape.interior.y0,
    x1: shape.touches.right ? UNIT + overscan.x * extension : shape.interior.x1,
    y1: shape.touches.bottom ? UNIT + overscan.y * extension : shape.interior.y1,
  };
}

// --- Comfort grids, mappings, slots, demands (rebuilt from marrow's public API) ---

/** The two comfort grids of a placement, one per wrist that has one. */
export type WristGrids = { readonly [W in WristId]?: ComfortGrid };

/** The centre of a cell of a grid, in camera space. */
function cellCentre(grid: ComfortGrid, col: number, row: number): Vec2 {
  return { x: (col + INTERIOR_MIDDLE) / grid.cols, y: (row + INTERIOR_MIDDLE) / grid.rows };
}

/**
 * A comfort grid of marrow's size: all cells valid (`markAllValid`), no cell valid, or up to
 * GRID_BLOCKS_MAX rectangles of cells that hold `cellValidSamples` samples each.
 */
export function genGrid(): fc.Arbitrary<ComfortGrid> {
  const empty = createGrid(MARROW_TUNING);
  const block = fc.record({
    col: fc.integer({ min: 0, max: empty.cols - 1 }),
    row: fc.integer({ min: 0, max: empty.rows - 1 }),
    width: fc.integer({ min: 1, max: empty.cols }),
    height: fc.integer({ min: 1, max: empty.rows }),
  });
  const blocks = fc.array(block, { minLength: 1, maxLength: GRID_BLOCKS_MAX }).map((list) => {
    let grid = empty;
    for (const { col, row, width, height } of list) {
      for (let r = row; r < Math.min(row + height, empty.rows); r++) {
        for (let c = col; c < Math.min(col + width, empty.cols); c++) {
          for (let k = 0; k < MARROW_TUNING.cellValidSamples; k++) grid = addSample(grid, cellCentre(grid, c, r));
        }
      }
    }
    return grid;
  });
  return fc.oneof(
    { arbitrary: fc.constant(markAllValid(empty)), weight: 2 },
    { arbitrary: fc.constant(empty), weight: 1 },
    { arbitrary: blocks, weight: 3 },
  );
}

/** The grids of a placement: a grid for each wrist that is drawn (at least one of the two). */
export function genGrids(): fc.Arbitrary<WristGrids> {
  return fc
    .record({ right: fc.option(genGrid(), { nil: undefined }), left: fc.option(genGrid(), { nil: undefined }) })
    .filter(({ right, left }) => right !== undefined || left !== undefined)
    .map(({ right, left }) => ({
      ...(right !== undefined ? { right } : {}),
      ...(left !== undefined ? { left } : {}),
    }));
}

/**
 * A mapping for a play area of the given aspect: the camera aspect from ASPECT_MIN..maxAspect or
 * a 4:3 camera, the reach gain in reachGainMin..reachGainMax of marrow, and a comfort centre
 * inside the play area.
 */
export function genMapping(playAspect: number): fc.Arbitrary<Mapping> {
  return genMappingParams(playAspect).map(makeMapping);
}

/** The parameters of genMapping, so a test can see which cases the generator reaches. */
export function genMappingParams(playAspect: number): fc.Arbitrary<MappingParams> {
  return fc
    .record({
      frameAspect: fc.oneof(fc.constant(CAMERA_ASPECT), genSpread(ASPECT_MIN, TUNING.maxAspect)),
      gain: genSpread(MARROW_TUNING.reachGainMin, MARROW_TUNING.reachGainMax),
      centreX: genSpread(0, UNIT),
      centreY: genSpread(0, UNIT),
    })
    .map(({ frameAspect, gain, centreX, centreY }) => ({
      playAspect,
      frameAspect,
      gain,
      centre: { x: centreX * playAspect, y: centreY },
    }));
}

/** One to SLOTS_MAX candidate slots in the play area `[0, aspect] x [0, 1]`, edges included. */
export function genSlots(playAspect: number): fc.Arbitrary<Vec2[]> {
  const slot = fc.record({ x: genSpread(0, playAspect), y: genSpread(0, UNIT) });
  return fc.array(slot, { minLength: 1, maxLength: SLOTS_MAX, size: 'max' });
}

/**
 * A placement demand for a play area and a parallax margin: the slots of genSlots, n in
 * 1..DEMAND_N_MAX and the hit radius in marrow's hitRadiusMin..hitRadiusMax.
 */
export function genDemand(playAspect: number, margin: number): fc.Arbitrary<Demand> {
  return fc.record({
    slots: genSlots(playAspect),
    n: fc.integer({ min: 1, max: DEMAND_N_MAX }),
    r: genSpread(MARROW_TUNING.hitRadiusMin, MARROW_TUNING.hitRadiusMax),
    m: fc.constant(margin),
  });
}
