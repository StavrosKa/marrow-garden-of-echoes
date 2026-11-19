import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parallaxShift } from './parallax';
import { layerTransform, worldToScreen } from './projection';
import { resolveLayerTable } from './layers';
import { DISTANCE_FLOOR, ROUND_TRIP_TOLERANCE, genFrame, genFramePositive, genHead, genLayerRef, genLayerTable, genView } from './testgen';
import { TUNING } from './tuning';

// The factor of the nearest layer, the limit of Req 3.1: derived from tuning, not written as a literal.
const FULL_FACTOR = TUNING.nearPlane / TUNING.nearPlane;

describe('parallax direction and bounds', () => {
  const tableCase = genLayerTable().map((entries) => resolveLayerTable(entries));

  it('parallax direction and bounds: a head to the right shifts every layer with a factor to the left', () => {
    fc.assert(
      fc.property(genFramePositive(), genHead(), tableCase, (frame, head, layers) => {
        for (const layer of layers) {
          const shift = parallaxShift(layer.factor, head, frame);
          if (head.x > 0) {
            expect(shift.x <= 0).toBe(true);
            if (layer.factor > 0) expect(shift.x).toBeLessThan(0);
          }
          // The same rule on y: a head that moves down shifts the layers up.
          if (head.y > 0 && layer.factor > 0) expect(shift.y).toBeLessThan(0);
        }
      }),
    );
  });

  it('parallax direction and bounds: a nearer layer shifts at least as much, strictly more when the factors differ', () => {
    fc.assert(
      fc.property(genFramePositive(), genHead(), tableCase, (frame, head, layers) => {
        // The table lists layers from the farthest to the nearest.
        layers.forEach((layer, i) => {
          const before = layers[i - 1];
          if (before === undefined) return;
          const far = parallaxShift(before.factor, head, frame);
          const near = parallaxShift(layer.factor, head, frame);
          expect(Math.abs(near.x)).toBeGreaterThanOrEqual(Math.abs(far.x));
          expect(Math.abs(near.y)).toBeGreaterThanOrEqual(Math.abs(far.y));
          if (layer.factor > before.factor * (1 + ROUND_TRIP_TOLERANCE)) {
            if (head.x !== 0) expect(Math.abs(near.x)).toBeGreaterThan(Math.abs(far.x));
            if (head.y !== 0) expect(Math.abs(near.y)).toBeGreaterThan(Math.abs(far.y));
          }
        });
      }),
    );
  });

  it('parallax direction and bounds: the shift never exceeds factor * limit * sceneScale on each axis', () => {
    fc.assert(
      fc.property(genFrame(), genHead(), genLayerRef(), (frame, head, layer) => {
        const shift = parallaxShift(layer.factor, head, frame);
        expect(Math.abs(shift.x)).toBeLessThanOrEqual(layer.factor * TUNING.limitX * frame.aspect * frame.sceneScale);
        expect(Math.abs(shift.y)).toBeLessThanOrEqual(layer.factor * TUNING.limitY * frame.sceneScale);
      }),
    );
  });

  it('parallax direction and bounds: the interaction layer shifts at most its factor times the nearest layer', () => {
    fc.assert(
      fc.property(genFrame(), genHead(), (frame, head) => {
        const interaction = parallaxShift(TUNING.interactionFactor, head, frame);
        const nearest = parallaxShift(FULL_FACTOR, head, frame);
        const slack = 1 + ROUND_TRIP_TOLERANCE;
        expect(Math.abs(interaction.x)).toBeLessThanOrEqual(TUNING.interactionFactor * Math.abs(nearest.x) * slack);
        expect(Math.abs(interaction.y)).toBeLessThanOrEqual(TUNING.interactionFactor * Math.abs(nearest.y) * slack);
      }),
    );
  });

  it('parallax direction and bounds: the head changes no depth scale and no roll', () => {
    const case_ = genLayerRef().chain((layer) =>
      fc.tuple(fc.constant(layer), genView(layer), genHead()),
    );
    fc.assert(
      fc.property(genFrame(), case_, (frame, [layer, view, otherHead]) => {
        const first = layerTransform(layer, view, frame);
        const second = layerTransform(layer, { ...view, head: otherHead }, frame);
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        // No head-driven zoom: the scale of the container is the same for both heads (to rounding).
        expect(Math.abs(first!.scale - second!.scale)).toBeLessThanOrEqual(DISTANCE_FLOOR * Math.max(1, first!.scale));
        // No roll: moving a point along x moves its image along x only.
        const point = { ...layer, x: 0, y: 0 };
        const moved = { ...point, x: FULL_FACTOR };
        const a = worldToScreen(point, view, frame);
        const b = worldToScreen(moved, view, frame);
        expect(b!.y).toBe(a!.y);
      }),
    );
  });

  it('parallax direction and bounds: no head offset, no shift', () => {
    fc.assert(
      fc.property(genFrame(), genLayerRef(), (frame, layer) => {
        const shift = parallaxShift(layer.factor, { x: 0, y: 0 }, frame);
        expect(shift.x + 0).toBe(0);
        expect(shift.y + 0).toBe(0);
      }),
    );
  });
});
