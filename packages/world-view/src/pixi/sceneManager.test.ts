// The Scene Manager with fake ports (Req 10; design 7.2-7.4, 9.2). No test loads PixiJS.
import type { Vec2 } from 'marrow/core';
import { TUNING as MARROW_TUNING } from 'marrow/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backdropRect } from '../core/overscan';
import { worldToScreen } from '../core/projection';
import { TUNING } from '../core/tuning';
import type { ProjectionFrame, View, WorldPoint } from '../core/types';
import { createFakePorts, FakeHost, type FakePorts } from './fakes';
import { createSceneManager } from './sceneManager';
import { DRAW_UNIT } from './shapes';
import type { FrameData, HitCircle, SceneLayerSpec, SceneManager, SceneManagerOptions, SceneTarget } from './types';

const ZERO = 0;
const ONE = 1;
const HALF = 0.5;
const TWO = 2;
const THREE = 3;

/** Colours of the fixed scene. Any numbers will do; they only have to be told apart in the drawing calls. */
const SKY = 0x111111;
const HILLS = 0x222222;
const PATH = 0x333333;
const FOG = 0x444444;
const TARGET = 0x555555;
const COVER = 0x000000;

/** The sceneScale of the fixed scene (a test parameter). */
const SCENE_SCALE = HALF;
/** The host size of the fixed scene: 800 x 400 CSS pixels, aspect 2. */
const HOST_WIDTH = 800;
const HOST_HEIGHT = 400;

/** The layers of the fixed scene, farthest first (Req 2.10). The interaction layer carries the path and the target. */
function layers(): SceneLayerSpec[] {
  return [
    {
      id: 'layer-0',
      depth: TUNING.horizonDepth,
      anchor: ZERO,
      factor: ZERO,
      backdrop: true,
      interaction: false,
      fill: SKY,
      shapes: [],
    },
    {
      id: 'layer-1',
      depth: TUNING.horizonDepth * HALF,
      anchor: ZERO,
      factor: TUNING.interactionFactor * HALF,
      backdrop: true,
      interaction: false,
      fill: HILLS,
      shapes: [{ kind: 'ellipse', bounds: { x0: 0.2, y0: 0.6, x1: 0.8, y1: 1 }, colour: HILLS }],
    },
    {
      id: 'layer-2',
      depth: TUNING.foregroundDepth * TWO,
      anchor: ZERO,
      factor: TUNING.interactionFactor,
      backdrop: false,
      interaction: true,
      shapes: [
        { kind: 'rect', bounds: { x0: 0.1, y0: 0.7, x1: 0.4, y1: 0.8 }, colour: PATH },
        { kind: 'roundRect', bounds: { x0: 0.5, y0: 0.7, x1: 0.6, y1: 0.8 }, colour: PATH, accent: true },
      ],
    },
    {
      id: 'layer-3',
      depth: TUNING.foregroundDepth,
      anchor: ZERO,
      factor: ONE,
      backdrop: false,
      interaction: false,
      shapes: [{ kind: 'rect', bounds: { x0: 0, y0: 0.8, x1: 0.1, y1: 1 }, colour: FOG }],
    },
  ];
}

/** The one target: a point at the middle of the interaction layer, with marrow's shipped hit radius. */
function targets(): SceneTarget[] {
  const layer = layers().find((spec) => spec.interaction === true);
  if (layer === undefined) throw new Error('the fixed scene has no interaction layer');
  const point: WorldPoint = { depth: layer.depth, anchor: layer.anchor, factor: layer.factor, x: HALF, y: HALF };
  return [{ id: 'stop', point, r: MARROW_TUNING.hitRadius, colour: TARGET }];
}

/** The frame data for a travel and an interaction head. The decorative view has no head. */
function frameData(travel: number, head: Vec2, extra: Partial<FrameData> = {}): FrameData {
  return {
    view: { travel, head: { x: ZERO, y: ZERO } },
    interactionView: { travel, head },
    interactionHead: head,
    decorativeHead: { x: ZERO, y: ZERO },
    cover: ZERO,
    accentAlpha: ZERO,
    travelling: false,
    active: new Set(['stop']),
    shown: new Set(['stop']),
    ...extra,
  };
}

interface Fixture {
  readonly manager: SceneManager;
  readonly fake: FakePorts;
  readonly host: FakeHost;
  /** The delta of every getFrame call, and the number of calls. */
  readonly dts: number[];
  /** The frame data that getFrame returns next. */
  current: FrameData;
  /** The hit circles that onFrame received, one list per rendered frame. */
  readonly circles: HitCircle[][];
}

