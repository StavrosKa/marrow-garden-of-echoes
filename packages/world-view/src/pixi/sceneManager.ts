// The Scene Manager (Req 10; design 7.1-7.4). It owns the application, the containers and the
// frame loop, and it applies the view that the caller gives each frame. It computes no head offset,
// travel or lock, and it reads no clock: the frame delta comes from the frame loop.
import { backdropRect } from '../core/overscan';
import { layerTransform } from '../core/projection';
import { TUNING, type Tuning } from '../core/tuning';
import type { ProjectionFrame, View } from '../core/types';
import { createFrameLoop } from './frameLoop';
import type { ContainerLike, DisplayLike, GraphicsLike, PixiApplicationLike, PixiPorts } from './ports';
import { DRAW_UNIT, drawBackdrop, drawCover, drawShapes, drawTarget } from './shapes';
import { applyTargets } from './targets';
import type {
  DebugEntry,
  HitCircle,
  SceneLayerSpec,
  SceneManager,
  SceneManagerOptions,
  SceneTarget,
} from './types';

const ZERO = 0;
const ONE = 1;

/** The scene graph of one layer. `root` takes the layer transform (the decor of the interaction layer). */
interface LayerNode {
  readonly spec: SceneLayerSpec;
  readonly root: ContainerLike;
  readonly base: GraphicsLike;
  readonly accent: GraphicsLike;
}

/** One target: its container (its position), its Graphics and the values last applied. */
interface TargetNode {
  readonly id: string;
  readonly container: ContainerLike;
  readonly graphics: GraphicsLike;
  readonly visualRadius: number;
  colour: number;
  scale: number;
}

/** The objects that exist once the application is initialised. */
interface Scene {
  readonly app: PixiApplicationLike;
  readonly world: ContainerLike;
  readonly cover: GraphicsLike;
  readonly targetsLayer: ContainerLike;
  readonly layers: readonly LayerNode[];
  readonly targetNodes: Map<string, TargetNode>;
  readonly displays: Map<string, DisplayLike>;
}

type Status = 'created' | 'starting' | 'running' | 'disposed';

