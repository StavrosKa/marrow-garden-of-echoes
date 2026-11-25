// The delivered-rate watch (garden-level requirement 16.2). Pure: it takes the presence time of a frame and the number of
// new pose frames delivered in it, and it says when the quiet hint "More light, face the window." is due. The hint is due
// once per session, when the median delivered rate over the window is below the threshold of session/tuning.ts. The watch
// reads no clock: time arrives as dtMs (Req 23.2). It never changes a target size (Req 16.1): it only counts frames.
import { APP_SESSION_TUNING, RATE_BIN_MS, type AppSessionTuning } from './tuning';

export interface LowRateState {
  /** The counts of the last complete bins, oldest first. At most one window of bins is kept. */
  readonly bins: readonly number[];
  /** The frames counted in the bin in progress. */
  readonly count: number;
  /** The time spent in the bin in progress, in ms. */
  readonly elapsedMs: number;
  /** The hint has been due once in this session, so it is never due again. */
  readonly hinted: boolean;
  /** The hint is due and nobody has taken it yet. */
  readonly due: boolean;
}

export interface LowRateInput {
  /** The presence time of this frame, in ms. A value that is not finite or is 0 or less adds no time. */
  readonly dtMs: number;
  /** The number of new pose frames delivered in this frame. */
  readonly delivered: number;
}

export function createLowRate(): LowRateState {
  return { bins: [], count: 0, elapsedMs: 0, hinted: false, due: false };
}

/** The median of a list of counts. For an even length, the mean of the two middle counts. The list must not be empty. */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * One step of the watch. Frames go into the bin in progress. Each full bin of time closes a bin. Once the window holds a
 * full set of bins, the hint is due when the median of the bins is below the threshold. A burst of frames does not hide
 * a low median.
 */
export function stepLowRate(
  state: LowRateState,
  input: LowRateInput,
  tuning: Pick<AppSessionTuning, 'lowRateHz' | 'lowRateWindowMs'> = APP_SESSION_TUNING,
): LowRateState {
  const dt = Number.isFinite(input.dtMs) && input.dtMs > 0 ? input.dtMs : 0;
  const delivered = Number.isFinite(input.delivered) && input.delivered > 0 ? input.delivered : 0;
  const windowBins = Math.round(tuning.lowRateWindowMs / RATE_BIN_MS);
  let count = state.count + delivered;
  let bins = state.bins;
  const elapsed = state.elapsedMs + dt;
  const full = Math.floor(elapsed / RATE_BIN_MS);
  if (full > 0) {
    // The bin in progress closes first, then each later full bin is empty. The zeros are capped at one window, so a long
    // dt costs no more than a window.
    const zeros = Math.min(full - 1, windowBins);
    bins = [...bins, count, ...new Array<number>(zeros).fill(0)].slice(-windowBins);
    count = 0;
  }
  const remaining = elapsed - full * RATE_BIN_MS;
  const due = !state.hinted && bins.length >= windowBins && medianOf(bins) < tuning.lowRateHz;
  return {
    bins,
    count,
    elapsedMs: remaining,
    hinted: state.hinted || due,
    due: state.due || due,
  };
}

/** Takes the hint for the screen. It is shown once, so the second take says nothing. */
export function takeHint(state: LowRateState): { state: LowRateState; shown: boolean } {
  if (!state.due) return { state, shown: false };
  return { state: { ...state, due: false }, shown: true };
}