/** A manager on fakes with a fixed host size. The frame data is set by the test through `current`. */
function fixture(devicePixelRatio: number, visualRatio?: number): Fixture {
  const fake = createFakePorts(devicePixelRatio);
  const host = new FakeHost(HOST_WIDTH, HOST_HEIGHT);
  const dts: number[] = [];
  const circles: HitCircle[][] = [];
  const state: { current: FrameData } = { current: frameData(ZERO, { x: ZERO, y: ZERO }) };
  const options: SceneManagerOptions = {
    host,
    layers: layers(),
    targets: targets(),
    sceneScale: SCENE_SCALE,
    travelRange: { from: ZERO, to: ONE },
    coverColour: COVER,
    targetVisualRatio: visualRatio,
    getFrame: (dtMs: number): FrameData => {
      dts.push(dtMs);
      return state.current;
    },
    onFrame: (frameCircles) => {
      circles.push(frameCircles.map((c) => ({ ...c, centre: { ...c.centre } })));
    },
  };
  const manager = createSceneManager(options, fake.ports);
  return {
    manager,
    fake,
    host,
    dts,
    circles,
    get current() {
      return state.current;
    },
    set current(value: FrameData) {
      state.current = value;
    },
  };
}

/** Starts a fixture and runs its first frame, so the loop has a request outstanding. */
async function started(s: Fixture): Promise<void> {
  await s.manager.start();
  s.fake.frames.fire(ZERO);
}

