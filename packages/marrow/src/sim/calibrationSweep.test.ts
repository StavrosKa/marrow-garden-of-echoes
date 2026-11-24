// The camera-space reach of a synthetic player during calibration (requirements 19.1, 19.6). The quarter test uses
// the same 4 standard deviation bound as the statistics of player.stats.test.ts.
import { describe, expect, it } from 'vitest';
import { seedRng } from '../challenges/rng';
import { sweepSamples } from './calibrationSweep';
import { SIM_PROFILES, type SimProfile } from './tuning';

const DRAWS = 10000;
const CENTRE = 0.5;

const named = (name: SimProfile['name']): SimProfile => {
  const profile = SIM_PROFILES.find((candidate) => candidate.name === name);
  if (profile === undefined) throw new Error(`no profile ${name}`);
  return profile;
};

describe('the calibration sweep (calibrationSweep.ts)', () => {
  it('19.1 sweepSamples gives the same samples for the same seed', () => {
    const profile = named('limited-reach');
    expect(sweepSamples(profile, seedRng(42), 300).samples).toEqual(sweepSamples(profile, seedRng(42), 300).samples);
  });

  it('19.1 every sample lies in the covered square of the profile, whose area is its reachShare', () => {
    const profile = named('limited-reach');
    const half = Math.sqrt(profile.reachShare) / 2;
    const { samples } = sweepSamples(profile, seedRng(42), 2000);
    expect(samples).toHaveLength(2000);
    for (const sample of samples) {
      expect(Math.abs(sample.x - CENTRE)).toBeLessThanOrEqual(half);
      expect(Math.abs(sample.y - CENTRE)).toBeLessThanOrEqual(half);
    }
  });

  it('19.6 limited-reach samples fill each quarter of the covered square evenly, within 4 standard deviations (10 000 draws)', () => {
    const profile = named('limited-reach');
    const { samples } = sweepSamples(profile, seedRng(42 + 1), DRAWS);
    const counts = [0, 0, 0, 0];
    for (const sample of samples) {
      const quarter = (sample.x < CENTRE ? 0 : 1) + (sample.y < CENTRE ? 0 : 2);
      counts[quarter] = (counts[quarter] ?? 0) + 1;
    }
    const mean = DRAWS / 4;
    const sigma = Math.sqrt(DRAWS * 0.25 * 0.75);
    for (const count of counts) {
      expect(Math.abs(count - mean)).toBeLessThanOrEqual(4 * sigma);
    }
  });

  it('19.1 a full-reach profile samples the whole frame', () => {
    const { samples } = sweepSamples(named('baseline'), seedRng(42), 2000);
    const xs = samples.map((sample) => sample.x);
    expect(Math.min(...xs)).toBeLessThan(0.05);
    expect(Math.max(...xs)).toBeGreaterThan(0.95);
  });
});
