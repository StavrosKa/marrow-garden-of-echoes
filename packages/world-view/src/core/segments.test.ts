import { describe, expect, it } from 'vitest';
import { resolveLayerTable, type LayerTableEntry } from './layers';
import { depthScale } from './projection';
import { checkDepthScaling, validateSegment, type SegmentSpec } from './segments';
import { TUNING } from './tuning';

// The TABLE layer depths of Appendix B (anchor 0), farthest first, and the two slice segments
// (app values of Appendix B): the journey 0 -> 12, and the door 0 -> 4. The factors are not read here.
const DEPTHS = [4000, 600, 120, 24, 18, 14];
const TABLE: LayerTableEntry[] = DEPTHS.map((depth, i) => ({
  id: `layer-${i}`,
  depth,
  anchor: 0,
  backdrop: i < 2,
  ...(i === 3 ? { interaction: true } : { factor: 0 }),
}));
const LAYERS = resolveLayerTable(TABLE);
const HILLS = 1;
const FOREGROUND = 5;
const JOURNEY_TO = 12;
const DOOR_TO = 4;
const JOURNEY: SegmentSpec = {
  id: 'segment-journey',
  kind: 'journey',
  from: 0,
  to: JOURNEY_TO,
  durationMs: (TUNING.journeyMinMs + TUNING.journeyMaxMs) / 2,
};
const DOOR: SegmentSpec = { id: 'segment-door', kind: 'door', from: 0, to: DOOR_TO, durationMs: TUNING.doorMs };

/** The farthest a point of the viewport can be from the vanishing point at the widest aspect. */
const REACH = Math.hypot(TUNING.maxAspect / 2, Math.max(TUNING.vanishingPointY, 1 - TUNING.vanishingPointY));
const HALF = 0.5;

/**
 * The move of a viewport point of a layer over a segment, by the check of Req 2.8: a point at the
 * start is at most REACH / start from the vanishing point, so its move is REACH * (end - start) / start.
 */
function move(depth: number, spec: SegmentSpec, anchor = 0): number {
  const start = (depth - anchor) / (depth - spec.from);
  const end = (depth - anchor) / (depth - spec.to);
  return (REACH * (end - start)) / start;
}

describe('depth scaling thresholds for the journey and door segments', () => {
  it('depth scaling thresholds for the journey and door segments: the shipped numbers pass', () => {
    expect(checkDepthScaling(LAYERS, JOURNEY)).toEqual([]);
    expect(checkDepthScaling(LAYERS, DOOR)).toEqual([]);
    // The hand check of Appendix B: the far hills move less than the threshold, the foreground grows more.
    expect(move(DEPTHS[HILLS]!, JOURNEY)).toBeLessThan(TUNING.journeyHorizonMaxMove);
    expect(move(DEPTHS[HILLS]!, DOOR)).toBeLessThan(TUNING.doorHorizonMaxMove);
    const growth = (spec: SegmentSpec): number => DEPTHS[FOREGROUND]! / (DEPTHS[FOREGROUND]! - spec.to);
    expect(growth(JOURNEY)).toBeGreaterThanOrEqual(TUNING.journeyForegroundMinGrowth);
    expect(growth(DOOR)).toBeGreaterThanOrEqual(TUNING.doorForegroundMinGrowth);
  });

  it('depth scaling thresholds for the journey and door segments: each kind has its own thresholds', () => {
    // The journey's numbers on a door segment: the far hills move more than the door allows.
    const longDoor: SegmentSpec = { ...DOOR, to: JOURNEY_TO };
    const hillsIssue = checkDepthScaling(LAYERS, longDoor).find((issue) => issue.path === `layers[${HILLS}].depth`);
    expect(hillsIssue?.message).toContain(`it must stay below ${TUNING.doorHorizonMaxMove}`);
    expect(move(DEPTHS[HILLS]!, longDoor)).toBeGreaterThanOrEqual(TUNING.doorHorizonMaxMove);
    // The door's numbers on a journey segment: the foreground grows less than the journey needs.
    const shortJourney: SegmentSpec = { ...JOURNEY, to: DOOR_TO };
    const frontIssue = checkDepthScaling(LAYERS, shortJourney).find((issue) => issue.path === `layers[${FOREGROUND}].depth`);
    expect(frontIssue?.message).toContain(`it must grow by at least ${TUNING.journeyForegroundMinGrowth}`);
    // The same short segment is fine as a door.
    expect(checkDepthScaling(LAYERS, { ...shortJourney, kind: 'door' })).toEqual([]);
  });

  it('depth scaling thresholds for the journey and door segments: a horizon layer that moves too much is reported', () => {
    const twiceAsFar: SegmentSpec = { ...JOURNEY, to: JOURNEY_TO + JOURNEY_TO };
    const issues = checkDepthScaling(LAYERS, twiceAsFar);
    expect(issues.map((issue) => issue.path)).toContain(`layers[${HILLS}].depth`);
    expect(move(DEPTHS[HILLS]!, twiceAsFar)).toBeGreaterThanOrEqual(TUNING.journeyHorizonMaxMove);
    // The sky (depth 4000) still moves less than the threshold there.
    expect(issues.map((issue) => issue.path)).not.toContain('layers[0].depth');
  });

  it('depth scaling thresholds for the journey and door segments: a horizon layer anchored above the segment start is rejected', () => {
    // A horizon layer anchored halfway to its depth has a start scale of 0.5 (below 1). A viewport
    // point at the start is then twice as far from the vanishing point in layer units, so the
    // move is twice what the scale change alone gives. The old formula, reach * |end - start|,
    // passes this layer; the check of Req 2.8 must reject it.
    const depth = TUNING.horizonDepth;
    const anchor = depth * HALF;
    const layers = resolveLayerTable([{ id: 'layer-0', depth, anchor, backdrop: true, factor: 0 }]);
    const start = depthScale({ depth, anchor, factor: 0 }, JOURNEY.from);
    const end = depthScale({ depth, anchor, factor: 0 }, JOURNEY.to);
    expect(start).toBeLessThan(1);
    expect(REACH * Math.abs(end - start)).toBeLessThan(TUNING.journeyHorizonMaxMove);
    expect(move(depth, JOURNEY, anchor)).toBeGreaterThanOrEqual(TUNING.journeyHorizonMaxMove);
    const issues = checkDepthScaling(layers, JOURNEY);
    expect(issues.map((issue) => issue.path)).toEqual(['layers[0].depth']);
    expect(issues[0]?.message).toContain(`it must stay below ${TUNING.journeyHorizonMaxMove}`);
  });

  it('depth scaling thresholds for the journey and door segments: thresholds and depths come from tuning', () => {
    const strict = { ...TUNING, journeyHorizonMaxMove: move(DEPTHS[HILLS]!, JOURNEY) };
    expect(checkDepthScaling(LAYERS, JOURNEY, strict).map((issue) => issue.path)).toEqual([`layers[${HILLS}].depth`]);
    const demanding = { ...TUNING, journeyForegroundMinGrowth: DEPTHS[FOREGROUND]! / (DEPTHS[FOREGROUND]! - JOURNEY_TO) + TUNING.limitY };
    expect(checkDepthScaling(LAYERS, JOURNEY, demanding).map((issue) => issue.path)).toEqual([`layers[${FOREGROUND}].depth`]);
    // A layer between the two depths is not checked (far trees at 120, the interaction layer at 24, fog at 18).
    const inBetween = checkDepthScaling(LAYERS, { ...JOURNEY, to: JOURNEY_TO + JOURNEY_TO }, { ...TUNING, journeyForegroundMinGrowth: TUNING.journeyForegroundMinGrowth * TUNING.journeyForegroundMinGrowth });
    expect(inBetween.map((issue) => issue.path)).not.toContain('layers[2].depth');
    expect(inBetween.map((issue) => issue.path)).not.toContain('layers[3].depth');
  });
});

