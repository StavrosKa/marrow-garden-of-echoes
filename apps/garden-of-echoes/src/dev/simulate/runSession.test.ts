// One headless session (requirements 19.1, 19.2, 19.5). Each run plays the real session through stepGarden. The
// property runs 20 cases, because each case is a whole session (design section 6).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SIM_PROFILES, type SimProfile } from 'marrow/sim';
import { runSession } from './runSession';

const MAX_STEPS = 20000;
const RUN_TIMEOUT_MS = 120000;

const baselineOrNull = SIM_PROFILES[0];
if (baselineOrNull === undefined) throw new Error('no baseline profile');
const baseline: SimProfile = baselineOrNull;

describe('one headless session (runSession.ts)', () => {
  it('19.1 19.2 baseline with seed 42 completes the placeholder session, with no violation', () => {
    const summary = runSession(baseline, 42, { maxSteps: MAX_STEPS });
    expect(summary).toEqual({ profile: 'baseline', seed: 42, completed: true, helpStepsUsed: 0, violations: [] });
  });

  it('19.1 the same seed gives the same run summary', () => {
    const first = runSession(baseline, 42, { maxSteps: MAX_STEPS });
    const second = runSession(baseline, 42, { maxSteps: MAX_STEPS });
    expect(second).toEqual(first);
  });

  it('19.5 a run that exceeds maxSteps is not completed, and the budget is not a violation', () => {
    const summary = runSession(baseline, 42, { maxSteps: 100 });
    expect(summary.completed).toBe(false);
    expect(summary.violations).toEqual([]);
  });

  it(
    '19.5 random seeds complete with the baseline profile, with no violation (20 cases)',
    () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 4294967295 }), (seed) => {
          const summary = runSession(baseline, seed, { maxSteps: MAX_STEPS });
          expect(summary.completed).toBe(true);
          expect(summary.violations).toEqual([]);
        }),
        { numRuns: 20 },
      );
    },
    RUN_TIMEOUT_MS,
  );
});
