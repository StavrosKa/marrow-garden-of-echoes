import fc from 'fast-check';
import { TUNING as MARROW_TUNING, isSlotUsable, placeTargets, type Vec2 } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { parallaxMargin, parallaxShift } from './parallax';
import { screenToWorld } from './projection';
import { targetScreen } from './target';
import {
  ASPECT_MIN,
  DISTANCE_FLOOR,
  ROUND_TRIP_TOLERANCE,
  genDemand,
  genFrame,
  genGrids,
  genHead,
  genLayerRef,
  genMapping,
  genSpread,
} from './testgen';
import { TUNING } from './tuning';
import type { ProjectionFrame } from './types';

// The aspect of the example of design 2.3: 16/9 (a test parameter of that example).
const EXAMPLE_ASPECT = 16 / 9;
// The scene scale of the example: the scale of a full scene, derived from tuning.
const FULL_SCALE = TUNING.nearPlane / TUNING.nearPlane;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** One placement case: a frame, grids, a mapping for the frame's aspect, a demand with the margin of the frame, and heads. */
const placementCase = genFrame().chain((frame) =>
  fc.record({
    frame: fc.constant(frame),
    grids: genGrids(),
    mapping: genMapping(frame.aspect),
    demand: genDemand(frame.aspect, parallaxMargin(frame.sceneScale, frame.aspect)),
    // The interaction layer of a stop: its anchor is the stop, its factor is the interaction factor.
    stop: genLayerRef().map((layer) => ({ ...layer, factor: TUNING.interactionFactor })),
    heads: fc.array(genHead(), { minLength: 1, maxLength: 6 }),
  }),
);

describe('hit area inside reachable region for all head offsets', () => {
  it('hit area inside reachable region for all head offsets', () => {
    let checkedSlots = 0;
    fc.assert(
      fc.property(placementCase, ({ frame, grids, mapping, demand, stop, heads }) => {
        const { r, m } = demand;
        const placed = placeTargets(demand, grids, mapping, MARROW_TUNING);
        if (placed.kind === 'none') return;
        const restView = { travel: stop.anchor, head: { x: 0, y: 0 } };
        for (const slot of placed.slots) {
          // The slot is usable for r and m: the hit area is inside the reachable region.
          expect(isSlotUsable(slot, grids, mapping, r, m, MARROW_TUNING)).not.toBeNull();
          const world = screenToWorld(slot, restView, stop, frame);
          expect(world).not.toBeNull();
          for (const head of heads) {
            const target = targetScreen(world!, r, { travel: stop.anchor, head }, frame);
            expect(target).not.toBeNull();
            // The depth scale at the stop is 1, so the hit radius is r.
            expect(target!.radius).toBe(r);
            // The centre is at most m from its slot, and the hit area is inside the circle r + m around it.
            expect(dist(target!.position, slot)).toBeLessThanOrEqual(m * (1 + DISTANCE_FLOOR) + DISTANCE_FLOOR);
            expect(dist(target!.position, slot) + target!.radius).toBeLessThanOrEqual(r + m + DISTANCE_FLOOR);
          }
          checkedSlots += 1;
        }
      }),
    );
    // The generators reach placements that are not 'none', so the assertions above ran.
    expect(checkedSlots).toBeGreaterThan(0);
  });

  it('hit area inside reachable region for all head offsets: the corner of the head square reaches the margin', () => {
    // The margin is attained at the corners (1, 1), so a margin from the larger axis alone would fail it.
    fc.assert(
      fc.property(genFrame(), genLayerRef(), (frame, layer) => {
        const stop = { ...layer, factor: TUNING.interactionFactor };
        const slot = { x: frame.aspect / 2, y: TUNING.vanishingPointY };
        const world = screenToWorld(slot, { travel: stop.anchor, head: { x: 0, y: 0 } }, stop, frame)!;
        const corner = { x: FULL_SCALE, y: FULL_SCALE };
        const target = targetScreen(world, MARROW_TUNING.hitRadius, { travel: stop.anchor, head: corner }, frame)!;
        const margin = parallaxMargin(frame.sceneScale, frame.aspect);
        expect(Math.abs(dist(target.position, slot) - margin)).toBeLessThanOrEqual(DISTANCE_FLOOR);
      }),
    );
  });
});

describe('parallaxMargin is the Euclidean length', () => {
  it('parallaxMargin is the Euclidean length', () => {
    const frame: ProjectionFrame = { aspect: EXAMPLE_ASPECT, sceneScale: FULL_SCALE };
    const x = TUNING.interactionFactor * TUNING.limitX * frame.aspect;
    const y = TUNING.interactionFactor * TUNING.limitY;
    const margin = parallaxMargin(frame.sceneScale, frame.aspect);
    // The value of design 2.3 for (1, 16/9), computed from tuning.
    expect(margin).toBeCloseTo(Math.sqrt(x * x + y * y), 12);
    // A max of the two axes is smaller, and a sum is larger: both are different from the margin.
    expect(Math.abs(margin - Math.max(x, y))).toBeGreaterThan(DISTANCE_FLOOR);
    expect(Math.abs(margin - (x + y))).toBeGreaterThan(DISTANCE_FLOOR);
    expect(margin).toBeGreaterThan(Math.max(x, y));
    expect(margin).toBeLessThan(x + y);
  });

  it('parallaxMargin is the Euclidean length: it is the largest displacement of the interaction layer', () => {
    fc.assert(
      fc.property(genFrame(), genHead(), (frame, head) => {
        const margin = parallaxMargin(frame.sceneScale, frame.aspect);
        const shift = parallaxShift(TUNING.interactionFactor, head, frame);
        expect(Math.hypot(shift.x, shift.y)).toBeLessThanOrEqual(margin * (1 + ROUND_TRIP_TOLERANCE) + DISTANCE_FLOOR);
      }),
    );
  });

  it('parallaxMargin is the Euclidean length: it scales with the scene scale and is 0 at 0', () => {
    fc.assert(
      fc.property(genSpread(ASPECT_MIN, TUNING.maxAspect), genSpread(0, FULL_SCALE), (aspect, scale) => {
        const full = parallaxMargin(FULL_SCALE, aspect);
        expect(Math.abs(parallaxMargin(scale, aspect) - scale * full)).toBeLessThanOrEqual(DISTANCE_FLOOR);
        expect(parallaxMargin(scale - scale, aspect)).toBe(scale - scale);
      }),
    );
  });
});