describe('segment rules', () => {
  it('segment rules: the shipped segments pass', () => {
    expect(validateSegment(JOURNEY)).toEqual([]);
    expect(validateSegment(DOOR)).toEqual([]);
  });

  it('segment rules: a journey lasts journeyMinMs..journeyMaxMs, ends included', () => {
    expect(validateSegment({ ...JOURNEY, durationMs: TUNING.journeyMinMs })).toEqual([]);
    expect(validateSegment({ ...JOURNEY, durationMs: TUNING.journeyMaxMs })).toEqual([]);
    for (const durationMs of [TUNING.journeyMinMs - TUNING.nearPlane, TUNING.journeyMaxMs + TUNING.nearPlane]) {
      const issues = validateSegment({ ...JOURNEY, durationMs });
      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toBe(
        `durationMs = ${durationMs} is out of range [${TUNING.journeyMinMs}, ${TUNING.journeyMaxMs}] for a journey`,
      );
    }
  });

  it('segment rules: a door lasts exactly doorMs', () => {
    for (const durationMs of [TUNING.doorMs - TUNING.nearPlane, TUNING.doorMs + TUNING.nearPlane]) {
      const issues = validateSegment({ ...DOOR, durationMs });
      expect(issues.map((issue) => issue.path)).toEqual(['durationMs']);
      expect(issues[0]?.message).toBe(`durationMs = ${durationMs} must equal doorMs = ${TUNING.doorMs} for a door`);
    }
  });

  it('segment rules: from must be below to, and both finite', () => {
    expect(validateSegment({ ...JOURNEY, to: JOURNEY.from }).map((issue) => issue.path)).toEqual(['to']);
    expect(validateSegment({ ...JOURNEY, to: JOURNEY.from - TUNING.nearPlane }).map((issue) => issue.path)).toEqual(['to']);
    expect(validateSegment({ ...JOURNEY, from: NaN }).map((issue) => issue.path)).toEqual(['from']);
    expect(validateSegment({ ...JOURNEY, to: Infinity }).map((issue) => issue.path)).toEqual(['to']);
  });

  it('segment rules: the kind must be a journey or a door', () => {
    const issues = validateSegment({ ...JOURNEY, kind: 'path' as SegmentSpec['kind'] });
    expect(issues.map((issue) => issue.path)).toEqual(['kind']);
  });
});
