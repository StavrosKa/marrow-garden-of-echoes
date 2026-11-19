// The projection (Req 2; design 2.1, 2.2): the only place that converts between world and
// screen space. One internal function fixes the evaluation order, so worldToScreen,
// screenToWorld, targetScreen and layerTransform cannot drift apart.
import type { Vec2 } from 'marrow/core';
import { parallaxShift } from './parallax';
import { TUNING, type Tuning } from './tuning';
import type { LayerRef, ProjectionFrame, View, WorldPoint } from './types';

const ZERO = 0;
const ONE = 1;
const HALF = 0.5;

/** The depth scale: (depth - anchor) / (depth - travel). Exactly 1 when travel equals the anchor. */
export function depthScale(layer: LayerRef, travel: number): number {
  return (layer.depth - layer.anchor) / (layer.depth - travel);
}

/** True when `depth - travel <= nearPlane`, and for NaN (Req 2.5). */
export function isCulled(layer: LayerRef, travel: number, tuning: Tuning = TUNING): boolean {
  return !(layer.depth - travel > tuning.nearPlane);
}

/** What the screen position of every point of one layer is made of, for one view and frame. */
interface LayerPlacement {
  /** The vanishing point. */
  readonly vx: number;
  readonly vy: number;
  /** The depth scale. */
  readonly s: number;
  /** The parallax shift. */
  readonly shift: Vec2;
}

/** The numbers of a layer for a view and frame, or null if the layer is culled. */
function placeLayer(
  layer: LayerRef,
  view: View,
  frame: ProjectionFrame,
  tuning: Tuning,
): LayerPlacement | null {
  if (isCulled(layer, view.travel, tuning)) return null;
  return {
    vx: frame.aspect * HALF,
    vy: tuning.vanishingPointY,
    s: depthScale(layer, view.travel),
    shift: parallaxShift(layer.factor, view.head, frame, tuning),
  };
}

/**
 * The screen position `v + (p - v) * s + shift` of a world point, or null if the point is
 * culled (Req 2.3, 2.5).
 */
export function worldToScreen(
  point: WorldPoint,
  view: View,
  frame: ProjectionFrame,
  tuning: Tuning = TUNING,
): Vec2 | null {
  const placed = placeLayer(point, view, frame, tuning);
  if (placed === null) return null;
  const { vx, vy, s, shift } = placed;
  return {
    x: vx + (point.x - vx) * s + shift.x,
    y: vy + (point.y - vy) * s + shift.y,
  };
}

/**
 * The inverse of worldToScreen for a point of `layer`: `p = v + (S - shift - v) / s`
 * (Req 2.1, 2.6). Null if the layer is culled.
 */
export function screenToWorld(
  screen: Vec2,
  view: View,
  layer: LayerRef,
  frame: ProjectionFrame,
  tuning: Tuning = TUNING,
): WorldPoint | null {
  const placed = placeLayer(layer, view, frame, tuning);
  if (placed === null) return null;
  const { vx, vy, s, shift } = placed;
  return {
    x: vx + (screen.x - shift.x - vx) / s,
    y: vy + (screen.y - shift.y - vy) / s,
    depth: layer.depth,
    anchor: layer.anchor,
    factor: layer.factor,
  };
}

/** The position and scale that make a container draw the points of a layer where worldToScreen puts them. */
export interface LayerTransform {
  readonly scale: number;
  readonly offset: Vec2;
}

/**
 * The transform of a layer for a view and frame (design 2.2), from two calls of worldToScreen:
 * the image of the layer origin is the offset, and the distance of the images of (0, 0) and
 * (1, 0) is the scale. Null when the layer is culled. Not exported from the entry point.
 */
export function layerTransform(
  layer: LayerRef,
  view: View,
  frame: ProjectionFrame,
  tuning: Tuning = TUNING,
): LayerTransform | null {
  const origin = worldToScreen({ ...layer, x: ZERO, y: ZERO }, view, frame, tuning);
  const unit = worldToScreen({ ...layer, x: ONE, y: ZERO }, view, frame, tuning);
  if (origin === null || unit === null) return null;
  return { scale: unit.x - origin.x, offset: origin };
}
