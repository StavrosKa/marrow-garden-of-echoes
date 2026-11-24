// App session tuning (garden-level design 2.6; requirements 2.2, 9.4). These are the session machine's own
// values. Each key carries one label: tune (a starting value, adjusted with a real camera) or rule (change
// only with the user's approval). The label format is the one tests/garden-tuning-labels.test.ts checks.

/** The session machine's timing values. */
export interface AppSessionTuning {
  readonly rewardToTravelMs: number; // 1500 tune (design 2.6; Req 2.2: travel starts 1 to 2 s after the reward)
  readonly entryTitleMs: number; // 4000 tune (new value: 600 ms fade in, 2800 ms held, 600 ms fade out)
}

/** The shipped values. Frozen, so a value changes here and never at runtime. */
export const APP_SESSION_TUNING: Readonly<AppSessionTuning> = Object.freeze({
  rewardToTravelMs: 1500, // tune
  entryTitleMs: 4000, // tune
});

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
  return issues;
}
