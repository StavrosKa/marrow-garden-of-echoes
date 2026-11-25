// App session tuning (design 2.6; Req 2.2, 9.4). The tests read the range and the fade length from the code,
// not from literals, except that the shipped values are checked as they are written.
import { TUNING as WORLD_TUNING } from 'world-view';
import { describe, expect, it } from 'vitest';
import {
  APP_SESSION_TUNING,
  headScaleOf,
  RATE_BIN_MS,
  REWARD_MAX_MS,
  REWARD_MIN_MS,
  validateAppSessionTuning,
  type AppSessionTuning,
} from './tuning';

const MIN_FADE = WORLD_TUNING.minFadeMs;

describe('app session tuning (tuning.test.ts)', () => {
  it('tuning shipped valid', () => {
    expect(validateAppSessionTuning(APP_SESSION_TUNING, MIN_FADE)).toEqual([]);
  });

  it('rewardToTravelMs outside 1000 to 2000 is rejected', () => {
    for (const reward of [REWARD_MIN_MS - 1, REWARD_MAX_MS + 1]) {
      const t: AppSessionTuning = { ...APP_SESSION_TUNING, rewardToTravelMs: reward };
      const issues = validateAppSessionTuning(t, MIN_FADE);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('rewardToTravelMs');
    }
    const edges: AppSessionTuning[] = [
      { ...APP_SESSION_TUNING, rewardToTravelMs: REWARD_MIN_MS },
      { ...APP_SESSION_TUNING, rewardToTravelMs: REWARD_MAX_MS },
    ];
    for (const t of edges) expect(validateAppSessionTuning(t, MIN_FADE)).toEqual([]);
  });

  it('entryTitleMs below twice minFadeMs is rejected', () => {
    const short: AppSessionTuning = { ...APP_SESSION_TUNING, entryTitleMs: 2 * MIN_FADE - 1 };
    const issues = validateAppSessionTuning(short, MIN_FADE);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('entryTitleMs');
    const exact: AppSessionTuning = { ...APP_SESSION_TUNING, entryTitleMs: 2 * MIN_FADE };
    expect(validateAppSessionTuning(exact, MIN_FADE)).toEqual([]);
  });

  it('a non-finite value is rejected', () => {
    const bad: AppSessionTuning[] = [
      { ...APP_SESSION_TUNING, rewardToTravelMs: Number.NaN },
      { ...APP_SESSION_TUNING, rewardToTravelMs: Number.POSITIVE_INFINITY },
      { ...APP_SESSION_TUNING, entryTitleMs: Number.NaN },
      { ...APP_SESSION_TUNING, entryTitleMs: Number.POSITIVE_INFINITY },
    ];
    for (const t of bad) {
      expect(validateAppSessionTuning(t, MIN_FADE).length).toBeGreaterThan(0);
    }
  });
  it('steering 8: gentleHeadScale must be a number from 0 to 1, and the shipped value is 0.5', () => {
    expect(APP_SESSION_TUNING.gentleHeadScale).toBe(0.5);
    for (const scale of [Number.NaN, -0.1, 1.1, Number.POSITIVE_INFINITY]) {
      const issues = validateAppSessionTuning({ ...APP_SESSION_TUNING, gentleHeadScale: scale }, MIN_FADE);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('gentleHeadScale');
    }
    for (const scale of [0, 1]) {
      expect(validateAppSessionTuning({ ...APP_SESSION_TUNING, gentleHeadScale: scale }, MIN_FADE)).toEqual([]);
    }
  });

  it('steering 8: the head scale is 1 in Full, the gentleHeadScale in Gentle, and 0 in Reduced', () => {
    expect(headScaleOf('full')).toBe(1);
    expect(headScaleOf('gentle')).toBe(APP_SESSION_TUNING.gentleHeadScale);
    expect(headScaleOf('gentle')).toBe(0.5);
    expect(headScaleOf('reduced')).toBe(0);
  });

  it('16.3: lowRateHz must be a positive number, and lowRateWindowMs a whole number of one-second bins', () => {
    const rateOff: AppSessionTuning[] = [
      { ...APP_SESSION_TUNING, lowRateHz: 0 },
      { ...APP_SESSION_TUNING, lowRateHz: -1 },
      { ...APP_SESSION_TUNING, lowRateHz: Number.NaN },
    ];
    for (const t of rateOff) {
      const issues = validateAppSessionTuning(t, MIN_FADE);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('lowRateHz');
    }
    const windowOff: AppSessionTuning[] = [
      { ...APP_SESSION_TUNING, lowRateWindowMs: 0 },
      { ...APP_SESSION_TUNING, lowRateWindowMs: 10500 },
      { ...APP_SESSION_TUNING, lowRateWindowMs: Number.POSITIVE_INFINITY },
    ];
    for (const t of windowOff) {
      const issues = validateAppSessionTuning(t, MIN_FADE);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('lowRateWindowMs');
    }
    expect(validateAppSessionTuning({ ...APP_SESSION_TUNING, lowRateWindowMs: RATE_BIN_MS }, MIN_FADE)).toEqual([]);
  });
});