/** The number of path clears over every Graphics of the scene. A redraw clears each layer's and the cover's Graphics. */
function totalClears(s: Fixture): number {
  return s.fake.graphics.reduce((sum, graphics) => sum + graphics.clears, ZERO);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scene manager', () => {
  it('scene manager dispose leaves no frame request, listener or application', async () => {
    const s = fixture(ONE);
    await started(s);
    s.fake.frames.fire(ONE);
    s.fake.frames.fire(TWO);
    expect(s.fake.frames.pending.size).toBe(ONE);
    expect(s.fake.observers.connected).toBe(ONE);

    // The callback of the outstanding request, kept to call it after dispose.
    const stale = [...s.fake.frames.pending.values()][ZERO];
    expect(stale).toBeDefined();
    const framesBefore = s.dts.length;

    s.manager.dispose();
    expect(s.fake.frames.pending.size).toBe(ZERO);
    expect(s.fake.observers.connected).toBe(ZERO);
    const app = s.fake.applications[ZERO];
    expect(app?.destroyCalls).toEqual([{ rendererOptions: { removeView: true }, options: { children: true } }]);

    stale?.(TWO * TWO);
    expect(s.dts).toHaveLength(framesBefore);
    expect(s.fake.frames.pending.size).toBe(ZERO);

    s.manager.dispose();
    expect(app?.destroyCalls).toHaveLength(ONE);
  });

  it('scene manager dispose leaves no frame request, listener or application: dispose during init', async () => {
    const s = fixture(ONE);
    s.fake.holdInits = true;
    const starting = s.manager.start();
    s.manager.dispose();
    const app = s.fake.applications[ZERO];
    expect(app?.destroyCalls).toHaveLength(ZERO);
    app?.releaseInit();
    await starting;
    expect(app?.destroyCalls).toEqual([{ rendererOptions: { removeView: true }, options: { children: true } }]);
    expect(s.fake.frames.pending.size).toBe(ZERO);
    expect(s.fake.observers.connected).toBe(ZERO);
    s.manager.dispose();
    expect(app?.destroyCalls).toHaveLength(ONE);
  });

  it('scene manager applies layer transforms through worldToScreen', async () => {
    const s = fixture(ONE);
    await started(s);
    s.current = frameData(ONE, { x: HALF, y: -HALF });
    s.fake.frames.fire(ONE);

    const frame: ProjectionFrame = s.manager.projectionFrame();
    const debug = s.manager.debugLayers();
    const spec = layers();
    expect(debug).toHaveLength(spec.length);
    spec.forEach((layer, i) => {
      const entry = debug[i];
      expect(entry?.id).toBe(layer.id);
      const view: View = layer.interaction === true ? s.current.interactionView : s.current.view;
      const origin = worldToScreen({ ...layer, x: ZERO, y: ZERO }, view, frame);
      const unit = worldToScreen({ ...layer, x: ONE, y: ZERO }, view, frame);
      if (origin === null || unit === null) {
        expect(entry?.visible).toBe(false);
        return;
      }
      expect(entry?.visible).toBe(true);
      expect(entry?.x).toBe(origin.x);
      expect(entry?.y).toBe(origin.y);
      expect(entry?.scale).toBe(unit.x - origin.x);
    });
    s.manager.dispose();
  });

  it('scene manager draws each backdrop at least as large as backdropRect', async () => {
    const s = fixture(ONE);
    await started(s);
    s.current = frameData(ONE, { x: ZERO, y: ZERO });
    s.fake.frames.fire(ONE);

    const frame = s.manager.projectionFrame();
    const range = { from: ZERO, to: ONE };
    const backdrops = layers().filter((layer) => layer.backdrop);
    // Graphics are created layer by layer, base then accent, so the base of backdrop i is at 2 * i.
    backdrops.forEach((layer, i) => {
      const base = s.fake.graphics[i * TWO];
      const rect = base?.calls.find((call) => call.op === 'rect');
      expect(rect).toBeDefined();
      const expected = backdropRect(layer, range, frame);
      const [x = NaN, y = NaN, width = NaN, height = NaN] = rect?.args ?? [];
      expect(x / DRAW_UNIT).toBeLessThanOrEqual(expected.x0);
      expect(y / DRAW_UNIT).toBeLessThanOrEqual(expected.y0);
      expect((x + width) / DRAW_UNIT).toBeGreaterThanOrEqual(expected.x1);
      expect((y + height) / DRAW_UNIT).toBeGreaterThanOrEqual(expected.y1);
    });
    s.manager.dispose();
  });

  it('scene manager hides a culled layer', async () => {
    const s = fixture(ONE);
    await started(s);
    // The foreground layer is culled at this travel: its depth minus the travel is not above nearPlane.
    const fog = layers().find((layer) => !layer.backdrop && layer.interaction !== true);
    if (fog === undefined) throw new Error('no foreground layer');
    s.current = frameData(fog.depth - TUNING.nearPlane, { x: ZERO, y: ZERO });
    s.fake.frames.fire(ONE);
    const entry = s.manager.debugLayers().find((e) => e.id === fog.id);
    expect(entry?.visible).toBe(false);
    s.manager.dispose();
  });

  it('scene manager passes the raw frame delta and reads no clock', async () => {
    const dateNow = vi.spyOn(Date, 'now');
    const perfNow = vi.spyOn(performance, 'now');
    const s = fixture(ONE);
    await started(s);
    // A step longer than maxClockStepMs: the scene manager passes it unclamped.
    const longStepMs = MARROW_TUNING.maxClockStepMs * TWO + ONE;
    s.fake.frames.fire(ONE);
    s.fake.frames.fire(ONE + longStepMs);
    s.fake.frames.fire(ONE + longStepMs + ONE);
    // The first tick (in `started`) passes 0; then the timestamp differences.
    expect(s.dts).toEqual([ZERO, ONE, longStepMs, ONE]);
    expect(dateNow).not.toHaveBeenCalled();
    expect(perfNow).not.toHaveBeenCalled();
    s.manager.dispose();
  });

  it('scene manager sets touch-action and caps the pixel ratio', async () => {
    const s = fixture(THREE);
    await started(s);
    expect(s.host.style.touchAction).toBe('none');
    const app = s.fake.applications[ZERO];
    expect(app?.initOptions[ZERO]?.resolution).toBe(TUNING.maxPixelRatio);
    s.manager.dispose();
  });

  it('targetVisualRatio sets the drawn disc and leaves the hit circle alone', async () => {
    const plain = fixture(ONE);
    await started(plain);
    plain.current = frameData(ONE, { x: HALF, y: -HALF });
    plain.fake.frames.fire(ONE);
    const scaled = fixture(ONE, HALF);
    await started(scaled);
    scaled.current = frameData(ONE, { x: HALF, y: -HALF });
    scaled.fake.frames.fire(ONE);

    expect(scaled.circles[scaled.circles.length - ONE]).toEqual(plain.circles[plain.circles.length - ONE]);
    // The target's Graphics is the last one created; its circle has the visual radius in local units.
    const drawnRadius = (s: Fixture): number => {
      const target = s.fake.graphics[s.fake.graphics.length - ONE];
      const circle = target?.calls.find((call) => call.op === 'circle');
      return (circle?.args[TWO] ?? NaN) / DRAW_UNIT;
    };
    expect(drawnRadius(plain)).toBe(MARROW_TUNING.hitRadius);
    expect(drawnRadius(scaled)).toBe(MARROW_TUNING.hitRadius * HALF);
    plain.manager.dispose();
    scaled.manager.dispose();
  });

  it('scene manager resizes when the pixel ratio changes between ticks', async () => {
    const s = fixture(ONE);
    await started(s);
    const app = s.fake.applications[ZERO];
    const resizesBefore = app?.resizes.length ?? NaN;

    // A tick with the ratio unchanged does not resize.
    s.fake.frames.fire(ONE);
    expect(app?.resizes).toHaveLength(resizesBefore);

    s.fake.devicePixelRatio = THREE;
    s.fake.frames.fire(TWO);
    expect(app?.resizes).toHaveLength(resizesBefore + ONE);
    expect(app?.resizes[resizesBefore]?.resolution).toBe(Math.min(THREE, TUNING.maxPixelRatio));

    // The ratio is unchanged on the next tick, so there is no second resize.
    s.fake.frames.fire(THREE);
    expect(app?.resizes).toHaveLength(resizesBefore + ONE);
    s.manager.dispose();
  });

  it('scene manager reads the host size only when the size observer fired', async () => {
    const s = fixture(ONE);
    await started(s);
    const readsBefore = s.host.sizeReads;

    // Ticks without an observer callback read no size.
    s.fake.frames.fire(ONE);
    s.fake.frames.fire(TWO);
    s.fake.frames.fire(THREE);
    expect(s.host.sizeReads).toBe(readsBefore);

    // The observer fires with the same size: both sides are read once, the frame object and the drawing stay.
    const frameBefore = s.manager.projectionFrame();
    const clearsBefore = totalClears(s);
    s.fake.observers.callback?.();
    s.fake.frames.fire(THREE + ONE);
    expect(s.host.sizeReads - readsBefore).toBe(TWO);
    expect(Object.is(s.manager.projectionFrame(), frameBefore)).toBe(true);
    expect(totalClears(s)).toBe(clearsBefore);

    // The size changes to aspect 1: a new frame object, and a redraw that uses it.
    const readsAfterSame = s.host.sizeReads;
    s.host.clientWidth = HOST_HEIGHT;
    s.fake.observers.callback?.();
    s.fake.frames.fire(THREE + TWO);
    expect(s.host.sizeReads - readsAfterSame).toBe(TWO);
    const frameAfter = s.manager.projectionFrame();
    expect(Object.is(frameAfter, frameBefore)).toBe(false);
    expect(frameAfter.aspect).toBe(s.host.clientWidth / s.host.clientHeight);
    expect(totalClears(s)).toBeGreaterThan(clearsBefore);
    const backdrop = layers()[ZERO];
    if (backdrop === undefined) throw new Error('no backdrop layer');
    const expected = backdropRect(backdrop, { from: ZERO, to: ONE }, frameAfter);
    const rect = s.fake.graphics[ZERO]?.calls.find((call) => call.op === 'rect');
    expect((rect?.args[TWO] ?? NaN) / DRAW_UNIT).toBeCloseTo(expected.x1 - expected.x0, 9);
    s.manager.dispose();
  });

  it('scene manager skips the tick for a host of zero size', async () => {
    // A zero width, then a zero height: each case gets its own manager.
    const zeroCases: Array<{ width: number; height: number }> = [
      { width: ZERO, height: HOST_HEIGHT },
      { width: HOST_WIDTH, height: ZERO },
    ];
    for (const { width, height } of zeroCases) {
      const s = fixture(ONE);
      await started(s);
      const app = s.fake.applications[ZERO];
      const rendersBefore = app?.renders ?? NaN;
      const dtsBefore = s.dts.length;

      s.host.clientWidth = width;
      s.host.clientHeight = height;
      s.fake.observers.callback?.();
      s.fake.frames.fire(ONE);
      expect(s.dts).toHaveLength(dtsBefore);
      expect(app?.renders).toBe(rendersBefore);

      // The observer fires with a non-zero size: the next tick runs again.
      s.host.clientWidth = HOST_WIDTH;
      s.host.clientHeight = HOST_HEIGHT;
      s.fake.observers.callback?.();
      s.fake.frames.fire(TWO);
      expect(s.dts).toHaveLength(dtsBefore + ONE);
      expect(app?.renders).toBe(rendersBefore + ONE);
      s.manager.dispose();
    }
  });

  it('hit circles do not depend on the pixel ratio', async () => {
    const results: HitCircle[][] = [];
    for (const ratio of [ONE, TWO, THREE]) {
      const s = fixture(ratio);
      await started(s);
      s.current = frameData(ONE, { x: HALF, y: -HALF });
      s.fake.frames.fire(ONE);
      const last = s.circles[s.circles.length - ONE] ?? [];
      expect(last).toHaveLength(ONE);
      results.push(last);
      s.manager.dispose();
    }
    expect(results[ONE]).toEqual(results[ZERO]);
    expect(results[TWO]).toEqual(results[ZERO]);
  });
});
