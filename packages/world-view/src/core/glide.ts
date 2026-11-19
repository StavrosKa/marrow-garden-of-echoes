// Glide (Req 5; design 4.1): the head offset that the layers follow. Each frame it moves a fraction of
// the way to the target, and each axis moves at most glideCapPerS head units per second.
import type { Vec2 } from 'marrow/core';
import { TUNING, type Tuning } from './tuning';

const ZERO = 0;
const ONE = 1;
/** Milliseconds in a second: the unit of glideCapPerS against the frame delta. A unit, not a tuning value. */
export const MS_PER_SECOND = 1000;

export interface GlideState {
  /** The glided head, in -1..1 on each axis. */
  readonly out: Vec2;
}

export function createGlide(): GlideState {
  return { out: { x: ZERO, y: ZERO } };
}

function clampUnit(value: number): number {
  return Math.min(ONE, Math.max(-ONE, value));
}

/** One axis: the weight of the exponential move, capped at `limit` in either direction. */
function glideAxis(out: number, target: number, weight: number, limit: number): number {
  const move = Math.min(limit, Math.max(-limit, (clampUnit(target) - out) * weight));
  return out + move;
}

/**
 * One step on the presence clock. The target is clamped to -1..1. Per axis the move is
 * `(target - out) * (1 - exp(-dt / glideTauMs))`, limited to `glideCapPerS * dt / 1000` (the cap of
 * this step's dt, not a fixed frame time). A delta that is zero, negative or not finite moves nothing.
 * There is no ease to centre and no landmark input: a lost head is the Head View's output going to 0.
 */
export function stepGlide(state: GlideState, targetHead: Vec2, dtMs: number, tuning: Tuning = TUNING): GlideState {
  if (!(dtMs > ZERO && Number.isFinite(dtMs))) return state;
  const weight = ONE - Math.exp(-dtMs / tuning.glideTauMs);
  const limit = (tuning.glideCapPerS * dtMs) / MS_PER_SECOND;
  return {
    out: {
      x: glideAxis(state.out.x, targetHead.x, weight, limit),
      y: glideAxis(state.out.y, targetHead.y, weight, limit),
    },
  };
}
