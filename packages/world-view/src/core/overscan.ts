// Overscan (Req 4; design 2.3): how far a layer must extend past the viewport so that no
// edge shows at any head offset or travel distance.
import { maxParallaxShift } from './parallax';
import { depthScale, isCulled } from './projection';
import { TUNING, type Tuning } from './tuning';
import type { LayerRef, ProjectionFrame, Rect } from './types';
import type { Vec2 } from 'marrow/core';
import type { ValidationIssue } from './issues';

const ZERO = 0;
const ONE = 1;
const HALF = 0.5;

/** A range of travel distances, `from <= to`. */
export interface TravelRange {
  readonly from: number;
  readonly to: number;
}

/**
 * How far a shape of a layer must extend past a viewport edge it touches at rest: the largest
 * parallax shift of the layer on each axis, in screen units (Req 4.3).
 */
export function edgeOverscan(
  layer: Pick<LayerRef, 'factor'>,
  frame: ProjectionFrame,
  tuning: Tuning = TUNING,
): Vec2 {
  return maxParallaxShift(layer.factor, frame, tuning);
}

/**
 * The smallest rectangle, in layer units, whose screen image covers the viewport
 * `[0, A] x [0, 1]` for every travel in `range` and every head offset in -1..1 (Req 4.2). The
 * depth scale grows with travel, so the smallest scale of the range is the one at `range.from`.
 * When it is at least 1 the rectangle is the viewport grown by the overscan; below 1 it is larger.
 * If the layer is already culled at `range.from` nothing of it is drawn in the range, and the
 * viewport grown by the overscan is returned.
 */
export function backdropRect(
  layer: LayerRef,
  range: TravelRange,
  frame: ProjectionFrame,
  tuning: Tuning = TUNING,
): Rect {
  const { x: ex, y: ey } = edgeOverscan(layer, frame, tuning);
  const vx = frame.aspect * HALF;
  const vy = tuning.vanishingPointY;
  if (isCulled(layer, range.from, tuning)) {
    return { x0: -ex, y0: -ey, x1: frame.aspect + ex, y1: ONE + ey };
  }
  const sMin = depthScale(layer, range.from);
  return {
    x0: Math.min(-ex, vx - (vx + ex) / sMin),
    y0: Math.min(-ey, vy - (vy + ey) / sMin),
    x1: Math.max(frame.aspect + ex, vx + (frame.aspect - vx + ex) / sMin),
    y1: Math.max(ONE + ey, vy + (ONE - vy + ey) / sMin),
  };
}

/**
 * The checks of Req 4.3 for the bounds of one shape of a non-backdrop layer, in unit
 * coordinates (`x0`, `x1` are fractions of the width, `y0`, `y1` of the height; the issue
 * paths call them u0, u1, v0, v1). A side that touches or passes the viewport edge (`u0 <= 0`,
 * `u1 >= 1`, `v0 <= 0`, `v1 >= 1`) must extend past it by at least the overscan of the layer.
 * The overscan is taken at aspect 1, so the check does not depend on the aspect.
 */
export function shapeOverscanIssues(
  bounds: Rect,
  layer: Pick<LayerRef, 'factor'>,
  sceneScale: number,
  tuning: Tuning = TUNING,
): ValidationIssue[] {
  const { x: ex, y: ey } = edgeOverscan(layer, { aspect: ONE, sceneScale }, tuning);
  const issues: ValidationIssue[] = [];
  const check = (path: string, value: number, touches: boolean, needed: number, ok: boolean): void => {
    if (!touches || ok) return;
    issues.push({
      path,
      value,
      message: `${path} = ${value} reaches the viewport edge but must extend to ${needed} (edgeOverscan)`,
    });
  };
  check('u0', bounds.x0, bounds.x0 <= ZERO, -ex, bounds.x0 <= -ex);
  check('v0', bounds.y0, bounds.y0 <= ZERO, -ey, bounds.y0 <= -ey);
  check('u1', bounds.x1, bounds.x1 >= ONE, ONE + ex, bounds.x1 >= ONE + ex);
  check('v1', bounds.y1, bounds.y1 >= ONE, ONE + ey, bounds.y1 >= ONE + ey);
  return issues;
}
