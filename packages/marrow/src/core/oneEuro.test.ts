import { describe, expect, it } from 'vitest';
import { createOneEuro, oneEuroReset, oneEuroStep, type OneEuroConfig, type OneEuroState } from './oneEuro';
import { TUNING } from './tuning';

// The three parameters and every delta come from TUNING. The other numbers are the
// signal values, which are test inputs, the special deltas 0 and Number.MIN_VALUE,
// and the tolerance against the textbook form.

/** The largest presence delta, and a few deltas made from it. */
const MAX = TUNING.maxClockStepMs;
/** The parameters the pointer filter uses. */
const CFG: OneEuroConfig = {
  minCutoffHz: TUNING.oneEuroMinCutoffHz,
  beta: TUNING.oneEuroBeta,
  dCutoffHz: TUNING.oneEuroDCutoffHz,
};
/** How far the rewritten speed step may drift from the textbook one by rounding. */
const TOLERANCE = 1e-12;

/** A moving signal with jumps across the whole range, and the delta before each sample. */
const SIGNAL = [
  { value: 0.1, dtMs: MAX },
  { value: 0.9, dtMs: MAX / 2 },
  { value: 0.85, dtMs: MAX / 4 },
  { value: 0.2, dtMs: MAX },
  { value: 0.25, dtMs: MAX / 2 },
  { value: 1, dtMs: MAX / 5 },
  { value: 0, dtMs: MAX },
];

/**
 * The textbook One Euro step (Casiez, Roussel and Vogel, CHI 2012), written as in the
 * reference implementation: alpha = 1 / (1 + tau / dt), tau = 1 / (2π · cutoff), and
 * the raw speed divided by dt. Only for deltas it can divide by.
 */
function textbookStep(
  previous: { value: number; derivative: number } | null,
  value: number,
  dtMs: number,
  cfg: OneEuroConfig,
): { value: number; derivative: number } {
  if (previous === null) return { value, derivative: 0 };
  const dt = dtMs / 1000; // seconds
  const alpha = (cutoffHz: number): number => 1 / (1 + 1 / (2 * Math.PI * cutoffHz) / dt);
  const aD = alpha(cfg.dCutoffHz);
  const derivative = aD * ((value - previous.value) / dt) + (1 - aD) * previous.derivative;
  const a = alpha(cfg.minCutoffHz + cfg.beta * Math.abs(derivative));
  return { value: a * value + (1 - a) * previous.value, derivative };
}

/** The textbook outputs for a signal. */
function textbookOutputs(signal: typeof SIGNAL, cfg: OneEuroConfig): number[] {
  let previous: { value: number; derivative: number } | null = null;
  return signal.map(({ value, dtMs }) => {
    previous = textbookStep(previous, value, dtMs, cfg);
    return previous.value;
  });
}

/** Runs the filter over a signal; returns the outputs and the final state. */
function run(signal: typeof SIGNAL, start: OneEuroState = createOneEuro(CFG)) {
  let state = start;
  const outputs = signal.map(({ value, dtMs }) => {
    const result = oneEuroStep(state, value, dtMs);
    state = result.state;
    return result.value;
  });
  return { outputs, state };
}

/** A filter that has seen the first three samples of SIGNAL: it has moved, so its speed is not 0. */
const primed = run(SIGNAL.slice(0, 3));
const LAST = primed.outputs[2] ?? NaN;
/** A sample far from the last output. */
const FAR = 0.05;

