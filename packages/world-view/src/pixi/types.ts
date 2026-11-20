// The types of the Scene Manager (design 7.1, 1.2). The app sees these types and never a Pixi object.
import type { Vec2 } from 'marrow/core';
import type { TravelRange } from '../core/overscan';
import type { LayerDef } from '../core/layers';
import type { Tuning } from '../core/tuning';
import type { ProjectionFrame, Rect, View, WorldPoint } from '../core/types';
import type { HostLike } from './ports';

/** A placeholder shape. Its bounds are in unit coordinates: `x0`, `x1` are fractions of the width, `y0`, `y1` of the height. */
export interface ShapeSpec {
  readonly kind: 'rect' | 'ellipse' | 'roundRect';
  readonly bounds: Rect;
  readonly colour: number;
  /** An accent shape is drawn in its own layer of the group, and its alpha is FrameData.accentAlpha. */
  readonly accent?: boolean;
}

/** A layer as the scene draws it: its table row (LayerDef, with the factor resolved), a fill and shapes. */
export interface SceneLayerSpec extends LayerDef {
  /** The colour of a backdrop layer. Required for a backdrop layer, unused otherwise. */
  readonly fill?: number;
  readonly shapes: readonly ShapeSpec[];
}

/** A target: its world point on the interaction layer, its hit radius and its colour. */
export interface SceneTarget {
  readonly id: string;
  readonly point: WorldPoint;
  readonly r: number;
  readonly colour: number;
}

/** What the caller gives the Scene Manager each frame (design 7.1). */
export interface FrameData {
  /** `{ travel, head: decorativeHead }`, built once by the caller. */
  readonly view: View;
  /** `{ travel, head: interactionHead }`, built once by the caller. Dwell and render read this object. */
  readonly interactionView: View;
  readonly interactionHead: Vec2;
  readonly decorativeHead: Vec2;
  readonly cover: number;
  /** The progress in the fade style, else 0. Drives the accent shapes. */
  readonly accentAlpha: number;
  readonly travelling: boolean;
  /** Ids of the targets that are active (they can be selected). */
  readonly active: ReadonlySet<string>;
  /** Ids of the targets that are drawn. Every active target is shown. */
  readonly shown: ReadonlySet<string>;
}

/** The hit circle of an active target, in screen units. */
export interface HitCircle {
  readonly id: string;
  readonly centre: Vec2;
  readonly radius: number;
}

/** An applied value of a layer or target container, read back for the debug panel (Req 11.7). */
export interface DebugEntry {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly visible: boolean;
}

export interface SceneManagerOptions {
  /** The play area element. A HostLike is any element with the size and style the scene reads. */
  readonly host: HostLike;
  /** In table order, which is the draw order (Req 2.10). */
  readonly layers: readonly SceneLayerSpec[];
  readonly targets: readonly SceneTarget[];
  readonly sceneScale: number;
  /** The travel range of the scene, for the backdrop rectangles (Req 4.4). */
  readonly travelRange: TravelRange;
  readonly coverColour: number;
  /**
   * The visible disc of a target as a fraction of its hit radius (design 7.2). Steering wants the
   * visible circle smaller than the hit circle, and the app sets that value. Default 1: the disc is
   * drawn at the hit radius. The hit circle does not depend on it.
   */
  readonly targetVisualRatio?: number;
  /** Returns the frame's data for the raw frame delta in ms. Called once per rendered frame. */
  readonly getFrame: (dtMs: number) => FrameData;
  readonly onFrame?: (circles: readonly HitCircle[]) => void;
  readonly tuning?: Tuning;
}

export interface SceneManager {
  start(): Promise<void>;
  dispose(): void;
  /** The hit circles of the frame being processed. Empty outside a frame. */
  hitCircles(): readonly HitCircle[];
  /** The projection frame that the last frame used. */
  projectionFrame(): ProjectionFrame;
  setTargets(targets: readonly SceneTarget[]): void;
  setTargetColour(id: string, colour: number): void;
  debugLayers(): readonly DebugEntry[];
  debugTargets(): readonly DebugEntry[];
  canvasSize(): { width: number; height: number };
}
