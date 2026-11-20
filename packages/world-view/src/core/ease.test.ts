import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { smootherstep } from './ease';

const ZERO = 0;
const ONE = 1;
/** An input just below 1 for which the polynomial alone rounds above 1 (docs/bugs-found.md, the travel cover). */
const NEAR_ONE_INPUT = 0.999999986952898;
/** How close to 0 and to 1 the property also draws its inputs. */
const EDGE_WIDTH = 1e-6;

describe('smootherstep', () => {
  it('smootherstep output stays in 0..1: fixed input 0.999999986952898 (docs/bugs-found.md)', () => {
    const value = smootherstep(NEAR_ONE_INPUT);
    expect(value).toBeLessThanOrEqual(ONE);
    expect(value).toBeGreaterThanOrEqual(ZERO);
  });

  it('smootherstep output stays in 0..1: property over [0, 1] with inputs near 0 and near 1', () => {
    const input = fc.oneof(
      fc.double({ min: ZERO, max: ONE, noNaN: true }),
      fc.double({ min: ONE - EDGE_WIDTH, max: ONE, noNaN: true }),
      fc.double({ min: ZERO, max: ZERO + EDGE_WIDTH, noNaN: true }),
    );
    fc.assert(
      fc.property(input, (u) => {
        const value = smootherstep(u);
        return value >= ZERO && value <= ONE;
      }),
      { numRuns: 10000 },
    );
  });

  it('smootherstep endpoints are exact and the input is clamped', () => {
    expect(smootherstep(ZERO)).toBe(ZERO);
    expect(smootherstep(ONE)).toBe(ONE);
    expect(smootherstep(-ONE)).toBe(ZERO);
    expect(smootherstep(ONE + ONE)).toBe(ONE);
    expect(smootherstep(Number.NaN)).toBe(ZERO);
  });
});
