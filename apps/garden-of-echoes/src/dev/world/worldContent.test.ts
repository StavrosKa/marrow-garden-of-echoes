// The slice content: validation and clearance (Req 1.5, 2.8, 4.3, 11.4, 11.9; design 5.3, 8.5, 9.2).
import { checkDepthScaling, resolveLayerTable, shapeOverscanIssues, TUNING, validateTuning, type ValidationIssue } from 'world-view';
import { describe, expect, it } from 'vitest';
import { ASPECT_MIN, DEFAULT_ASPECT } from './constants';
import { dropAt, pushAt, setAt, valueAt } from './testgen';
import {
  FOREST_JSON,
  frontClearanceIssues,
  layerDefsOf,
  loadWorldContent,
  stopTravel,
  validateWorldContent,
  type ContentSegment,
  type ContentStop,
  type WorldContent,
} from './worldContent';

const ONE = 1;
const HALF = 0.5;
const FRAME = { aspect: DEFAULT_ASPECT, sceneScale: ONE };

/** Indices of the forest layers in table order (Appendix B). */
const SKY = 0;
const FAR_HILLS = 1;
const FAR_TREES = 2;
const INTERACTION = 3;
const FOG = 4;
const FOREGROUND = 5;
const JOURNEY = 0;
const DOOR = 1;
const STOP_1 = 0;
const STOP_2 = 1;

/** The messages of the issues of a JSON value, or "" when it is valid. */
function messagesOf(json: unknown): string {
  const result = validateWorldContent(json, TUNING, FRAME);
  return result.ok ? '' : result.issues.map((issue: ValidationIssue) => issue.message).join('\n');
}

/** Expects the JSON to be rejected with a message that contains `text`. */
function expectRejected(json: unknown, text: string): void {
  const result = validateWorldContent(json, TUNING, FRAME);
  expect(result.ok).toBe(false);
  const messages = messagesOf(json);
  expect(messages).toContain(text);
}

function forest(): unknown {
  return structuredClone(FOREST_JSON);
}

describe('slice content', () => {
  it('content validates', () => {
    expect(validateTuning(TUNING)).toEqual([]);
    const result = loadWorldContent(FRAME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.layers).toHaveLength(TUNING.layersMax);
    expect(result.content.stops).toHaveLength(2);
  });

  it('content rejects a key that is not known', () => {
    expectRejected({ ...(forest() as object), extra: ONE }, 'extra is not a known key');
  });

  it('content rejects a value of the wrong type', () => {
    expectRejected(setAt(forest(), ['sceneScale'], '1'), 'sceneScale = "1" must be a finite number');
  });

  it('content rejects a missing key', () => {
    expectRejected(dropAt(forest(), ['segments']), 'segments is missing');
  });

  it('content rejects a number that is not finite', () => {
    expectRejected(setAt(forest(), ['layers', FOG, 'depth'], Number.POSITIVE_INFINITY), 'layers[4].depth = null must be a finite number');
  });

  it('content rejects a colour that is not a token of the theme', () => {
    expectRejected(setAt(forest(), ['layers', SKY, 'fill', 'colour'], 'night'), 'is not a token of the theme');
  });

  it('content rejects a layer count outside layersMin..layersMax', () => {
    const extra = valueAt(forest(), ['layers', FOG]);
    expectRejected(pushAt(forest(), ['layers'], extra), `layers has ${TUNING.layersMax + ONE} entries`);
  });

  it('content rejects an id that does not follow the table order', () => {
    expectRejected(setAt(forest(), ['layers', FAR_HILLS, 'id'], 'layer-9'), 'must be "layer-1"');
  });

  it('content rejects a depth that is not below the one before (farthest first)', () => {
    expectRejected(setAt(forest(), ['layers', FAR_TREES, 'depth'], 1000), 'is not below layers[1].depth');
  });

  it('content rejects a factor that increases with depth', () => {
    expectRejected(setAt(forest(), ['layers', FAR_TREES, 'factor'], 0.01), 'is below layers[1].factor');
  });

  it('content rejects a factor outside 0..1', () => {
    expectRejected(setAt(forest(), ['layers', FAR_HILLS, 'factor'], 1.5), 'factor = 1.5 is out of range [0, 1]');
  });

  it('content rejects a factor on the interaction layer', () => {
    expectRejected(setAt(forest(), ['layers', INTERACTION, 'factor'], TUNING.interactionFactor), 'must be absent on the interaction layer');
  });

  it('content rejects a table without exactly one interaction layer', () => {
    expectRejected(setAt(forest(), ['layers', FOG, 'interaction'], true), 'needs exactly one interaction layer');
  });

  it('content rejects an interaction factor that is not below the largest other factor', () => {
    let json = setAt(forest(), ['layers', FOG, 'factor'], 0.1);
    json = setAt(json, ['layers', FOREGROUND, 'factor'], 0.15);
    expectRejected(json, 'must be below the largest factor of the other layers');
  });

  it('content rejects a layer whose depth minus anchor is not above nearPlane', () => {
    expectRejected(setAt(forest(), ['layers', FOREGROUND, 'anchor'], TUNING.foregroundDepth), 'must be above nearPlane');
  });

  it('content rejects a backdrop layer without a fill', () => {
    expectRejected(dropAt(forest(), ['layers', SKY, 'fill']), 'layers[0].fill is required on a backdrop layer');
  });

  it('content rejects a journey whose duration is outside journeyMinMs..journeyMaxMs', () => {
    expectRejected(setAt(forest(), ['segments', JOURNEY, 'durationMs'], TUNING.journeyMaxMs + ONE), 'is out of range');
  });

  it('content rejects a door whose duration is not doorMs', () => {
    expectRejected(setAt(forest(), ['segments', DOOR, 'durationMs'], TUNING.doorMs - ONE), 'must equal doorMs');
  });

  it('content rejects a segment whose from is not below to', () => {
    expectRejected(setAt(forest(), ['segments', JOURNEY, 'from'], 12), 'to = 12 must be above from = 12');
  });

  it('content rejects content without a door segment', () => {
    expectRejected(setAt(forest(), ['segments', DOOR, 'kind'], 'journey'), 'needs at least one door segment');
  });

  it('content rejects a segment that breaks the depth scaling thresholds', () => {
    // The door runs as far as the journey: its far hills move more than doorHorizonMaxMove.
    const journeyEnd = valueAt(forest(), ['segments', JOURNEY, 'to']);
    const json = setAt(forest(), ['segments', DOOR, 'to'], journeyEnd);
    expectRejected(json, 'segments[1] (forest-door)');
  });

  it('content rejects a stop whose depth minus anchor is not above nearPlane', () => {
    expectRejected(setAt(forest(), ['stops', STOP_1, 'depth'], TUNING.nearPlane), 'must be above nearPlane');
  });

  it('content rejects a slot outside the unit square', () => {
    expectRejected(setAt(forest(), ['stops', STOP_1, 'slots', 0, 'u'], 1.2), 'is outside [0, 1]');
  });

  it('content rejects a stop without more slots than targets', () => {
    expectRejected(setAt(forest(), ['stops', STOP_2, 'slots'], [{ u: HALF, v: HALF }]), 'needs more than targets');
  });

  it('content rejects a shape that reaches an edge without the overscan', () => {
    expectRejected(setAt(forest(), ['layers', FOREGROUND, 'shapes', 0, 'u0'], 0), 'must extend to');
  });

  it('content rejects a front shape that covers a candidate slot', () => {
    const fog = { kind: 'rect', u0: 0.2, v0: 0.3, u1: 0.8, v1: 0.6, colour: 'grey4' };
    expectRejected(setAt(forest(), ['layers', FOG, 'shapes'], [fog]), 'comes within hitRadiusMax');
  });
});