describe('oneEuroStep', () => {
  it('outputs the first sample unchanged, whatever the delta', () => {
    for (const dtMs of [0, Number.MIN_VALUE, MAX, NaN, -MAX]) {
      const { state, value } = oneEuroStep(createOneEuro(CFG), 0.3, dtMs);
      expect(value).toBe(0.3);
      expect(state).toEqual({ cfg: CFG, value: 0.3, derivative: 0 });
    }
  });

  it('matches the textbook filter on a moving signal', () => {
    const { outputs } = run(SIGNAL);
    const expected = textbookOutputs(SIGNAL, CFG);
    outputs.forEach((output, i) => {
      expect(Math.abs(output - (expected[i] ?? NaN))).toBeLessThan(TOLERANCE);
    });
  });

  it('the moving signal is fast enough that beta and dCutoff change the result', () => {
    const base = textbookOutputs(SIGNAL, CFG);
    const moreBeta = textbookOutputs(SIGNAL, { ...CFG, beta: 2 * CFG.beta });
    const moreDCutoff = textbookOutputs(SIGNAL, { ...CFG, dCutoffHz: 2 * CFG.dCutoffHz });
    const largest = (other: number[]): number =>
      Math.max(...other.map((v, i) => Math.abs(v - (base[i] ?? NaN))));
    expect(largest(moreBeta)).toBeGreaterThan(1e3 * TOLERANCE);
    expect(largest(moreDCutoff)).toBeGreaterThan(1e3 * TOLERANCE);
  });

  it('a delta of exactly 0 leaves the output and the state unchanged', () => {
    expect(primed.state.derivative).not.toBe(0);
    const { state, value } = oneEuroStep(primed.state, FAR, 0);
    expect(value).toBe(LAST);
    expect(state).toEqual(primed.state);
  });

  it('a step with a delta of 0 has no effect on the steps after it', () => {
    const rest = SIGNAL.slice(3);
    const without = run(rest, primed.state).outputs;
    const withZero = run(rest, oneEuroStep(primed.state, FAR, 0).state).outputs;
    expect(withZero).toEqual(without);
  });

  it('counts a negative or non-finite delta as 0', () => {
    for (const dtMs of [-0, -Number.MIN_VALUE, -MAX, NaN, Infinity, -Infinity]) {
      const { state, value } = oneEuroStep(primed.state, FAR, dtMs);
      expect(value).toBe(LAST);
      expect(state).toEqual(primed.state);
    }
  });

  it('the smallest positive delta gives a finite output between the last output and the sample', () => {
    const { state, value } = oneEuroStep(primed.state, FAR, Number.MIN_VALUE);
    expect(Number.isFinite(value)).toBe(true);
    expect(Number.isFinite(state.derivative)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(Math.min(LAST, FAR));
    expect(value).toBeLessThanOrEqual(Math.max(LAST, FAR));
    // The steps after it stay finite too.
    expect(run(SIGNAL.slice(3), state).outputs.every(Number.isFinite)).toBe(true);
  });

  it('a delta of exactly maxClockStepMs matches the textbook step and lands strictly between', () => {
    const { value } = oneEuroStep(primed.state, FAR, MAX);
    const previous = { value: LAST, derivative: primed.state.derivative };
    const expected = textbookStep(previous, FAR, MAX, CFG).value;
    expect(Math.abs(value - expected)).toBeLessThan(TOLERANCE);
    expect(value).toBeGreaterThan(Math.min(LAST, FAR));
    expect(value).toBeLessThan(Math.max(LAST, FAR));
  });

  it('keeps the parameters it was created with', () => {
    const other: OneEuroConfig = { minCutoffHz: 2 * CFG.minCutoffHz, beta: 2 * CFG.beta, dCutoffHz: 2 * CFG.dCutoffHz };
    const { outputs } = run(SIGNAL, createOneEuro(other));
    const expected = textbookOutputs(SIGNAL, other);
    outputs.forEach((output, i) => {
      expect(Math.abs(output - (expected[i] ?? NaN))).toBeLessThan(TOLERANCE);
    });
  });
});

describe('oneEuroReset', () => {
  it('forgets every sample: the next sample is output unchanged, and the filter goes on like a new one', () => {
    const reset = oneEuroReset(primed.state);
    expect(reset).toEqual(createOneEuro(CFG));
    const rest = SIGNAL.slice(3);
    expect(run(rest, reset).outputs).toEqual(run(rest).outputs);
    expect(run(rest, reset).outputs[0]).toBe(rest[0]?.value);
  });
});
