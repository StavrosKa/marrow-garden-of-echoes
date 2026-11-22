// The round progression of the playground (Req 26.9, 26.10, design section 14.3). roundController.ts starts the next
// round in the same step that completes the last target. The playground must show the last target completed first,
// so this module records each selection and starts the next round only once ROUND_PAUSE_MS of session time has
// passed. The session clock (design section 3, Req 16.7) stops in pauses and holds, so the wait does too.
import { openTargets, roundComplete, startRound, type RoundEnvironment, type RoundState } from './roundController';

/**
 * The session time between the selection that completes a round and the start of the next one. It must be at
 * least COMPLETE_EASE_MS, so the completed shape is fully eased when the round changes. App value, beside this code,
 * not in tuning.ts and not in Appendix B.
 */
export const ROUND_PAUSE_MS = 600;
/**
 * The session time over which a completed target eases to its completed shape (Req 26.9: at least 300 ms, which is
 * `uiMinLightEaseMs`). App value, beside this code, not in tuning.ts and not in Appendix B.
 */
export const COMPLETE_EASE_MS = 400;

export interface RoundProgress {
  /** The round on screen, or null before calibration completes. */
  readonly round: RoundState | null;
  /** The session time of each selection in the current round, by target id. */
  readonly completedAtMs: Readonly<Record<string, number>>;
  /** The session time at which the next round starts. Set when the last target of a round is selected. */
  readonly nextRoundAtMs: number | null;
}

export const NO_ROUND: RoundProgress = { round: null, completedAtMs: {}, nextRoundAtMs: null };

/** The first round after calibration (design section 14.3): nothing is avoided, and the cursor starts at 0. */
export function firstRound(env: RoundEnvironment): RoundProgress {
  return { round: startRound(null, env), completedAtMs: {}, nextRoundAtMs: null };
}

/**
 * Records the selection of an open target at `sessionMs`. A target that is not open is ignored, so a second selection
 * of the same target changes nothing. When this selection completes the round, the next round is due ROUND_PAUSE_MS
 * of session time later.
 */
export function recordSelection(progress: RoundProgress, targetId: string, sessionMs: number): RoundProgress {
  const { round } = progress;
  if (round === null || !openTargets(round).some((target) => target.id === targetId)) return progress;
  const next: RoundState = { ...round, completed: [...round.completed, targetId] };
  return {
    round: next,
    completedAtMs: { ...progress.completedAtMs, [targetId]: sessionMs },
    nextRoundAtMs: roundComplete(next) ? sessionMs + ROUND_PAUSE_MS : null,
  };
}

/** Starts the next round once its time has come. Before that, and with no round due, the progress is returned as it is. */
export function advanceRound(progress: RoundProgress, sessionMs: number, env: RoundEnvironment): RoundProgress {
  const { round, nextRoundAtMs } = progress;
  if (round === null || nextRoundAtMs === null || sessionMs < nextRoundAtMs) return progress;
  return { round: startRound(round, env), completedAtMs: {}, nextRoundAtMs: null };
}
