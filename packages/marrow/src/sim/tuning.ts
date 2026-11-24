// The synthetic player profiles of the simulator (garden-level design 2.5; requirements 19.3, 19.6). Each key
// carries one label: tune (a starting value, adjusted with a real camera) or rule (change only with the user's
// approval). The label format is the one tests/garden-tuning-labels.test.ts checks: every interface member has
// its label after its value, and every property of every row has its label on its own line.

/** The names of the eight profiles of requirement 19.6. */
export type ProfileName =
  | 'baseline'
  | 'limited-reach'
  | 'jitter'
  | 'slow'
  | 'one-hand'
  | 'tracking-gaps'
  | 'incorrect-answers'
  | 'adversarial';

/** A gap in tracking: the right wrist is invalid for `lengthMs` in every `everyMs`. */
export interface TrackingGap {
  readonly everyMs: number; // 8000 tune (steering 6; a gap every 8 s)
  readonly lengthMs: number; // 400 tune (steering 6; longer than trackingHoldAfterMs)
}

/** One synthetic player. Every number of the simulator's profiles is a field here. */
export interface SimProfile {
  readonly name: ProfileName; // baseline rule: change only with the user's approval (requirements 19.6, the name of the row)
  readonly wrongAnswerRate: number; // 0 rule: change only with the user's approval (requirements 19.6, the rate of each profile)
  readonly reachShare: number; // 1 tune (design 2.5; 0.5 for limited-reach)
  readonly jitterShare: number; // 0 tune (design 2.5; 0.02 for jitter)
  readonly frameIntervalMs: number; // 50 tune (design 5.2; 143 for slow)
  readonly oneHand: boolean; // false rule: change only with the user's approval (requirements 19.3)
  readonly trackingGap: TrackingGap | null; // null tune (steering 6)
}

/** The shipped profiles, in the order of the table of requirement 19.6. */
export const SIM_PROFILES: readonly SimProfile[] = Object.freeze([
  {
    name: 'baseline', // rule: change only with the user's approval
    wrongAnswerRate: 0, // rule: change only with the user's approval
    reachShare: 1, // tune
    jitterShare: 0, // tune
    frameIntervalMs: 50, // tune
    oneHand: false, // rule: change only with the user's approval
    trackingGap: null, // tune
  },
  {
    name: 'limited-reach', // rule: change only with the user's approval
    wrongAnswerRate: 0.1, // rule: change only with the user's approval
    reachShare: 0.5, // tune
    jitterShare: 0, // tune
    frameIntervalMs: 50, // tune
    oneHand: false, // rule: change only with the user's approval
    trackingGap: null, // tune
  },
  {
    name: 'jitter', // rule: change only with the user's approval
    wrongAnswerRate: 0.1, // rule: change only with the user's approval
    reachShare: 1, // tune
    jitterShare: 0.02, // tune
    frameIntervalMs: 50, // tune
    oneHand: false, // rule: change only with the user's approval
    trackingGap: null, // tune
  },
  {
    name: 'slow', // rule: change only with the user's approval
    wrongAnswerRate: 0.2, // rule: change only with the user's approval
    reachShare: 1, // tune
    jitterShare: 0, // tune
    frameIntervalMs: 143, // tune
    oneHand: false, // rule: change only with the user's approval
    trackingGap: null, // tune
  },
  {
    name: 'one-hand', // rule: change only with the user's approval
    wrongAnswerRate: 0.1, // rule: change only with the user's approval
    reachShare: 1, // tune
    jitterShare: 0, // tune
    frameIntervalMs: 50, // tune
    oneHand: true, // rule: change only with the user's approval
    trackingGap: null, // tune
  },
  {
    name: 'tracking-gaps', // rule: change only with the user's approval
    wrongAnswerRate: 0.1, // rule: change only with the user's approval
    reachShare: 1, // tune
    jitterShare: 0, // tune
    frameIntervalMs: 50, // tune
    oneHand: false, // rule: change only with the user's approval
    trackingGap: {
      everyMs: 8000, // tune
      lengthMs: 400, // tune
    }, // tune
  },
  {
    name: 'incorrect-answers', // rule: change only with the user's approval
    wrongAnswerRate: 0.5, // rule: change only with the user's approval
    reachShare: 1, // tune
    jitterShare: 0, // tune
    frameIntervalMs: 50, // tune
    oneHand: false, // rule: change only with the user's approval
    trackingGap: null, // tune
  },
  {
    name: 'adversarial', // rule: change only with the user's approval
    wrongAnswerRate: 1, // rule: change only with the user's approval
    reachShare: 1, // tune
    jitterShare: 0, // tune
    frameIntervalMs: 50, // tune
    oneHand: false, // rule: change only with the user's approval
    trackingGap: null, // tune
  },
]);

/** The required names, in table order. */
const ORDER: readonly ProfileName[] = [
  'baseline',
  'limited-reach',
  'jitter',
  'slow',
  'one-hand',
  'tracking-gaps',
  'incorrect-answers',
  'adversarial',
];

function isFraction(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/** One line per problem with the profiles, or an empty list. The rates are checked against the table by the tests. */
export function validateSimTuning(profiles: readonly SimProfile[]): string[] {
  const problems: string[] = [];
  if (profiles.length !== ORDER.length) {
    problems.push(`there must be ${ORDER.length} profiles, found ${profiles.length}`);
  }
  const seen = new Set<string>();
  profiles.forEach((profile, index) => {
    const expected = ORDER[index];
    if (expected !== undefined && profile.name !== expected) {
      problems.push(`profile ${index} must be ${expected}, found ${profile.name}`);
    }
    if (seen.has(profile.name)) problems.push(`profile ${profile.name} appears more than once`);
    seen.add(profile.name);
    const where = profile.name;
    if (!isFraction(profile.wrongAnswerRate)) problems.push(`${where}: wrongAnswerRate must be between 0 and 1`);
    if (!(Number.isFinite(profile.reachShare) && profile.reachShare > 0 && profile.reachShare <= 1)) {
      problems.push(`${where}: reachShare must be above 0 and at most 1`);
    }
    if (!(Number.isFinite(profile.jitterShare) && profile.jitterShare >= 0 && profile.jitterShare < 1)) {
      problems.push(`${where}: jitterShare must be at least 0 and below 1`);
    }
    if (!(Number.isFinite(profile.frameIntervalMs) && profile.frameIntervalMs > 0)) {
      problems.push(`${where}: frameIntervalMs must be a positive, finite number of milliseconds`);
    }
    if (typeof profile.oneHand !== 'boolean') problems.push(`${where}: oneHand must be a boolean`);
    const gap = profile.trackingGap;
    if (gap !== null && !(gap.lengthMs > 0 && gap.everyMs > gap.lengthMs && Number.isFinite(gap.everyMs))) {
      problems.push(`${where}: trackingGap needs everyMs greater than lengthMs, and lengthMs above 0`);
    }
  });
  return problems;
}