export function createSceneManager(options: SceneManagerOptions, ports: PixiPorts): SceneManager {
  const tuning: Tuning = options.tuning ?? TUNING;
  const host = options.host;
  const visualRatio = options.targetVisualRatio ?? ONE;
  const interactionCount = options.layers.filter((spec) => spec.interaction === true).length;
  if (interactionCount !== ONE) {
    throw new Error(`world-view: the layers need exactly one interaction layer; they have ${interactionCount}`);
  }

  let status: Status = 'created';
  let startPromise: Promise<void> | undefined;
  let scene: Scene | undefined;
  let targets: readonly SceneTarget[] = options.targets;
  let frame: ProjectionFrame = { aspect: ONE, sceneScale: options.sceneScale };
  let size = { width: ZERO, height: ZERO };
  let dirty = false;
  let lastResolution = ONE;
  let disconnectSize: (() => void) | undefined;
  let inTick = false;
  let circles: readonly HitCircle[] = [];

  /** Creates one layer's Graphics and adds them to `root`. */
  function makeLayer(spec: SceneLayerSpec, root: ContainerLike): LayerNode {
    const base = ports.createGraphics();
    const accent = ports.createGraphics();
    base.scale = ONE / DRAW_UNIT;
    accent.scale = ONE / DRAW_UNIT;
    root.addChild(base);
    root.addChild(accent);
    return { spec, root, base, accent };
  }

  /** The scene graph in table order: a container per layer, the interaction group with its targets, then the cover. */
  function build(app: PixiApplicationLike): Scene {
    const world = ports.createContainer();
    app.stage.addChild(world);
    const layers: LayerNode[] = [];
    let targetsLayer: ContainerLike | undefined;
    for (const spec of options.layers) {
      if (spec.interaction === true) {
        const group = ports.createContainer();
        const decor = ports.createContainer();
        const targetsContainer = ports.createContainer();
        group.addChild(decor);
        group.addChild(targetsContainer);
        world.addChild(group);
        layers.push(makeLayer(spec, decor));
        targetsLayer = targetsContainer;
      } else {
        const root = ports.createContainer();
        world.addChild(root);
        layers.push(makeLayer(spec, root));
      }
    }
    if (targetsLayer === undefined) throw new Error('world-view: no interaction layer was built');
    const cover = ports.createGraphics();
    world.addChild(cover);
    const built: Scene = {
      app,
      world,
      cover,
      targetsLayer,
      layers,
      targetNodes: new Map(),
      displays: new Map(),
    };
    buildTargets(built);
    redraw(built);
    return built;
  }

  /** One container and Graphics per target, with the display object the target's position is written to. */
  function buildTargets(built: Scene): void {
    built.targetsLayer.removeChildren();
    built.targetNodes.clear();
    built.displays.clear();
    for (const target of targets) {
      const container = ports.createContainer();
      const graphics = ports.createGraphics();
      const visualRadius = target.r * visualRatio;
      graphics.scale = ONE / DRAW_UNIT;
      drawTarget(graphics, visualRadius, target.colour);
      container.addChild(graphics);
      built.targetsLayer.addChild(container);
      const node: TargetNode = {
        id: target.id,
        container,
        graphics,
        visualRadius,
        colour: target.colour,
        scale: ONE,
      };
      const display: DisplayLike = {
        position: {
          set: (x: number, y: number): void => {
            container.x = x;
            container.y = y;
          },
        },
        setDepthScale: (scale: number): void => {
          node.scale = scale;
          graphics.scale = scale / DRAW_UNIT;
        },
        get visible(): boolean {
          return container.visible;
        },
        set visible(value: boolean) {
          container.visible = value;
        },
      };
      built.targetNodes.set(target.id, node);
      built.displays.set(target.id, display);
    }
  }

  /** Redraws everything that depends on the frame: the backdrops, the shapes and the cover. */
  function redraw(built: Scene): void {
    for (const node of built.layers) {
      node.base.clear();
      node.accent.clear();
      const { spec } = node;
      if (spec.backdrop && spec.fill !== undefined) {
        drawBackdrop(node.base, backdropRect(spec, options.travelRange, frame, tuning), spec.fill);
      }
      drawShapes(node.base, spec.shapes, frame.aspect, false);
      drawShapes(node.accent, spec.shapes, frame.aspect, true);
    }
    drawCover(built.cover, frame.aspect, options.coverColour);
  }

  /** Reads the host size when it has changed. A new aspect replaces the frame object and redraws. */
  function readSize(built: Scene): void {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === size.width && height === size.height) return;
    size = { width, height };
    if (width === ZERO || height === ZERO) return;
    const aspect = width / height;
    built.app.resize(width, height, lastResolution);
    built.world.scale = height;
    if (aspect !== frame.aspect) {
      frame = { aspect, sceneScale: options.sceneScale };
      redraw(built);
    }
  }

  /** Puts a layer's container where worldToScreen puts its origin and scale; hides a culled layer. */
  function applyLayer(root: ContainerLike, spec: SceneLayerSpec, view: View): void {
    const transform = layerTransform(spec, view, frame, tuning);
    if (transform === null) {
      root.visible = false;
      return;
    }
    root.visible = true;
    root.scale = transform.scale;
    root.x = transform.offset.x;
    root.y = transform.offset.y;
  }

  /** One frame (design 7.3, steps 2-8). The frame loop has already requested the next frame. */
  function tick(rawDtMs: number): void {
    if (scene === undefined || status !== 'running') return;
    const built = scene;
    if (dirty) {
      dirty = false;
      readSize(built);
    }
    if (size.width === ZERO || size.height === ZERO) return;
    const resolution = Math.min(ports.devicePixelRatio(), tuning.maxPixelRatio);
    if (resolution !== lastResolution) {
      lastResolution = resolution;
      built.app.resize(size.width, size.height, resolution);
    }
    const data = options.getFrame(rawDtMs);
    inTick = true;
    try {
      for (const node of built.layers) {
        applyLayer(node.root, node.spec, node.spec.interaction === true ? data.interactionView : data.view);
      }
      circles = applyTargets(
        targets,
        data.shown,
        data.active,
        data.travelling,
        data.interactionView,
        frame,
        built.displays,
        tuning,
      );
      built.cover.alpha = data.cover;
      for (const node of built.layers) node.accent.alpha = data.accentAlpha;
      built.app.render();
      options.onFrame?.(circles);
    } finally {
      inTick = false;
    }
  }

  const loop = createFrameLoop(ports, tick);

  function mount(app: PixiApplicationLike): void {
    ports.attachView(host, app.canvas);
    host.style.touchAction = 'none';
    scene = build(app);
    dirty = true;
    disconnectSize = ports.observeSize(host, () => {
      dirty = true;
    });
    status = 'running';
    loop.start();
  }

  return {
    start(): Promise<void> {
      if (startPromise !== undefined) return startPromise;
      if (status === 'disposed') return Promise.resolve();
      status = 'starting';
      const app = ports.createApplication();
      lastResolution = Math.min(ports.devicePixelRatio(), tuning.maxPixelRatio);
      startPromise = app
        .init({
          width: Math.max(ONE, host.clientWidth),
          height: Math.max(ONE, host.clientHeight),
          resolution: lastResolution,
          autoDensity: true,
          autoStart: false,
          sharedTicker: false,
          backgroundAlpha: ZERO,
          antialias: true,
        })
        .then(() => {
          // A dispose during init leaves the application to this call: it is destroyed once, here.
          if (status === 'disposed') {
            app.destroy({ removeView: true }, { children: true });
            return;
          }
          mount(app);
        });
      return startPromise;
    },

    dispose(): void {
      if (status === 'disposed') return;
      status = 'disposed';
      loop.stop();
      disconnectSize?.();
      disconnectSize = undefined;
      if (scene !== undefined) {
        const { app } = scene;
        scene = undefined;
        app.destroy({ removeView: true }, { children: true });
      }
    },

    hitCircles(): readonly HitCircle[] {
      return inTick ? circles : [];
    },

    projectionFrame(): ProjectionFrame {
      return frame;
    },

    setTargets(next: readonly SceneTarget[]): void {
      targets = next;
      if (scene !== undefined) buildTargets(scene);
    },

    setTargetColour(id: string, colour: number): void {
      const node = scene?.targetNodes.get(id);
      if (node === undefined) return;
      node.colour = colour;
      drawTarget(node.graphics, node.visualRadius, colour);
    },

    debugLayers(): readonly DebugEntry[] {
      if (scene === undefined) return [];
      return scene.layers.map((node) => ({
        id: node.spec.id,
        x: node.root.x,
        y: node.root.y,
        scale: node.root.scale,
        visible: node.root.visible,
      }));
    },

    debugTargets(): readonly DebugEntry[] {
      if (scene === undefined) return [];
      return [...scene.targetNodes.values()].map((node) => ({
        id: node.id,
        x: node.container.x,
        y: node.container.y,
        scale: node.scale,
        visible: node.container.visible,
      }));
    },

    canvasSize(): { width: number; height: number } {
      return { width: size.width, height: size.height };
    },
  };
}
