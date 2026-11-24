// The numbers of the attention round and the resting band (garden-level design section
// 2.2, and the table "Tuning values introduced by this spec" in requirements.md). Each key
// carries one label, as in packages/marrow/src/core/tuning.ts:
//   tune: a starting value, adjusted with a real camera.
//   rule: change only with the user's approval.
// The attention logic reads these numbers from here and writes no literal for them.
import type { Tuning } from '../core';

/** The second part of the presentation minimum: the 1.5 s dwell plus this (requirements 6.4). */
export const PRESENTATION_EXTRA_MS = 1000; // rule: change only with the user's approval (requirements 6.4: 1 s after the dwell)

export interface AttentionTuning {
  readonly presentationMinMs: number; // 2500 rule: change only with the user's approval (requirements 6.4; dwell 1.5 s plus 1 s)
  readonly demonstrationMs: number; // 3000 tune (design 2.2)
  readonly letPassWindowFullMs: number; // 4000 tune (requirements table)
  readonly letPassWindowGentleMs: number; // 6000 tune (requirements table)
  readonly selectWindowFullMs: number; // 10000 tune (requirements table)
  readonly selectWindowGentleMs: number; // 15000 tune (requirements table)
  readonly offerHelpAfterMistakes: number; // 2 tune (requirements table; must equal core difficultiesBeforeHelp)
  readonly forceCompleteAfterMistakes: number; // 3 tune (requirements table; greater than the offer)
  readonly restingBandY: number; // 0.75 tune (requirements table; camera frame, normalized y)
}

export const ATTENTION_TUNING: Readonly<AttentionTuning> = Object.freeze({
  presentationMinMs: 2500, // rule: change only with the user's approval
  demonstrationMs: 3000, // tune
  letPassWindowFullMs: 4000, // tune
  letPassWindowGentleMs: 6000, // tune
  selectWindowFullMs: 10000, // tune
  selectWindowGentleMs: 15000, // tune
  offerHelpAfterMistakes: 2, // tune
  forceCompleteAfterMistakes: 3, // tune
  restingBandY: 0.75, // tune
});

const TIME_KEYS = [
  'presentationMinMs',
  'demonstrationMs',
  'letPassWindowFullMs',
  'letPassWindowGentleMs',
  'selectWindowFullMs',
  'selectWindowGentleMs',
] as const;

/**
 * One line per problem with the attention numbers, or an empty list. `core` supplies the dwell and
 * the help threshold that these numbers must agree with.
 */
export function validateAttentionTuning(t: AttentionTuning, core: Tuning): string[] {
  const problems: string[] = [];
  for (const key of TIME_KEYS) {
    if (!(Number.isFinite(t[key]) && t[key] > 0)) {
      problems.push(`${key} must be a positive, finite number of milliseconds`);
    }
  }
  const minimum = core.dwellMs + PRESENTATION_EXTRA_MS;
  if (Number.isFinite(t.presentationMinMs) && t.presentationMinMs < minimum) {
    problems.push(`presentationMinMs must be at least dwellMs plus ${PRESENTATION_EXTRA_MS}, which is ${minimum}`);
  }
  if (t.letPassWindowFullMs < t.presentationMinMs) {
    problems.push('letPassWindowFullMs must be at least presentationMinMs');
  }
  if (t.letPassWindowGentleMs < t.presentationMinMs) {
    problems.push('letPassWindowGentleMs must be at least presentationMinMs');
  }
  if (t.letPassWindowGentleMs < t.letPassWindowFullMs) {
    problems.push('letPassWindowGentleMs must be at least letPassWindowFullMs');
  }
  if (t.selectWindowGentleMs < t.selectWindowFullMs) {
    problems.push('selectWindowGentleMs must be at least selectWindowFullMs');
  }
  if (t.offerHelpAfterMistakes !== core.difficultiesBeforeHelp) {
    problems.push(`offerHelpAfterMistakes must equal difficultiesBeforeHelp, which is ${core.difficultiesBeforeHelp}`);
  }
  if (t.forceCompleteAfterMistakes <= t.offerHelpAfterMistakes) {
    problems.push('forceCompleteAfterMistakes must be greater than offerHelpAfterMistakes');
  }
  if (!(Number.isFinite(t.restingBandY) && t.restingBandY >= 0 && t.restingBandY <= 1)) {
    problems.push('restingBandY must be between 0 and 1');
  }
  return problems;
}
