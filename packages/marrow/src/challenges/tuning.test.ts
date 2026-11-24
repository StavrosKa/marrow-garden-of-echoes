import { describe, expect, it } from 'vitest';
import { TUNING } from '../core';
import { ATTENTION_TUNING, PRESENTATION_EXTRA_MS, validateAttentionTuning, type AttentionTuning } from './tuning';

/** The shipped values with some fields replaced. */
const withPatch = (patch: Partial<AttentionTuning>): AttentionTuning => ({ ...ATTENTION_TUNING, ...patch });

describe('attention tuning (tuning.ts)', () => {
  it('tuning shipped valid', () => {
    expect(validateAttentionTuning(ATTENTION_TUNING, TUNING)).toEqual([]);
  });

  it('rejects a Gentle let-pass window shorter than the Full one', () => {
    const problems = validateAttentionTuning(withPatch({ letPassWindowGentleMs: 3000 }), TUNING);
    expect(problems.join('\n')).toContain('letPassWindowGentleMs must be at least letPassWindowFullMs');
  });

  it('rejects a Gentle select window shorter than the Full one', () => {
    const problems = validateAttentionTuning(withPatch({ selectWindowGentleMs: 9000 }), TUNING);
    expect(problems.join('\n')).toContain('selectWindowGentleMs must be at least selectWindowFullMs');
  });

  it('rejects offerHelpAfterMistakes that differs from difficultiesBeforeHelp', () => {
    const problems = validateAttentionTuning(withPatch({ offerHelpAfterMistakes: TUNING.difficultiesBeforeHelp + 1 }), TUNING);
    expect(problems.join('\n')).toContain('offerHelpAfterMistakes must equal difficultiesBeforeHelp');
  });

  it('rejects forceCompleteAfterMistakes that is not greater than the offer', () => {
    const problems = validateAttentionTuning(
      withPatch({ forceCompleteAfterMistakes: ATTENTION_TUNING.offerHelpAfterMistakes }),
      TUNING,
    );
    expect(problems.join('\n')).toContain('forceCompleteAfterMistakes must be greater than offerHelpAfterMistakes');
  });

  it('rejects a let-pass window shorter than presentationMinMs', () => {
    const problems = validateAttentionTuning(
      withPatch({ letPassWindowFullMs: ATTENTION_TUNING.presentationMinMs - 1 }),
      TUNING,
    );
    expect(problems.join('\n')).toContain('letPassWindowFullMs must be at least presentationMinMs');
  });

  it('rejects a window that is not positive and finite', () => {
    const zero = validateAttentionTuning(withPatch({ demonstrationMs: 0 }), TUNING);
    expect(zero.join('\n')).toContain('demonstrationMs must be a positive, finite number of milliseconds');
    const notANumber = validateAttentionTuning(withPatch({ selectWindowFullMs: Number.NaN }), TUNING);
    expect(notANumber.join('\n')).toContain('selectWindowFullMs must be a positive, finite number of milliseconds');
  });

  it('rejects restingBandY outside 0 to 1', () => {
    expect(validateAttentionTuning(withPatch({ restingBandY: 1.5 }), TUNING).join('\n')).toContain('restingBandY');
    expect(validateAttentionTuning(withPatch({ restingBandY: -0.1 }), TUNING).join('\n')).toContain('restingBandY');
  });

  it('rejects presentationMinMs below dwellMs plus 1 s', () => {
    const below = TUNING.dwellMs + PRESENTATION_EXTRA_MS - 1;
    const problems = validateAttentionTuning(withPatch({ presentationMinMs: below }), TUNING);
    expect(problems.join('\n')).toContain('presentationMinMs must be at least dwellMs plus 1000');
    expect(validateAttentionTuning(withPatch({ presentationMinMs: below + 1 }), TUNING)).toEqual([]);
  });
});
