// Small vector helpers for the core (design section 1). Internal: reached by
// relative import inside packages/marrow, not exported from marrow/core.
import type { Vec2 } from './frame';

/** The Euclidean distance between a and b. */
export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** v limited to [lo, hi], for lo <= hi. NaN stays NaN. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** a + b. */
export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** a - b. */
export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** a times the number k. */
export function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

/**
 * a + (b - a) * t on each axis: exactly a at t = 0, and b at t = 1 up to rounding.
 * t is not clamped. This is the form of the smoothing step in Req 9.4.
 */
export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
