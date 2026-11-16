import { describe, expect, it } from 'vitest';
import type { Vec2 } from './frame';
import { add, clamp, dist, lerp, scale, sub } from './geometry';

// The inputs and the expected results are exact in binary floating point, so they
// compare exactly. The inputs are frozen, so a helper that wrote to an argument
// would throw.
const a: Vec2 = Object.freeze({ x: 1.5, y: -2 });
const b: Vec2 = Object.freeze({ x: -0.25, y: 4 });

describe('geometry', () => {
  it('add adds each axis', () => {
    expect(add(a, b)).toEqual({ x: 1.25, y: 2 });
  });

  it('sub subtracts b from a', () => {
    expect(sub(a, b)).toEqual({ x: 1.75, y: -6 });
    expect(sub(b, a)).toEqual({ x: -1.75, y: 6 });
  });

  it('scale multiplies each axis by k', () => {
    expect(scale(a, 2)).toEqual({ x: 3, y: -4 });
    expect(scale(a, -0.5)).toEqual({ x: -0.75, y: 1 });
  });

  it('dist is the Euclidean distance, the same in both directions', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(dist(a, b)).toBe(6.25);
    expect(dist(b, a)).toBe(6.25);
    expect(dist(a, a)).toBe(0);
  });

  it('clamp limits a value to [lo, hi]', () => {
    expect(clamp(-3, 0, 1)).toBe(0);
    expect(clamp(3, 0, 1)).toBe(1);
    expect(clamp(0.25, 0, 1)).toBe(0.25);
    expect(clamp(0, 0, 1)).toBe(0);
    expect(clamp(1, 0, 1)).toBe(1);
    expect(clamp(-3, -2, -1)).toBe(-2);
  });

  it('clamp keeps NaN', () => {
    expect(clamp(NaN, 0, 1)).toBeNaN();
  });

  it('lerp goes from a at t = 0 to b at t = 1, and t is not clamped', () => {
    expect(lerp(a, b, 0)).toEqual(a);
    expect(lerp(a, b, 1)).toEqual(b);
    expect(lerp(a, b, 0.25)).toEqual({ x: 1.0625, y: -0.5 });
    expect(lerp(a, b, 2)).toEqual({ x: -2, y: 10 });
    expect(lerp(a, b, -1)).toEqual({ x: 3.25, y: -8 });
  });
});
