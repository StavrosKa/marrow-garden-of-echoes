// The screen image of a target (Req 10.4; design 2.1): the one place that turns a world point
// and a hit radius into a hit circle and a drawn position, so the two cannot differ.
import type { Vec2 } from 'marrow/core';
import { depthScale, worldToScreen } from './projection';
import { TUNING, type Tuning } from './tuning';
import type { ProjectionFrame, View, WorldPoint } from './types';

/** Where a target is on the screen: its centre, its hit radius and its depth scale. */
export interface ScreenTarget {
  readonly position: Vec2;
  /** `r * scale`. */
  readonly radius: number;
  readonly scale: number;
}

/**
 * The screen image of a target of hit radius `r`, or null if its layer is culled.
 * Calls worldToScreen once and depthScale once: the position is the one the display object
 * gets, and the radius and the scale come from the same depth scale.
 */
export function targetScreen(
  point: WorldPoint,
  r: number,
  view: View,
  frame: ProjectionFrame,
  tuning: Tuning = TUNING,
): ScreenTarget | null {
  const position = worldToScreen(point, view, frame, tuning);
  if (position === null) return null;
  const scale = depthScale(point, view.travel);
  return { position, radius: r * scale, scale };
}
