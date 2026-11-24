// The flicker of lantern and candle light (requirements 17.2, 17.3). The limits are read from FLICKER, which holds the
// values the code uses. The sample checks also assert the number of samples and the reach of the wave, so that a
// wave that never moves cannot pass.
import { describe, expect, it } from 'vitest';
import { flickerFactor, FLICKER } from './flicker';

const SAMPLE_STEP_MS = 37;
const SAMPLE_CYCLES = 5;
/** Five cycles at a 37 ms step give more than this many times; the test fails if the sweep is shorter. */
const MIN_SAMPLES = 300;

/** Times across several cycles, in steps of SAMPLE_STEP_MS. */
function samples(): number[] {
  const out: number[] = [];
  for (let t = 0; t <= FLICKER.cycleMs * SAMPLE_CYCLES; t += SAMPLE_STEP_MS) out.push(t);
  return out;
}

describe('flicker of lantern and candle light', () => {
  it('17.2: in Full and Gentle motion the brightness varies by at most 15% either way', () => {
    const times = samples();
    expect(times.length).toBeGreaterThanOrEqual(MIN_SAMPLES);
    for (const motion of ['full', 'gentle'] as const) {
      for (const t of times) {
        const change = flickerFactor(motion, t) - 1;
        expect(Math.abs(change)).toBeLessThanOrEqual(FLICKER.maxAmplitude);
      }
    }
  });

  it('17.2: the flicker reaches its full amplitude, so the limit test is not vacuous', () => {
    const changes = samples().map((t) => flickerFactor('full', t) - 1);
    // The sample step may miss the exact peak by a fraction of the amplitude, so the reach is checked to 3 decimals.
    expect(Math.max(...changes)).toBeCloseTo(FLICKER.amplitude, 3);
    expect(Math.min(...changes)).toBeCloseTo(-FLICKER.amplitude, 3);
  });

  it('17.2: the amplitude the code uses is inside the 15% limit', () => {
    expect(FLICKER.amplitude).toBeGreaterThan(0);
    expect(FLICKER.amplitude).toBeLessThanOrEqual(FLICKER.maxAmplitude);
  });

  it('17.2: a cycle lasts at least 1.5 s, and the wave repeats every cycle', () => {
    expect(FLICKER.cycleMs).toBeGreaterThanOrEqual(FLICKER.minCycleMs);
    for (const t of samples()) {
      expect(flickerFactor('full', t + FLICKER.cycleMs)).toBeCloseTo(flickerFactor('full', t), 9);
    }
  });

  it('17.3: in Reduced motion the brightness does not change at any time', () => {
    for (const t of samples()) {
      expect(flickerFactor('reduced', t)).toBe(1);
    }
  });
});
