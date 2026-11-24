import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nextUnit, seedRng, shuffle, type Rng } from './rng';

// Property runs use the same count as the core properties (help.properties.test.ts).
const RUNS = 300;

/** The first `count` values of a generator. */
function sequence(seed: number, count: number): number[] {
  const values: number[] = [];
  let rng: Rng = seedRng(seed);
  for (let i = 0; i < count; i++) {
    const draw = nextUnit(rng);
    values.push(draw.value);
    rng = draw.rng;
  }
  return values;
}

describe('seeded generator (rng.ts)', () => {
  it('the same seed gives the same sequence', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        expect(sequence(seed, 20)).toEqual(sequence(seed, 20));
      }),
      { numRuns: RUNS },
    );
    expect(sequence(42, 5)).toEqual(sequence(42, 5));
    expect(sequence(42, 5)).not.toEqual(sequence(43, 5));
  });

  it('nextUnit returns values in [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        for (const value of sequence(seed, 50)) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(1);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('shuffle returns a permutation of its input', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 30 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        (items, seed) => {
          const shuffled = shuffle(items, seedRng(seed)).items;
          expect([...shuffled].sort((a, b) => a - b)).toEqual([...items].sort((a, b) => a - b));
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('shuffle leaves its input array unchanged', () => {
    const items = [1, 2, 3, 4, 5];
    shuffle(items, seedRng(7));
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});
