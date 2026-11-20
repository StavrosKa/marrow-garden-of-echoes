// Placement of the stops with marrow's placeTargets (Req 9.3, 9.6, 12.1, 12.2, 14.2; design 8.3, 9.2).
import { createGrid, TUNING as MARROW_TUNING, type CalibrationResult } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { targetScreen, TUNING, worldToScreen, type ProjectionFrame, type View } from 'world-view';
import { DEFAULT_ASPECT } from './constants';
import { cameraComfort, mouseComfort, placeStops } from './placementSetup';
import { loadWorldContent, type ContentSegment, type WorldContent } from './worldContent';

const ZERO = 0;
const ONE = 1;
const HALF = 0.5;
const PROJECTION_DIGITS = 9;
const FRAME: ProjectionFrame = { aspect: DEFAULT_ASPECT, sceneScale: ONE };
const R = MARROW_TUNING.hitRadius;
/** A slot far outside the play area: no usable slot at this u (a test value). */
const OUTSIDE_U = 10;

function forest(): { content: WorldContent; segment: ContentSegment } {
  const loaded = loadWorldContent(FRAME);
  if (!loaded.ok) throw new Error('the forest content is invalid');
  const segment = loaded.content.segments.find((item) => item.kind === 'journey');
  if (segment === undefined) throw new Error('no journey segment');
  return { content: loaded.content, segment };
}

/** The content with the stop at `index` replaced; the rest of the content is the forest's. */
function withStop(content: WorldContent, index: number, change: Partial<WorldContent['stops'][number]>): WorldContent {
  return {
    ...content,
    stops: content.stops.map((stop, i) => (i === index ? { ...stop, ...change } : stop)),
  };
}

describe('placement of the stops', () => {
  it('12.1 12.2: placement of both stops', () => {
    const { content, segment } = forest();
    const comfort = mouseComfort(FRAME.aspect, R);
    const placed = placeStops(content, segment, FRAME, comfort.grids, comfort.mapping, R, TUNING);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const [stopOne, stopTwo] = placed.stops;
    expect(stopOne?.kind).toBe('simultaneous');
    expect(stopOne?.targets).toHaveLength(content.stops[ZERO]?.targets ?? ZERO);
    expect(stopTwo?.targets).toHaveLength(content.stops[ONE]?.targets ?? ZERO);
    for (const stop of placed.stops) {
      const contentStop = content.stops.find((item) => item.id === stop.id);
      if (contentStop === undefined) throw new Error(`no content for ${stop.id}`);
      const restView: View = { travel: stop.travel, head: { x: ZERO, y: ZERO } };
      for (const [k, target] of stop.targets.entries()) {
        // The world point projects back to the slot it was placed on, at the rest view.
        const slot = stop.slots[k];
        if (slot === undefined) throw new Error('a target has no slot');
        const back = worldToScreen(target.point, restView, FRAME, TUNING);
        expect(back?.x).toBeCloseTo(slot.x, PROJECTION_DIGITS);
        expect(back?.y).toBeCloseTo(slot.y, PROJECTION_DIGITS);
        // The slot is one of the content's slots, in screen space.
        expect(contentStop.slots.some((item) => item.u * FRAME.aspect === slot.x && item.v === slot.y)).toBe(true);
        // The hit radius at the stop is r, because the depth scale there is 1.
        const placedScreen = targetScreen(target.point, target.r, restView, FRAME, TUNING);
        expect(placedScreen?.radius).toBe(R);
        expect(placedScreen?.scale).toBe(ONE);
      }
    }
  });

  it('9.3 9.6: each target projects back to its slot at the rest view, with the hit radius r', () => {
    const { content, segment } = forest();
    const comfort = mouseComfort(FRAME.aspect, R);
    const placed = placeStops(content, segment, FRAME, comfort.grids, comfort.mapping, R, TUNING);
    if (!placed.ok) throw new Error('placement did not start');
    for (const stop of placed.stops) {
      const restView: View = { travel: stop.travel, head: { x: ZERO, y: ZERO } };
      for (const [k, target] of stop.targets.entries()) {
        const slot = stop.slots[k];
        if (slot === undefined) throw new Error('a target has no slot');
        const back = worldToScreen(target.point, restView, FRAME, TUNING);
        expect(back?.x).toBeCloseTo(slot.x, PROJECTION_DIGITS);
        expect(back?.y).toBeCloseTo(slot.y, PROJECTION_DIGITS);
        // The depth scale at the stop is exactly 1, so the hit circle has radius r.
        expect(targetScreen(target.point, target.r, restView, FRAME, TUNING)?.radius).toBe(R);
      }
    }
  });

  it('12.2: a notice when stop 1 is not simultaneous', () => {
    const { content, segment } = forest();
    const crowded = withStop(content, ZERO, {
      slots: [
        { u: HALF, v: HALF },
        { u: HALF, v: HALF },
        { u: HALF, v: HALF },
      ],
    });
    const comfort = mouseComfort(FRAME.aspect, R);
    const placed = placeStops(crowded, segment, FRAME, comfort.grids, comfort.mapping, R, TUNING);
    expect(placed).toEqual({ ok: false, notice: 'placementNotSimultaneous' });
  });

  it('12.2: a notice when stop 1 has no usable slot', () => {
    const { content, segment } = forest();
    const empty: CalibrationResult['grids'] = { right: createGrid(MARROW_TUNING) };
    const comfort = cameraComfort(FRAME.aspect, FRAME.aspect);
    const placed = placeStops(content, segment, FRAME, empty, comfort.mapping, R, TUNING);
    // Stop 1 must place simultaneously, so a result of none gives the same notice as any other result.
    expect(placed).toEqual({ ok: false, notice: 'placementNotSimultaneous' });
  });

  it('12.2: a notice when stop 2 has no usable slot', () => {
    const { content, segment } = forest();
    const outside = withStop(content, ONE, { slots: [{ u: OUTSIDE_U, v: HALF }, { u: OUTSIDE_U, v: HALF + HALF * HALF }] });
    const comfort = mouseComfort(FRAME.aspect, R);
    const placed = placeStops(outside, segment, FRAME, comfort.grids, comfort.mapping, R, TUNING);
    expect(placed).toEqual({ ok: false, notice: 'placementNone' });
  });

  it('12.2: no grid is enlarged', () => {
    const { content, segment } = forest();
    const comfort = mouseComfort(FRAME.aspect, R);
    const before = structuredClone(comfort.grids);
    placeStops(content, segment, FRAME, comfort.grids, comfort.mapping, R, TUNING);
    expect(comfort.grids).toEqual(before);
  });

  it('12.1 14.2: camera comfort is the whole frame at reach gain 1', () => {
    const { content, segment } = forest();
    const comfort = cameraComfort(FRAME.aspect, FRAME.aspect);
    // The comfort centre is the centre of the play area, and the mapping leaves it in place.
    const centre = comfort.mapping.toScreen({ x: HALF, y: HALF });
    expect(centre.x).toBeCloseTo(FRAME.aspect * HALF, PROJECTION_DIGITS);
    expect(centre.y).toBeCloseTo(HALF, PROJECTION_DIGITS);
    const placed = placeStops(content, segment, FRAME, comfort.grids, comfort.mapping, R, TUNING);
    expect(placed.ok).toBe(true);
  });
});
