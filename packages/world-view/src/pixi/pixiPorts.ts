// The only module of the package that imports PixiJS at run time (design 1.2, 7.4). It adapts the
// Pixi objects to the ports of ports.ts. No test loads this file.
import { Application, Container, Graphics } from 'pixi.js';
import type {
  AppInitOptions,
  ContainerLike,
  GraphicsLike,
  HostLike,
  PixiApplicationLike,
  PixiPorts,
} from './ports';

class PixiGraphics implements GraphicsLike {
  constructor(readonly native: Graphics) {}

  get x(): number {
    return this.native.x;
  }
  set x(value: number) {
    this.native.x = value;
  }
  get y(): number {
    return this.native.y;
  }
  set y(value: number) {
    this.native.y = value;
  }
  get scale(): number {
    return this.native.scale.x;
  }
  set scale(value: number) {
    this.native.scale.set(value);
  }
  get visible(): boolean {
    return this.native.visible;
  }
  set visible(value: boolean) {
    this.native.visible = value;
  }
  get alpha(): number {
    return this.native.alpha;
  }
  set alpha(value: number) {
    this.native.alpha = value;
  }
  clear(): void {
    this.native.clear();
  }
  rect(x: number, y: number, width: number, height: number): void {
    this.native.rect(x, y, width, height);
  }
  ellipse(x: number, y: number, radiusX: number, radiusY: number): void {
    this.native.ellipse(x, y, radiusX, radiusY);
  }
  roundRect(x: number, y: number, width: number, height: number, radius: number): void {
    this.native.roundRect(x, y, width, height, radius);
  }
  circle(x: number, y: number, radius: number): void {
    this.native.circle(x, y, radius);
  }
  fill(colour: number): void {
    this.native.fill(colour);
  }
}

class PixiContainer implements ContainerLike {
  constructor(readonly native: Container) {}

  get x(): number {
    return this.native.x;
  }
  set x(value: number) {
    this.native.x = value;
  }
  get y(): number {
    return this.native.y;
  }
  set y(value: number) {
    this.native.y = value;
  }
  get scale(): number {
    return this.native.scale.x;
  }
  set scale(value: number) {
    this.native.scale.set(value);
  }
  get visible(): boolean {
    return this.native.visible;
  }
  set visible(value: boolean) {
    this.native.visible = value;
  }
  get alpha(): number {
    return this.native.alpha;
  }
  set alpha(value: number) {
    this.native.alpha = value;
  }
  addChild(child: ContainerLike | GraphicsLike): void {
    if (child instanceof PixiContainer || child instanceof PixiGraphics) {
      this.native.addChild(child.native);
      return;
    }
    throw new Error('world-view: addChild received an object that is not a Pixi adapter');
  }
  removeChildren(): void {
    for (const child of this.native.removeChildren()) child.destroy();
  }
}

class PixiApplication implements PixiApplicationLike {
  private readonly app = new Application();

  get stage(): ContainerLike {
    return new PixiContainer(this.app.stage);
  }
  get canvas(): unknown {
    return this.app.canvas;
  }
  init(options: AppInitOptions): Promise<void> {
    return this.app.init(options);
  }
  resize(width: number, height: number, resolution: number): void {
    this.app.renderer.resize(width, height, resolution);
  }
  render(): void {
    this.app.render();
  }
  destroy(rendererOptions: { removeView: boolean }, options: { children: boolean }): void {
    this.app.destroy(rendererOptions, options);
  }
}

export function createPixiPorts(): PixiPorts {
  return {
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    devicePixelRatio: () => window.devicePixelRatio,
    observeSize: (host: HostLike, callback: () => void) => {
      const observer = new ResizeObserver(() => callback());
      observer.observe(host as HTMLElement);
      return () => observer.disconnect();
    },
    attachView: (host: HostLike, view: unknown) => {
      (host as HTMLElement).appendChild(view as HTMLCanvasElement);
    },
    createApplication: () => new PixiApplication(),
    createContainer: () => new PixiContainer(new Container()),
    createGraphics: () => new PixiGraphics(new Graphics()),
  };
}
