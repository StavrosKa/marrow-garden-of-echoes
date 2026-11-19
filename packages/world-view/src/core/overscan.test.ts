import fc from 'fast-check';
import type { Vec2 } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { resolveLayerTable, type LayerDef } from './layers';
import { backdropRect, edgeOverscan, shapeOverscanIssues, type TravelRange } from './overscan';
import { isCulled, layerTransform, worldToScreen } from './projection';
import {
  DISTANCE_FLOOR,
  drawnTravelMax,
  edgeShapeBounds,
  genEdgeShape,
  genFrame,
  genHead,
  genLayerTable,
  genSpread,
  genTravelFromAnchor,
  genTravelRange,
  type EdgeShape,
} from './testgen';
import { TUNING } from './tuning';
import type { ProjectionFrame, Rect, View } from './types';

// The extension of the shape of the rejection check: half of edgeOverscan (design 9.1, item 6).
const HALF = 0.5;
// The heads that always run: the four corners of the head square and the centre.
const ONE = 1;
const ZERO = 0;
const CORNER_HEADS: Vec2[] = [
  { x: -ONE, y: -ONE },
  { x: ONE, y: -ONE },
  { x: -ONE, y: ONE },
  { x: ONE, y: ONE },
  { x: ZERO, y: ZERO },
];

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The bounding box of the screen images of the four corners of a rectangle of a layer, or null if culled. */
function imageOf(rect: Rect, layer: LayerDef, view: View, frame: ProjectionFrame): Box | null {
  const corners = [
    { x: rect.x0, y: rect.y0 },
    { x: rect.x1, y: rect.y0 },
    { x: rect.x0, y: rect.y1 },
    { x: rect.x1, y: rect.y1 },
  ].map((corner) => worldToScreen({ ...layer, ...corner }, view, frame));
  if (corners.some((corner) => corner === null)) return null;
  const xs = corners.map((corner) => corner!.x);
  const ys = corners.map((corner) => corner!.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Whether a box contains the viewport `[0, A] x [0, 1]`, up to the absolute floor of rounding. */
function coversViewport(box: Box, frame: ProjectionFrame): boolean {
  return (
    box.x0 <= DISTANCE_FLOOR &&
    box.y0 <= DISTANCE_FLOOR &&
    box.x1 >= frame.aspect - DISTANCE_FLOOR &&
    box.y1 >= ONE - DISTANCE_FLOOR
  );
}

/** A layer table with a travel range in which no backdrop layer is culled, and a frame. */
const backdropCase = genLayerTable().chain((entries) => {
  const layers = resolveLayerTable(entries);
  return fc.record({
    layers: fc.constant(layers),
    frame: genFrame(),
    range: genTravelRange(layers),
    heads: fc.array(genHead(), { maxLength: 4 }),
    fractions: fc.array(genSpread(ZERO, ONE), { minLength: 1, maxLength: 4 }),
  });
});

describe('no layer edge exposed', () => {
  it('no layer edge exposed', () => {
    fc.assert(
      fc.property(backdropCase, ({ layers, frame, range, heads, fractions }) => {
        const travels = [range.from, range.to, ...fractions.map((f) => range.from + f * (range.to - range.from))];
        // Backdrop layers: the drawn rectangle covers the viewport at every travel of the range and every head.
        for (const layer of layers.filter((candidate) => candidate.backdrop)) {
          const rect = backdropRect(layer, range, frame);
          for (const travel of travels) {
            for (const head of [...CORNER_HEADS, ...heads]) {
              if (isCulled(layer, travel)) continue;
              const box = imageOf(rect, layer, { travel, head }, frame);
              expect(box).not.toBeNull();
              expect(coversViewport(box!, frame)).toBe(true);
            }
          }
        }
      }),
    );
  });

  it('no layer edge exposed: a shape that touches an edge and extends by edgeOverscan still reaches it', () => {
    let rejected = 0;
    const shapeCase = genLayerTable().chain((entries) => {
      const layers = resolveLayerTable(entries).filter((layer) => !layer.backdrop);
      return fc.record({
        layers: fc.constant(layers),
        frame: genFrame(),
        shapes: fc.array(genEdgeShape(), { minLength: layers.length, maxLength: layers.length }),
        heads: fc.array(genHead(), { maxLength: 4 }),
        fractions: fc.array(genSpread(ZERO, ONE), { minLength: 1, maxLength: 3 }),
      });
    });
    fc.assert(
      fc.property(shapeCase, ({ layers, frame, shapes, heads, fractions }) => {
        layers.forEach((layer, i) => {
          const shape: EdgeShape = shapes[i]!;
          const unit = { aspect: ONE, sceneScale: frame.sceneScale };
          const overscan = edgeOverscan(layer, unit);
          const bounds = edgeShapeBounds(shape, overscan);
          // The validation accepts every such shape.
          expect(shapeOverscanIssues(bounds, layer, frame.sceneScale)).toEqual([]);
          // The shape at the play-area aspect: x is u * A.
          const rect = { x0: bounds.x0 * frame.aspect, y0: bounds.y0, x1: bounds.x1 * frame.aspect, y1: bounds.y1 };
          const last = drawnTravelMax(layer);
          for (const fraction of fractions) {
            // Travel from the anchor on, where the depth scale is at least 1.
            const travel = layer.anchor + fraction * (last - layer.anchor);
            for (const head of [...CORNER_HEADS, ...heads]) {
              const box = imageOf(rect, layer, { travel, head }, frame)!;
              if (shape.touches.left) expect(box.x0).toBeLessThanOrEqual(DISTANCE_FLOOR);
              if (shape.touches.top) expect(box.y0).toBeLessThanOrEqual(DISTANCE_FLOOR);
              if (shape.touches.right) expect(box.x1).toBeGreaterThanOrEqual(frame.aspect - DISTANCE_FLOOR);
              if (shape.touches.bottom) expect(box.y1).toBeGreaterThanOrEqual(ONE - DISTANCE_FLOOR);
            }
          }
          // A shape that extends by half of edgeOverscan is rejected, whenever there is an overscan to miss.
          if (overscan.x > ZERO && overscan.y > ZERO) {
            const half = edgeShapeBounds(shape, overscan, HALF);
            const issues = shapeOverscanIssues(half, layer, frame.sceneScale);
            expect(issues.length).toBeGreaterThan(ZERO);
            rejected += 1;
          }
        });
      }),
    );
    expect(rejected).toBeGreaterThan(ZERO);
  });

  it('no layer edge exposed: travel from the anchor on only moves a shape edge outwards', () => {
    const case_ = genLayerTable().chain((entries) => {
      const layers = resolveLayerTable(entries).filter((layer) => !layer.backdrop);
      return fc.record({
        layer: fc.constantFrom(...layers),
        travel: genSpread(ZERO, ONE),
      });
    });
    fc.assert(
      fc.property(case_, genFrame(), ({ layer, travel }, frame) => {
        const at = layer.anchor + travel * (drawnTravelMax(layer) - layer.anchor);
        const rest = layerTransform(layer, { travel: layer.anchor, head: { x: ZERO, y: ZERO } }, frame);
        const moved = layerTransform(layer, { travel: at, head: { x: ZERO, y: ZERO } }, frame);
        expect(rest!.scale).toBe(ONE);
        expect(moved!.scale).toBeGreaterThanOrEqual(ONE);
      }),
    );
    // genTravelFromAnchor draws the same range as the property above.
    fc.assert(
      fc.property(
        genLayerTable().chain((entries) => {
          const layer = resolveLayerTable(entries)[ZERO]!;
          return fc.tuple(fc.constant(layer), genTravelFromAnchor(layer));
        }),
        ([layer, travel]) => {
          expect(travel).toBeGreaterThanOrEqual(layer.anchor);
          expect(isCulled(layer, travel)).toBe(false);
        },
      ),
    );
  });

  it('no layer edge exposed: a culled layer is hidden and the backdrops behind it still cover the viewport', () => {
    const culledCase = genLayerTable().chain((entries) => {
      const layers = resolveLayerTable(entries);
      const nearest = layers[layers.length - 1]!;
      const backdrops = layers.filter((layer) => layer.backdrop);
      // Past the cull distance of the nearest layer, still before the nearest cull distance of a backdrop.
      const hi = Math.min(...(backdrops.length > 0 ? backdrops : layers.slice(ZERO, -ONE)).map(drawnTravelMax));
      return fc.record({
        layers: fc.constant(layers),
        nearest: fc.constant(nearest),
        frame: genFrame(),
        travel: genSpread(nearest.depth - TUNING.nearPlane, hi),
        from: genSpread(-nearest.depth, ZERO),
        heads: fc.array(genHead(), { maxLength: 4 }),
      });
    });
    fc.assert(
      fc.property(culledCase, ({ layers, nearest, frame, travel, from, heads }) => {
        expect(isCulled(nearest, travel)).toBe(true);
        // The culled layer is removed from the render (Req 4.8).
        expect(layerTransform(nearest, { travel, head: { x: ZERO, y: ZERO } }, frame)).toBeNull();
        const range: TravelRange = { from: Math.min(from, travel), to: travel };
        for (const layer of layers.filter((candidate) => candidate.backdrop)) {
          const rect = backdropRect(layer, range, frame);
          for (const head of [...CORNER_HEADS, ...heads]) {
            const box = imageOf(rect, layer, { travel, head }, frame);
            expect(box).not.toBeNull();
            expect(coversViewport(box!, frame)).toBe(true);
          }
        }
      }),
    );
  });
});

describe('backdropRect and edgeOverscan', () => {
  it('backdropRect is the viewport grown by the overscan when the smallest scale is at least 1', () => {
    fc.assert(
      fc.property(backdropCase, ({ layers, frame, range }) => {
        for (const layer of layers.filter((candidate) => candidate.backdrop)) {
          const atAnchor: TravelRange = { from: Math.max(range.from, layer.anchor), to: Math.max(range.to, layer.anchor) };
          const over = edgeOverscan(layer, frame);
          const rect = backdropRect(layer, atAnchor, frame);
          // Equal up to the rounding of `vx - (vx + ex) / 1`.
          expect(Math.abs(rect.x0 - -over.x)).toBeLessThanOrEqual(DISTANCE_FLOOR);
          expect(Math.abs(rect.y0 - -over.y)).toBeLessThanOrEqual(DISTANCE_FLOOR);
          expect(Math.abs(rect.x1 - (frame.aspect + over.x))).toBeLessThanOrEqual(DISTANCE_FLOOR);
          expect(Math.abs(rect.y1 - (ONE + over.y))).toBeLessThanOrEqual(DISTANCE_FLOOR);
        }
      }),
    );
  });

  it('edgeOverscan is the largest shift of the layer on each axis', () => {
    fc.assert(
      fc.property(genFrame(), genLayerTable(), (frame, entries) => {
        for (const layer of resolveLayerTable(entries)) {
          const over = edgeOverscan(layer, frame);
          expect(over.x).toBe(layer.factor * TUNING.limitX * frame.aspect * frame.sceneScale);
          expect(over.y).toBe(layer.factor * TUNING.limitY * frame.sceneScale);
        }
      }),
    );
  });
});
