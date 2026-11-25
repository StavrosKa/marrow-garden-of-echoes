// App session tuning (garden-level design 2.6; requirements 2.2, 9.4). These are the session machine's own
// values. Each key carries one label: tune (a starting value, adjusted with a real camera) or rule (change
// only with the user's approval). The label format is the one tests/garden-tuning-labels.test.ts checks.

import type { MotionLevel } from 'marrow/core';

/** The session machine's timing values. */
export interface AppSessionTuning {
  readonly rewardToTravelMs: number; // 1500 tune (design 2.6; Req 2.2: travel starts 1 to 2 s after the reward)
  readonly entryTitleMs: number; // 4000 tune (new value: 600 ms fade in, 2800 ms held, 600 ms fade out)
  readonly lowRateHz: number; // 5 tune (requirements 16.2: the hint is due when the median delivered rate is below this)
  readonly lowRateWindowMs: number; // 10000 tune (requirements 16.2: the median is taken over this window)
  readonly gentleHeadScale: number; // 0.5 rule: change only with the user's approval (steering 8: Gentle head offsets x0.5)
}

/** The length of one bin of the delivered-rate watch: frames are counted per second (Req 16.2). */
export const RATE_BIN_MS = 1000;

/** The shipped values. Frozen, so a value changes here and never at runtime. */
export const APP_SESSION_TUNING: Readonly<AppSessionTuning> = Object.freeze({
  rewardToTravelMs: 1500, // tune
  entryTitleMs: 4000, // tune
  lowRateHz: 5, // tune
  lowRateWindowMs: 10000, // tune
  gentleHeadScale: 0.5, // rule: change only with the user's approval
});

/** The head offset's scale by motion level (steering 8): Full keeps the offset, Gentle halves it, Reduced has none. */
export function headScaleOf(motion: MotionLevel, tuning: Pick<AppSessionTuning, 'gentleHeadScale'> = APP_SESSION_TUNING): number {
  if (motion === 'full') return 1;
  if (motion === 'gentle') return tuning.gentleHeadScale;
  return 0;
}

/** The allowed range of rewardToTravelMs (Req 2.2). */
export const REWARD_MIN_MS = 1000;
export const REWARD_MAX_MS = 2000;

/** The title fades twice: once in and once out (Req 9.4). */
const TITLE_FADES = 2;

/**
 * The problems of an app session tuning, one line each. An empty array means valid. `minFadeMs` is the
 * world-view fade length, which the entry title must cover twice (in and out).
 */
export function validateAppSessionTuning(t: AppSessionTuning, minFadeMs: number): string[] {
  const issues: string[] = [];
  const reward = t.rewardToTravelMs;
  if (!(Number.isFinite(reward) && reward >= REWARD_MIN_MS && reward <= REWARD_MAX_MS)) {
    issues.push(`rewardToTravelMs = ${reward} is out of range [${REWARD_MIN_MS}, ${REWARD_MAX_MS}]`);
  }
  const titleMin = TITLE_FADES * minFadeMs;
  if (!(Number.isFinite(t.entryTitleMs) && t.entryTitleMs >= titleMin)) {
    issues.push(`entryTitleMs = ${t.entryTitleMs} must be at least ${titleMin}, two fades of minFadeMs = ${minFadeMs}`);
  }
  if (!(Number.isFinite(t.lowRateHz) && t.lowRateHz > 0)) {
    issues.push(`lowRateHz = ${t.lowRateHz} must be a positive number of frames per second`);
  }
  const windowMs = t.lowRateWindowMs;
  if (!(Number.isFinite(windowMs) && windowMs >= RATE_BIN_MS && windowMs % RATE_BIN_MS === 0)) {
    issues.push(`lowRateWindowMs = ${windowMs} must be a whole number of ${RATE_BIN_MS} ms bins`);
  }
  if (!(Number.isFinite(t.gentleHeadScale) && t.gentleHeadScale >= 0 && t.gentleHeadScale <= 1)) {
    issues.push(`gentleHeadScale = ${t.gentleHeadScale} must be a number from 0 to 1`);
  }
  return issues;
}
