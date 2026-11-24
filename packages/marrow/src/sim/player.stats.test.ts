// The wrong-answer rate of each profile over 10 000 draws (requirement 19.6). Each profile draws from its own seed,
// 42 plus its index in the table, so the result is the same on every run. The bound is 4 standard deviations of
// the binomial count, two-sided: a generator that is correct fails it with a probability of about 6 in 100 000 for a
// random seed. A rate of 0 or 1 has no spread, so its count must be exact.
import { describe, expect, it } from 'vitest';
import { seedRng } from '../challenges/rng';
import { chooseFor } from './player';
import { SIM_PROFILES, type SimProfile } from './tuning';

const DRAWS = 10000;
const BASE_SEED = 42;
const BOUND_SIGMAS = 4;

/** Wrong answers in DRAWS presentations, alternating select and pass, from the profile's own seed. */
function wrongCount(profile: SimProfile, index: number): number {
  let rng = seedRng(BASE_SEED + index);
  let wrong = 0;
  for (let i = 0; i < DRAWS; i++) {
    const choice = chooseFor(profile, rng, i % 2 === 0 ? 'select' : 'pass');
    rng = choice.rng;
    if (choice.wrong) wrong++;
  }
  return wrong;
}

describe('the wrong-answer rates (player.ts, requirement 19.6)', () => {
  it.each(SIM_PROFILES.map((profile, index) => [profile.name, profile, index] as const))(
    '19.6 %s: the wrong-answer rate over 10 000 draws is within 4 standard deviations of the table rate',
    (_name, profile, index) => {
      const wrong = wrongCount(profile, index);
      const rate = profile.wrongAnswerRate;
      if (rate === 0) {
        expect(wrong).toBe(0);
        return;
      }
      if (rate === 1) {
        expect(wrong).toBe(DRAWS);
        return;
      }
      const mean = DRAWS * rate;
      const sigma = Math.sqrt(DRAWS * rate * (1 - rate));
      expect(Math.abs(wrong - mean)).toBeLessThanOrEqual(BOUND_SIGMAS * sigma);
    },
  );

  it('19.6 the table rates are the ones of requirement 19.6', () => {
    expect(SIM_PROFILES.map((profile) => profile.wrongAnswerRate)).toEqual([0, 0.1, 0.1, 0.2, 0.1, 0.1, 0.5, 1]);
  });
});
