import type { Vec2 } from 'marrow/core';

/** What a point needs to know about its layer: where it sits in depth, and how far parallax moves it. */
export interface LayerRef {
  /** Distance along the path at which the layer sits. */
  depth: number;
  /** The travel at which the layer is drawn at its authored size (depth scale exactly 1). */
  anchor: number;
  /** Parallax factor, 0..1. */
  factor: number;
}

/** A point of a layer: x and y in layer units (screen units at depth scale 1). */
export interface WorldPoint extends LayerRef {
  x: number;
  y: number;
}

/** The view: travel along the path and the head offset (each axis -1..1). */
export interface View {
  travel: number;
  head: Vec2;
}

/** The play area: width divided by height, and the scene parallax scale (0..1). */
export interface ProjectionFrame {
  aspect: number;
  sceneScale: number;
}

/** A rectangle in screen units. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