describe('slice content clearance', () => {
  it('front layers clear every slot at every aspect', () => {
    const result = loadWorldContent(FRAME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { content } = result;
    const aspects = [ASPECT_MIN, DEFAULT_ASPECT, TUNING.maxAspect];
    for (const aspect of aspects) {
      expect(frontClearanceIssues(content, aspect, content.sceneScale)).toEqual([]);
    }
    const slots = content.stops.reduce((sum, stop) => sum + stop.slots.length, 0);
    expect(slots).toBeGreaterThan(ONE);
  });

  it('forest content satisfies the overscan and depth thresholds', () => {
    const result = loadWorldContent(FRAME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { content } = result;
    const layers = layerDefsOf(content, TUNING);
    for (const segment of content.segments) {
      const spec: ContentSegment = segment;
      expect(checkDepthScaling(layers, spec, TUNING)).toEqual([]);
    }
    const defs = resolveLayerTable(
      content.layers.map((layer) => ({
        id: layer.id,
        depth: layer.depth,
        anchor: layer.anchor,
        backdrop: layer.backdrop,
        interaction: layer.interaction,
        factor: layer.factor,
        fill: layer.fill,
      })),
      TUNING,
    );
    content.layers.forEach((layer, i) => {
      if (layer.backdrop) return;
      const def = defs[i];
      if (def === undefined) throw new Error(`no layer at ${i}`);
      for (const shape of [...layer.shapes, ...layer.accentShapes]) {
        const bounds =
          shape.kind === 'rect'
            ? { x0: shape.u0, y0: shape.v0, x1: shape.u1, y1: shape.v1 }
            : { x0: shape.cu - shape.ru, y0: shape.cv - shape.rv, x1: shape.cu + shape.ru, y1: shape.cv + shape.rv };
        expect(shapeOverscanIssues(bounds, def, content.sceneScale, TUNING)).toEqual([]);
      }
    });
  });

  it('stop travel of segmentEnd is the segment end', () => {
    const result = loadWorldContent(FRAME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stop: ContentStop | undefined = result.content.stops[STOP_2];
    const segment: ContentSegment | undefined = result.content.segments[JOURNEY];
    if (stop === undefined || segment === undefined) throw new Error('forest content has no stop 2 or no journey');
    expect(stopTravel(stop, segment)).toBe(segment.to);
  });

  it('the shipped content has the Appendix B layer rows', () => {
    const result = loadWorldContent(FRAME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const content: WorldContent = result.content;
    expect(content.layers.map((layer) => layer.depth)).toEqual([4000, 600, 120, 24, 18, 14]);
    expect(content.layers[INTERACTION]?.interaction).toBe(true);
  });
});
