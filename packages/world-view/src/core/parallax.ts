// Parallax (Req 3, 9; design 2.2, 2.3): the screen shift of a layer for a head offset, the
// largest such shift, and the margin that the interaction layer can have from its rest place.
import type { Vec2 } from 'marrow/core';
import { TUNING, type Tuning } from './tuning';
import type { ProjectionFrame } from './types';

/**
 * The shift of a layer with the given factor, in screen units (Req 3.1, 3.7). A head to the
 * right of the screen (head.x > 0) shifts the layer to the left. The head never changes the
 * depth scale. The y component is -0 for head.y = 0, as in the worked example of design 2.4.
 */
export function parallaxShift(
  factor: number,
  head: Vec2,
  frame: ProjectionFrame,
  tuning: Tuning = TUNING,
): Vec2 {
  return {
    x: -head.x * factor * tuning.limitX * frame.aspect * frame.sceneScale,
    y: -head.y * factor * tuning.limitY * frame.sceneScale,
  };
}

/**
 * The largest absolute shift of a layer on each axis, for any head offset in -1..1 (Req 3.5).
 * Not exported from the entry point.
 */
export function maxParallaxShift(
  factor: number,
  frame: ProjectionFrame,
  tuning: Tuning = TUNING,
): Vec2 {
  return {
    x: factor * tuning.limitX * frame.aspect * frame.sceneScale,
    y: factor * tuning.limitY * frame.sceneScale,
  };
}

/**
 * The largest displacement of the interaction layer for any head offset in -1..1 on both
 * axes, in screen units (Req 9.1, 9.2). The Euclidean length, because the corner (1, 1) of the
 * head square is farther than either axis.
 */
export function parallaxMargin(
  sceneScale: number,
  aspect: number,
  tuning: Tuning = TUNING,
): number {
  return (
    sceneScale *
    Math.hypot(
      tuning.interactionFactor * tuning.limitX * aspect,
      tuning.interactionFactor * tuning.limitY,
    )
  );
}
