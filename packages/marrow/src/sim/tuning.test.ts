// The profile table of the simulator (requirements 19.3, 19.6). The rates below are the rows of the table in
// requirements.md 19.6, written as literals as the rule for requirement tables allows.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SIM_PROFILES, validateSimTuning, type SimProfile } from './tuning';

const TABLE: readonly (readonly [string, number])[] = [
  ['baseline', 0],
  ['limited-reach', 0.1],
  ['jitter', 0.1],
  ['slow', 0.2],
  ['one-hand', 0.1],
  ['tracking-gaps', 0.1],
  ['incorrect-answers', 0.5],
  ['adversarial', 1],
];

const row = (index: number): SimProfile => {
  const profile = SIM_PROFILES[index];
  if (profile === undefined) throw new Error(`no profile at ${index}`);
  return profile;
};

describe('the profile table (tuning.ts)', () => {
  it('19.6 the shipped table has the eight rows in table order, with the rates of the table', () => {
    expect(SIM_PROFILES.map((profile) => [profile.name, profile.wrongAnswerRate])).toEqual(TABLE);
  });

  it('19.6 validateSimTuning accepts the shipped table', () => {
    expect(validateSimTuning(SIM_PROFILES)).toEqual([]);
  });

  it('19.6 validateSimTuning rejects a missing profile', () => {
    const problems = validateSimTuning(SIM_PROFILES.slice(1));
    expect(problems).toContain('there must be 8 profiles, found 7');
  });

  it('19.6 validateSimTuning rejects a renamed profile', () => {
    const renamed = SIM_PROFILES.map((profile, index) =>
      index === 2 ? ({ ...profile, name: 'jittery' } as unknown as SimProfile) : profile,
    );
    expect(validateSimTuning(renamed)).toContain('profile 2 must be jitter, found jittery');
  });

  it('19.6 validateSimTuning rejects a duplicate profile name', () => {
    const duplicated = [...SIM_PROFILES.slice(0, 7), row(0)];
    const problems = validateSimTuning(duplicated);
    expect(problems).toContain('profile baseline appears more than once');
    expect(problems).toContain('profile 7 must be adversarial, found baseline');
  });

  it('19.6 validateSimTuning rejects a rate outside 0 to 1, and NaN', () => {
    for (const rate of [-0.1, 1.1, Number.NaN]) {
      const problems = validateSimTuning(SIM_PROFILES.map((profile, index) => (index === 0 ? { ...profile, wrongAnswerRate: rate } : profile)));
      expect(problems).toContain('baseline: wrongAnswerRate must be between 0 and 1');
    }
  });

  it('19.6 validateSimTuning rejects reachShare 0, a frame interval of 0 and a tracking gap no longer than its length', () => {
    const reach = SIM_PROFILES.map((profile, index) => (index === 1 ? { ...profile, reachShare: 0 } : profile));
    expect(validateSimTuning(reach)).toContain('limited-reach: reachShare must be above 0 and at most 1');
    const interval = SIM_PROFILES.map((profile, index) => (index === 3 ? { ...profile, frameIntervalMs: 0 } : profile));
    expect(validateSimTuning(interval)).toContain('slow: frameIntervalMs must be a positive, finite number of milliseconds');
    const gap = SIM_PROFILES.map((profile, index) =>
      index === 5 && profile.trackingGap !== null ? { ...profile, trackingGap: { everyMs: 400, lengthMs: 400 } } : profile,
    );
    expect(validateSimTuning(gap)).toContain('tracking-gaps: trackingGap needs everyMs greater than lengthMs, and lengthMs above 0');
  });

  it('19.6 validateSimTuning rejects every rate outside 0 to 1, whatever the value (300 cases)', () => {
    const outside = fc.oneof(
      fc.integer({ min: 101, max: 100000 }).map((n) => n / 100),
      fc.integer({ min: -100000, max: -1 }).map((n) => n / 100),
    );
    fc.assert(
      fc.property(outside, (rate) => {
        const problems = validateSimTuning(SIM_PROFILES.map((profile, index) => (index === 6 ? { ...profile, wrongAnswerRate: rate } : profile)));
        expect(problems).toContain('incorrect-answers: wrongAnswerRate must be between 0 and 1');
      }),
      { numRuns: 300 },
    );
  });
});
