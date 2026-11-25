// One headless session (requirements 19.1 to 19.7). Each run plays the real session through stepGarden, with the real
// machine and the stage rules. The property runs 20 cases, because each case is a whole session (design section 6).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TUNING } from 'marrow/core';
import { SIM_PROFILES, type SimProfile } from 'marrow/sim';
import { runSession, runSessionDetailed } from './runSession';

const MAX_STEPS = 20000;
const RUN_TIMEOUT_MS = 240000;

const baselineOrNull = SIM_PROFILES[0];
if (baselineOrNull === undefined) throw new Error('no baseline profile');
const baseline: SimProfile = baselineOrNull;

function profileNamed(name: string): SimProfile {
  const found = SIM_PROFILES.find((profile) => profile.name === name);
  if (found === undefined) throw new Error(`no profile ${name}`);
  return found;
}

describe('one headless session (runSession.ts)', () => {
  it('19.1 19.2 baseline with seed 42 completes the session, with no violation and no help', () => {
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

describe('every profile completes for seed 42 (9.1)', () => {
  it.each(SIM_PROFILES.map((profile) => [profile.name, profile] as const))(
    '%s completes with no violation',
    (_name, profile) => {
      const summary = runSession(profile, 42, { maxSteps: MAX_STEPS });
      expect(summary.completed).toBe(true);
      expect(summary.violations).toEqual([]);
    },
    RUN_TIMEOUT_MS,
  );

  it('9.1 the stages are played by their rules: the lanterns, the spirit round, the path round, the hall and Bloom are five placements', () => {
    const run = runSessionDetailed(baseline, 42, { maxSteps: MAX_STEPS });
    expect(run.stats.placements).toBe(5);
  });

  it('9.1 invariant 2: the pause probe fires once in every profile, and the tracking-gaps profile takes a hold and a probe', () => {
    for (const profile of SIM_PROFILES) {
      const run = runSessionDetailed(profile, 42, { maxSteps: MAX_STEPS });
      expect(run.stats.pauseProbes).toBe(1);
    }
    const gaps = runSessionDetailed(profileNamed('tracking-gaps'), 42, { maxSteps: MAX_STEPS });
    expect(gaps.stats.holdFrames).toBeGreaterThan(0);
    expect(gaps.stats.holdProbes).toBe(1);
  });

  it('9.1 invariant 5: the adversarial profile changes a help level inside a round', () => {
    const run = runSessionDetailed(profileNamed('adversarial'), 42, { maxSteps: MAX_STEPS });
    expect(run.stats.liveLevelChanges).toBeGreaterThan(0);
  });

  it('9.1 baseline makes no mistake, so it needs no help', () => {
    const run = runSessionDetailed(baseline, 42, { maxSteps: MAX_STEPS });
    expect(run.stats.mistakes).toBe(0);
    expect(run.summary.helpStepsUsed).toBe(0);
  });
});

describe('the adversarial and the slow profiles (9.2)', () => {
  it('9.2 the adversarial profile completes through help, well inside the step budget, with no violation', () => {
    const run = runSessionDetailed(profileNamed('adversarial'), 42, { maxSteps: MAX_STEPS });
    expect(run.summary.completed).toBe(true);
    expect(run.summary.helpStepsUsed).toBeGreaterThan(0);
    expect(run.summary.violations).toEqual([]);
    expect(run.stats.steps).toBeLessThan(MAX_STEPS / 4);
  });

  it('9.2 the slow profile completes with no violation, and its frames reach the 100 ms clamp', () => {
    const run = runSessionDetailed(profileNamed('slow'), 42, { maxSteps: MAX_STEPS });
    expect(run.summary.completed).toBe(true);
    expect(run.summary.violations).toEqual([]);
    expect(run.stats.maxSessionDtMs).toBe(TUNING.maxClockStepMs);
  });
});
