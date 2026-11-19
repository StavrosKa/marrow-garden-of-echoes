// Smootherstep: 6u^5 - 15u^4 + 10u^3, written in Horner form as
// u^3 * (u * (A * u - B) + C), so no exponent literal is needed.
const ZERO = 0;
const ONE = 1;
const SMOOTHERSTEP_A = 6;
const SMOOTHERSTEP_B = 15;
const SMOOTHERSTEP_C = 10;

/** Smootherstep of `u`, with `u` clamped to 0..1 (NaN counts as 0). Zero slope at both ends. */
export function smootherstep(u: number): number {
  const x = !(u > ZERO) ? ZERO : u >= ONE ? ONE : u;
  return x * x * x * (x * (x * SMOOTHERSTEP_A - SMOOTHERSTEP_B) + SMOOTHERSTEP_C);
}
