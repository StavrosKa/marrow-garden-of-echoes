// The seam between the Scene Manager and PixiJS (design 7.4). The Scene Manager and its tests use
// only these interfaces. createPixiPorts (pixiPorts.ts) is the one place that implements them with
// PixiJS and the browser.

/** The host element of the play area, as far as the Scene Manager uses it. An HTMLElement has all of these. */
export interface HostLike {
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly style: { touchAction: string };
}

/** A drawn shape or Graphics object. Shapes are added to a path and filled with one colour. */
export interface GraphicsLike {
  /** Position in the parent's local units. */
  x: number;
  y: number;
  /** Uniform scale. */
  scale: number;
  visible: boolean;
  alpha: number;
  clear(): void;
  rect(x: number, y: number, width: number, height: number): void;
  ellipse(x: number, y: number, radiusX: number, radiusY: number): void;
  roundRect(x: number, y: number, width: number, height: number, radius: number): void;
  circle(x: number, y: number, radius: number): void;
  /** Fills the path drawn since the last fill, and starts a new one. */
  fill(colour: number): void;
}

/** A display container. `removeChildren` removes and destroys its direct children. */
export interface ContainerLike {
  x: number;
  y: number;
  /** Uniform scale. */
  scale: number;
  visible: boolean;
  alpha: number;
  addChild(child: ContainerLike | GraphicsLike): void;
  removeChildren(): void;
}

/** What the Scene Manager gives the Pixi application at init. The names are PixiJS 8 options (design 11 item 13). */
export interface AppInitOptions {
  readonly width: number;
  readonly height: number;
  readonly resolution: number;
  readonly autoDensity: boolean;
  readonly autoStart: boolean;
  readonly sharedTicker: boolean;
  readonly backgroundAlpha: number;
  readonly antialias: boolean;
}

export interface PixiApplicationLike {
  readonly stage: ContainerLike;
  /** The canvas element, which the host takes as a child. */
  readonly canvas: unknown;
  init(options: AppInitOptions): Promise<void>;
  /** The renderer's resize: CSS size in pixels, and the resolution. */
  resize(width: number, height: number, resolution: number): void;
  render(): void;
  destroy(rendererOptions: { removeView: boolean }, options: { children: boolean }): void;
}

/** A target's display object: where it is drawn, its depth scale and its visibility (design 7.2). */
export interface DisplayLike {
  readonly position: { set(x: number, y: number): void };
  setDepthScale(scale: number): void;
  visible: boolean;
}

export interface PixiPorts {
  requestFrame(callback: (timestamp: number) => void): number;
  cancelFrame(handle: number): void;
  devicePixelRatio(): number;
  /** Calls `callback` when the host changes size. Returns the disconnect function. */
  observeSize(host: HostLike, callback: () => void): () => void;
  /** Adds the canvas of an application to the host. */
  attachView(host: HostLike, view: unknown): void;
  createApplication(): PixiApplicationLike;
  createContainer(): ContainerLike;
  createGraphics(): GraphicsLike;
}
