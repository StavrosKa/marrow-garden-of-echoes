// Fakes of the Scene Manager's ports (design 9.3). Tests use these instead of PixiJS, so no test
// loads pixi.js, WebGL or a DOM. Test code only: nothing in the entry points imports this file.
import type {
  AppInitOptions,
  ContainerLike,
  DisplayLike,
  GraphicsLike,
  HostLike,
  PixiApplicationLike,
  PixiPorts,
} from './ports';

/** A target display: records the position, the depth scale and the visibility that were applied. */
export class FakeDisplay implements DisplayLike {
  x = Number.NaN;
  y = Number.NaN;
  scale = Number.NaN;
  visible = true;
  positionSets = 0;
  readonly position = {
    set: (x: number, y: number): void => {
      this.x = x;
      this.y = y;
      this.positionSets += 1;
    },
  };
  setDepthScale(scale: number): void {
    this.scale = scale;
  }
}

export class FakeContainer implements ContainerLike {
  x = 0;
  y = 0;
  scale = 1;
  visible = true;
  alpha = 1;
  children: Array<FakeContainer | FakeGraphics> = [];
  removedChildren = 0;
  addChild(child: ContainerLike | GraphicsLike): void {
    if (!(child instanceof FakeContainer) && !(child instanceof FakeGraphics)) {
      throw new Error('FakeContainer.addChild: not a fake');
    }
    this.children.push(child);
  }
  removeChildren(): void {
    this.removedChildren += this.children.length;
    this.children = [];
  }
}

/** One drawing call, as recorded: its name and its numeric arguments. */
export interface DrawCall {
  readonly op: 'rect' | 'ellipse' | 'roundRect' | 'circle' | 'fill';
  readonly args: readonly number[];
}

export class FakeGraphics implements GraphicsLike {
  x = 0;
  y = 0;
  scale = 1;
  visible = true;
  alpha = 1;
  /** The calls since the last clear, as a real Graphics object keeps its path until it is cleared. */
  calls: DrawCall[] = [];
  /** How many times the path was cleared. A redraw clears every Graphics it draws. */
  clears = 0;
  clear(): void {
    this.calls = [];
    this.clears += 1;
  }
  rect(x: number, y: number, width: number, height: number): void {
    this.calls.push({ op: 'rect', args: [x, y, width, height] });
  }
  ellipse(x: number, y: number, radiusX: number, radiusY: number): void {
    this.calls.push({ op: 'ellipse', args: [x, y, radiusX, radiusY] });
  }
  roundRect(x: number, y: number, width: number, height: number, radius: number): void {
    this.calls.push({ op: 'roundRect', args: [x, y, width, height, radius] });
  }
  circle(x: number, y: number, radius: number): void {
    this.calls.push({ op: 'circle', args: [x, y, radius] });
  }
  fill(colour: number): void {
    this.calls.push({ op: 'fill', args: [colour] });
  }
}

export class FakeApplication implements PixiApplicationLike {
  readonly stage = new FakeContainer();
  readonly canvas = { kind: 'fake canvas' };
  readonly initOptions: AppInitOptions[] = [];
  readonly resizes: Array<{ width: number; height: number; resolution: number }> = [];
  readonly destroyCalls: Array<{ rendererOptions: unknown; options: unknown }> = [];
  renders = 0;
  private gate: Promise<void> = Promise.resolve();
  private release: (() => void) | undefined;

  /** Makes the next init wait until releaseInit is called. */
  holdInit(): void {
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
  releaseInit(): void {
    this.release?.();
  }
  init(options: AppInitOptions): Promise<void> {
    this.initOptions.push(options);
    return this.gate;
  }
  resize(width: number, height: number, resolution: number): void {
    this.resizes.push({ width, height, resolution });
  }
  render(): void {
    this.renders += 1;
  }
  destroy(rendererOptions: { removeView: boolean }, options: { children: boolean }): void {
    this.destroyCalls.push({ rendererOptions, options });
  }
}

/** A manual requestAnimationFrame: one outstanding request at a time, fired by the test. */
export class FakeFrames {
  private nextHandle = 1;
  readonly pending = new Map<number, (timestamp: number) => void>();
  requestFrame(callback: (timestamp: number) => void): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.pending.set(handle, callback);
    return handle;
  }
  cancelFrame(handle: number): void {
    this.pending.delete(handle);
  }
  /** Runs the outstanding request with the timestamp `timestamp`. Throws if none is outstanding. */
  fire(timestamp: number): void {
    const first = this.pending.entries().next();
    if (first.done) throw new Error('FakeFrames.fire: no frame request is outstanding');
    const [handle, callback] = first.value;
    this.pending.delete(handle);
    callback(timestamp);
  }
}

export class FakeHost implements HostLike {
  /** How many reads of clientWidth or clientHeight the scene made. */
  sizeReads = 0;
  private width: number;
  private height: number;
  readonly style = { touchAction: '' };
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  get clientWidth(): number {
    this.sizeReads += 1;
    return this.width;
  }
  set clientWidth(value: number) {
    this.width = value;
  }
  get clientHeight(): number {
    this.sizeReads += 1;
    return this.height;
  }
  set clientHeight(value: number) {
    this.height = value;
  }
}

export interface FakePorts {
  readonly ports: PixiPorts;
  readonly frames: FakeFrames;
  readonly applications: FakeApplication[];
  readonly graphics: FakeGraphics[];
  readonly attached: Array<{ host: HostLike; view: unknown }>;
  readonly observers: { connected: number; disconnected: number; callback: (() => void) | undefined };
  /** The value the devicePixelRatio port returns. */
  devicePixelRatio: number;
  /** When true, each application created from now on holds its init until releaseInit. */
  holdInits: boolean;
}

/** A set of ports made of fakes. The application, container and Graphics objects are recorded in creation order. */
export function createFakePorts(devicePixelRatio: number): FakePorts {
  const frames = new FakeFrames();
  const applications: FakeApplication[] = [];
  const graphics: FakeGraphics[] = [];
  const attached: Array<{ host: HostLike; view: unknown }> = [];
  const observers: { connected: number; disconnected: number; callback: (() => void) | undefined } = {
    connected: 0,
    disconnected: 0,
    callback: undefined,
  };
  const state = { devicePixelRatio, holdInits: false };
  const ports: PixiPorts = {
    requestFrame: (callback) => frames.requestFrame(callback),
    cancelFrame: (handle) => frames.cancelFrame(handle),
    devicePixelRatio: () => state.devicePixelRatio,
    observeSize: (_host, callback) => {
      observers.connected += 1;
      observers.callback = callback;
      return () => {
        observers.connected -= 1;
        observers.disconnected += 1;
      };
    },
    attachView: (host, view) => {
      attached.push({ host, view });
    },
    createApplication: () => {
      const application = new FakeApplication();
      if (state.holdInits) application.holdInit();
      applications.push(application);
      return application;
    },
    createContainer: () => new FakeContainer(),
    createGraphics: () => {
      const created = new FakeGraphics();
      graphics.push(created);
      return created;
    },
  };
  return {
    ports,
    frames,
    applications,
    graphics,
    attached,
    observers,
    get devicePixelRatio() {
      return state.devicePixelRatio;
    },
    set devicePixelRatio(value: number) {
      state.devicePixelRatio = value;
    },
    get holdInits() {
      return state.holdInits;
    },
    set holdInits(value: boolean) {
      state.holdInits = value;
    },
  };
}
