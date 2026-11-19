import fc from 'fast-check';
import { TUNING as MARROW_TUNING } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { parallaxShift } from './parallax';
import { depthScale, isCulled, layerTransform, screenToWorld, worldToScreen } from './projection';
import { targetScreen } from './target';
import { DISTANCE_FLOOR, ROUND_TRIP_TOLERANCE, genCulledView, genFrame, genLayerRef, genSpread, genView, genWorldPoint } from './testgen';
import { TUNING } from './tuning';
import type { WorldPoint } from './types';

// The worked example of design 2.4. Its inputs are the example's own (they are not tuning
// values): the point, the view and the aspect. The factor, the limits, the near plane and the
// vanishing point are read from tuning, and the hit radius from marrow's tuning.
const EXAMPLE_ASPECT = 16 / 9;
const EXAMPLE_POINT: WorldPoint = {
  x: 4 / 3,
  y: 0.75,
  depth: 24,
  anchor: 0,
  factor: TUNING.interactionFactor,
};
const EXAMPLE_VIEW = { travel: 6, head: { x: 0.5, y: 0 } };
const EXAMPLE_FRAME = { aspect: EXAMPLE_ASPECT, sceneScale: 1 };
// The numbers the design prints, to the six places it gives (checked to 1e-6, as it says).
const PRINTED = { x: 1.476148, y: 0.85, radius: 0.12, restX: 1.333333, restY: 0.75, shiftX: -0.005333 };
const PRINTED_PRECISION = 6;
// The depth scale at the anchor, derived from tuning instead of written as a literal.
const ONE = TUNING.nearPlane / TUNING.nearPlane;

