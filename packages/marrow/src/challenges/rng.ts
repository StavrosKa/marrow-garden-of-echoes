// The seeded generator of the attention round (garden-level design section 2.1).
// It is a value: each draw returns the next generator, and no module keeps a hidden
// state. It reads no clock and no Math.random, so the same seed gives the same draws.
// The algorithm is mulberry32.

/** A generator state. Pass it to the next draw. */
export interface Rng {
  readonly state: number;
}

/** A generator for `seed`. Any number is accepted; it is read as an unsigned 32-bit integer. */
export function seedRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

/** The next value in [0, 1), and the generator after that draw. */
export function nextUnit(rng: Rng): { readonly value: number; readonly rng: Rng } {
  const state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, rng: { state } };
}

/**
 * A permutation of `items` (Fisher-Yates with the draws of nextUnit), and the generator after
 * the draws. The input array is not changed.
 */
export function shuffle<T>(items: readonly T[], rng: Rng): { readonly items: readonly T[]; readonly rng: Rng } {
  const out = [...items];
  let current = rng;
  for (let i = out.length - 1; i > 0; i--) {
    const draw = nextUnit(current);
    current = draw.rng;
    const j = Math.floor(draw.value * (i + 1));
    const swap = out[i] as T;
    out[i] = out[j] as T;
    out[j] = swap;
  }
  return { items: out, rng: current };
}
