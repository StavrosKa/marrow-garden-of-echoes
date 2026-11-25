// The delivered-rate watch (garden-level requirement 16.2). The threshold and the window come from session/tuning.ts, and
// the tests read them, so a change of the tuning does not break the test.
import { describe, expect, it } from 'vitest';
import {
  createLowRate,
  createQuietHint,
  stepLowRate,
  stepQuietHint,
  takeHint,
  type LowRateState,
  type QuietHintInput,
  type QuietHintState,
} from './lowRate';
import { APP_SESSION_TUNING, RATE_BIN_MS } from './tuning';

const WINDOW_BINS = APP_SESSION_TUNING.lowRateWindowMs / RATE_BIN_MS;
const RATE = APP_SESSION_TUNING.lowRateHz;

/** One second of presence time with `frames` new frames. */
function second(state: LowRateState, frames: number): LowRateState {
  return stepLowRate(state, { dtMs: RATE_BIN_MS, delivered: frames });
}

/** The state after `count` seconds, each with `frames` frames. */
function seconds(count: number, frames: number, from: LowRateState = createLowRate()): LowRateState {
  let state = from;
  for (let i = 0; i < count; i += 1) state = second(state, frames);
  return state;
}

/** One frame's input of the quiet hint: a taken hint or not, a required line or not, the session ended or not. */
function frameOf(over: Partial<QuietHintInput> = {}): QuietHintInput {
  return { taken: false, required: false, ended: false, ...over };
}

/** The state after a list of frames, from a fresh hint. */
function afterFrames(frames: readonly QuietHintInput[]): QuietHintState {
  return frames.reduce((state, input) => stepQuietHint(state, input), createQuietHint());
}

describe('the quiet light hint (requirements 15.3, 16.2; D2)', () => {
  it('16.2: a taken hint is shown, and it stays shown while no required line is pending and the session goes on', () => {
    const state = afterFrames([frameOf({ taken: true }), frameOf(), frameOf(), frameOf()]);
    expect(state).toEqual({ shown: true, spent: true });
  });

  it('15.3: a hint that is not taken is not shown', () => {
    expect(afterFrames([frameOf(), frameOf({ taken: false })])).toEqual({ shown: false, spent: false });
  });

  it('15.3: a required line that returns clears a shown hint', () => {
    const state = afterFrames([frameOf({ taken: true }), frameOf({ required: true })]);
    expect(state.shown).toBe(false);
  });

  it('15.3: a required line that returns clears the hint in the same frame it is taken, so the hint never replaces a line', () => {
    const state = afterFrames([frameOf({ taken: true, required: true })]);
    expect(state.shown).toBe(false);
  });

  it('16.2: the saved session clears a shown hint', () => {
    const state = afterFrames([frameOf({ taken: true }), frameOf({ ended: true })]);
    expect(state.shown).toBe(false);
  });

  it('16.2: a cleared hint never returns in the same session, however often it is taken or the line is absent', () => {
    const cleared = afterFrames([frameOf({ taken: true }), frameOf({ required: true })]);
    const again = [frameOf({ taken: true }), frameOf({ taken: true }), frameOf()].reduce(stepQuietHint, cleared);
    expect(again.shown).toBe(false);
    expect(again.spent).toBe(true);
  });

  it('16.2: a hint cleared by a required line that came before any taking is still available to take later', () => {
    const state = afterFrames([frameOf({ required: true }), frameOf({ taken: true })]);
    expect(state).toEqual({ shown: true, spent: true });
  });

  it('16.2: a hint is shown at most once: the saved session with no hint leaves nothing on', () => {
    expect(afterFrames([frameOf({ ended: true }), frameOf({ taken: true, ended: true })])).toEqual({ shown: false, spent: false });
  });
});

describe('the delivered-rate watch (requirement 16.2)', () => {
  it('16.2: no hint before a full window of time has passed, however low the rate', () => {
    const state = seconds(WINDOW_BINS - 1, 0);
    expect(state.due).toBe(false);
    expect(state.hinted).toBe(false);
  });

  it('16.2: the hint is due once a full window has a median below the threshold', () => {
    const state = seconds(WINDOW_BINS, 0);
    expect(state.due).toBe(true);
  });

  it('16.2: a median exactly at the threshold is not below it, so no hint', () => {
    expect(seconds(WINDOW_BINS, RATE).due).toBe(false);
  });

  it('16.2: a median one frame below the threshold is due', () => {
    expect(seconds(WINDOW_BINS, RATE - 1).due).toBe(true);
  });

  it('16.2: a burst of frames does not hide a low median', () => {
    // Six empty seconds and four busy ones: the mean is high, but the median is 0.
    const quiet = seconds(WINDOW_BINS - 4, 0);
    const state = seconds(4, 100, quiet);
    expect(state.due).toBe(true);
  });

  it('16.2: a bin is one second of presence time, however the time is split into frames', () => {
    // Ten steps of 100 ms with one frame each make one second with ten frames.
    let state = createLowRate();
    for (let i = 0; i < 10; i += 1) state = stepLowRate(state, { dtMs: RATE_BIN_MS / 10, delivered: 1 });
    expect(state.bins).toEqual([10]);
    expect(state.elapsedMs).toBe(0);
  });

  it('16.2: time left over a full bin stays in the bin in progress', () => {
    const state = stepLowRate(createLowRate(), { dtMs: 1500, delivered: 0 });
    expect(state.bins).toEqual([0]);
    expect(state.elapsedMs).toBe(500);
  });

  it('16.2: the hint is due once per session: taking it says so once, and a later low window does not re-arm it', () => {
    const due = seconds(WINDOW_BINS, 0);
    const first = takeHint(due);
    expect(first.shown).toBe(true);
    const second_ = takeHint(first.state);
    expect(second_.shown).toBe(false);
    const later = seconds(WINDOW_BINS, 0, first.state);
    expect(later.due).toBe(false);
    expect(later.hinted).toBe(true);
  });

  it('16.2: no hint is taken while none is due', () => {
    expect(takeHint(createLowRate())).toEqual({ state: createLowRate(), shown: false });
  });

  it('16.1 23.2: a time that is not finite, or 0 or less, adds no time to the bin in progress', () => {
    const start = stepLowRate(createLowRate(), { dtMs: 300, delivered: 2 });
    for (const dtMs of [Number.NaN, Number.POSITIVE_INFINITY, -50, 0]) {
      const after = stepLowRate(start, { dtMs, delivered: 0 });
      expect(after.elapsedMs).toBe(300);
      expect(after.count).toBe(2);
    }
  });

  it('16.2: a very long step costs no more than one window of bins', () => {
    const state = stepLowRate(createLowRate(), { dtMs: 1e12, delivered: 0 });
    expect(state.bins.length).toBeLessThanOrEqual(WINDOW_BINS);
    expect(state.bins.length).toBe(WINDOW_BINS);
  });

  it('16.2: a higher threshold makes a steady rate low, and the threshold comes from the tuning', () => {
    const steady = seconds(WINDOW_BINS, RATE);
    expect(steady.due).toBe(false);
    const raised = { lowRateHz: RATE + 1, lowRateWindowMs: APP_SESSION_TUNING.lowRateWindowMs };
    let state = createLowRate();
    for (let i = 0; i < WINDOW_BINS; i += 1) state = stepLowRate(state, { dtMs: RATE_BIN_MS, delivered: RATE }, raised);
    expect(state.due).toBe(true);
  });
});