/** |a - b| <= tolerance * max(1, |a|, |b|): the relative tolerance of Req 2.6 with 1 as the floor. */
function near(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

describe('worldToScreen worked example', () => {
  it('worldToScreen worked example', () => {
    // Steps 1-10 of the table, from tuning.
    const A = EXAMPLE_ASPECT;
    const vx = A / 2;
    const vy = TUNING.vanishingPointY;
    const dz = EXAMPLE_POINT.depth - EXAMPLE_VIEW.travel;
    expect(dz).toBeGreaterThan(TUNING.nearPlane);
    const s = (EXAMPLE_POINT.depth - EXAMPLE_POINT.anchor) / dz;
    const shiftX = -EXAMPLE_VIEW.head.x * TUNING.interactionFactor * TUNING.limitX * A * EXAMPLE_FRAME.sceneScale;
    const expectedX = vx + (EXAMPLE_POINT.x - vx) * s + shiftX;
    const expectedY = vy + (EXAMPLE_POINT.y - vy) * s;

    const screen = worldToScreen(EXAMPLE_POINT, EXAMPLE_VIEW, EXAMPLE_FRAME);
    expect(screen).not.toBeNull();
    // The step-by-step value, from tuning, and the printed value of the design (1e-6).
    expect(screen?.x).toBeCloseTo(expectedX, PRINTED_PRECISION);
    expect(screen?.y).toBeCloseTo(expectedY, PRINTED_PRECISION);
    expect(screen?.x).toBeCloseTo(PRINTED.x, PRINTED_PRECISION);
    expect(screen?.y).toBeCloseTo(PRINTED.y, PRINTED_PRECISION);

    // The shift: x as printed; y is -0 in floating point and compares equal to 0 with + 0.
    const shift = parallaxShift(EXAMPLE_POINT.factor, EXAMPLE_VIEW.head, EXAMPLE_FRAME);
    expect(shift.x).toBeCloseTo(PRINTED.shiftX, PRINTED_PRECISION);
    expect(Object.is(shift.y, -0)).toBe(true);
    expect(shift.y + 0).toBe(0 + 0);

    // The depth scale is 4/3 and the hit radius is r * s.
    expect(depthScale(EXAMPLE_POINT, EXAMPLE_VIEW.travel)).toBeCloseTo((EXAMPLE_POINT.depth - EXAMPLE_POINT.anchor) / dz, PRINTED_PRECISION);
    const target = targetScreen(EXAMPLE_POINT, MARROW_TUNING.hitRadius, EXAMPLE_VIEW, EXAMPLE_FRAME);
    expect(target?.radius).toBeCloseTo(MARROW_TUNING.hitRadius * s, PRINTED_PRECISION);
    expect(target?.radius).toBeCloseTo(PRINTED.radius, PRINTED_PRECISION);
    expect(target?.position).toEqual(screen);

    // The inverse of step 10 gives the authored point back.
    const back = screenToWorld(screen!, EXAMPLE_VIEW, EXAMPLE_POINT, EXAMPLE_FRAME);
    expect(back?.x).toBeCloseTo(EXAMPLE_POINT.x, PRINTED_PRECISION);
    expect(back?.y).toBeCloseTo(EXAMPLE_POINT.y, PRINTED_PRECISION);

    // At the stop (travel at the anchor, head 0) the scale is 1 and the point is where it was authored.
    const rest = worldToScreen(EXAMPLE_POINT, { travel: EXAMPLE_POINT.anchor, head: { x: 0, y: 0 } }, EXAMPLE_FRAME);
    expect(rest?.x).toBeCloseTo(PRINTED.restX, PRINTED_PRECISION);
    expect(rest?.y).toBeCloseTo(PRINTED.restY, PRINTED_PRECISION);
  });
});

describe('projection round trip', () => {
  const layerWithView = genLayerRef().chain((layer) =>
    fc.tuple(fc.constant(layer), genView(layer), genWorldPoint(layer)),
  );

  it('projection round trip', () => {
    fc.assert(
      fc.property(genFrame(), layerWithView, (frame, [layer, view, point]) => {
        const screen = worldToScreen(point, view, frame);
        expect(screen).not.toBeNull();
        const back = screenToWorld(screen!, view, layer, frame);
        expect(back).not.toBeNull();
        expect(near(back!.x, point.x, ROUND_TRIP_TOLERANCE)).toBe(true);
        expect(near(back!.y, point.y, ROUND_TRIP_TOLERANCE)).toBe(true);
        // The inverse returns the layer it was given.
        expect(back).toMatchObject({ depth: layer.depth, anchor: layer.anchor, factor: layer.factor });
      }),
    );
  });

  it('projection round trip: worldToScreen returns null if and only if !(dz > nearPlane)', () => {
    const anyView = genLayerRef().chain((layer) =>
      fc.tuple(
        fc.constant(layer),
        fc.oneof(genView(layer), genCulledView(layer)),
        genWorldPoint(layer),
      ),
    );
    fc.assert(
      fc.property(genFrame(), anyView, (frame, [layer, view, point]) => {
        const dz = point.depth - view.travel;
        const culled = !(dz > TUNING.nearPlane);
        expect(worldToScreen(point, view, frame) === null).toBe(culled);
        expect(screenToWorld({ x: point.x, y: point.y }, view, layer, frame) === null).toBe(culled);
        expect(isCulled(point, view.travel)).toBe(culled);
      }),
    );
  });

  it('projection round trip: a point exactly at the near plane is culled', () => {
    // 24 - 23.5 is exactly 0.5 in floating point: the boundary of the cull test.
    const point: WorldPoint = { ...EXAMPLE_POINT, depth: 24 };
    const exactlyNear = { travel: point.depth - TUNING.nearPlane, head: { x: 0, y: 0 } };
    expect(point.depth - exactlyNear.travel).toBe(TUNING.nearPlane);
    expect(worldToScreen(point, exactlyNear, EXAMPLE_FRAME)).toBeNull();
    const justBefore = { travel: exactlyNear.travel - TUNING.arrivalToleranceMs, head: exactlyNear.head };
    expect(point.depth - justBefore.travel).toBeGreaterThan(TUNING.nearPlane);
    expect(worldToScreen(point, justBefore, EXAMPLE_FRAME)).not.toBeNull();
  });
});

describe('depth scale', () => {
  it('depth scale grows with travel and is 1 at the anchor', () => {
    const case_ = genLayerRef().chain((layer) =>
      fc.tuple(
        fc.constant(layer),
        genSpread(layer.anchor - layer.depth, layer.depth - TUNING.nearPlane),
        genSpread(layer.anchor - layer.depth, layer.depth - TUNING.nearPlane),
      ),
    );
    fc.assert(
      fc.property(case_, ([layer, a, b]) => {
        const [early, late] = a <= b ? [a, b] : [b, a];
        // It does not decrease as travel grows.
        expect(depthScale(layer, early)).toBeLessThanOrEqual(depthScale(layer, late));
        // It is exactly 1 at the anchor.
        expect(depthScale(layer, layer.anchor)).toBe(ONE);
        // It is above 1 after the anchor and below 1 before it, once the distance to the layer
        // has changed in floating point.
        if (layer.depth - late < layer.depth - layer.anchor) {
          expect(depthScale(layer, late)).toBeGreaterThan(ONE);
        }
        if (layer.depth - early > layer.depth - layer.anchor) {
          expect(depthScale(layer, early)).toBeLessThan(ONE);
        }
      }),
    );
  });

  it('two depths, two scales', () => {
    // The rows of Appendix B (depths of the slice layers, farthest first) at travel 6 (design 2.1):
    // every depth gets its own scale, and a nearer layer gets a larger one.
    const depths = [4000, 600, 120, 24, 18, 14];
    const travel = 6;
    const scales = depths.map((depth) => depthScale({ depth, anchor: 0, factor: 0 }, travel));
    expect(new Set(scales).size).toBe(depths.length);
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeGreaterThan(scales[i - 1]!);
  });

  it('two depths, two scales: a nearer layer never gets a smaller scale', () => {
    const case_ = genLayerRef().chain((layer) =>
      fc.record({
        layer: fc.constant(layer),
        gap: genSpread(0, layer.depth),
        travel: genSpread(layer.anchor, layer.depth - TUNING.nearPlane),
      }),
    );
    fc.assert(
      fc.property(case_, ({ layer, gap, travel }) => {
        const farther = { ...layer, depth: layer.depth + gap };
        expect(depthScale(layer, travel)).toBeGreaterThanOrEqual(depthScale(farther, travel));
      }),
    );
  });
});

describe('layerTransform', () => {
  it('layerTransform agrees with worldToScreen', () => {
    const case_ = genLayerRef().chain((layer) =>
      fc.tuple(fc.constant(layer), genView(layer), genWorldPoint(layer)),
    );
    fc.assert(
      fc.property(genFrame(), case_, (frame, [layer, view, point]) => {
        const transform = layerTransform(layer, view, frame);
        const screen = worldToScreen(point, view, frame);
        expect(transform).not.toBeNull();
        expect(screen).not.toBeNull();
        // 1e-12, relative with 1 as the floor: the container maps (x, y) to offset + scale * (x, y).
        expect(near(transform!.offset.x + transform!.scale * point.x, screen!.x, DISTANCE_FLOOR)).toBe(true);
        expect(near(transform!.offset.y + transform!.scale * point.y, screen!.y, DISTANCE_FLOOR)).toBe(true);
        expect(near(transform!.scale, depthScale(layer, view.travel), DISTANCE_FLOOR)).toBe(true);
      }),
    );
  });

  it('layerTransform agrees with worldToScreen: null when the layer is culled', () => {
    const case_ = genLayerRef().chain((layer) => fc.tuple(fc.constant(layer), genCulledView(layer)));
    fc.assert(
      fc.property(genFrame(), case_, (frame, [layer, view]) => {
        expect(layerTransform(layer, view, frame)).toBeNull();
      }),
    );
  });
});
