// The One Euro filter (Casiez, Roussel and Vogel, CHI 2012) on one number, with time
// given as a delta in milliseconds. Internal: reached by relative import, not
// exported from marrow/core (design section 6). The pointer filter runs one on each
// axis of each wrist (Req 8.1).
//
// The textbook step, for a delta dt > 0 in seconds and the previous output x0:
//   rate   = (x - x0) / dt                       raw speed
//   aD     = rD / (rD + 1),  rD = 2π · dCutoff · dt
//   d      = aD · rate + (1 - aD) · d0           filtered speed
//   cutoff = minCutoff + beta · |d|
//   a      = r / (r + 1),    r  = 2π · cutoff · dt
//   x      = x0 + a · (x - x0)
// The speed is measured against the previous output, as in the reference
// implementation (github.com/casiez/OneEuroFilter). Because aD · rate equals
// 2π · dCutoff · (x - x0) / (rD + 1), the filtered speed is computed here as
//   d = (2π · dCutoff · (x - x0) + d0) / (rD + 1)
// which never divides by dt, so a delta too small to divide by stays finite. The
// only divisor left is rD + 1 or r + 1, which is at least 1.

/** The filter's three parameters. */
export interface OneEuroConfig {
  /** Cutoff frequency at zero speed, in Hz. */
  readonly minCutoffHz: number;
  /** Rise of the cutoff frequency per unit of speed (value units per second), in Hz. */
  readonly beta: number;
  /** Cutoff frequency of the speed estimate, in Hz. */
  readonly dCutoffHz: number;
}

/** A filter and what it remembers. */
export interface OneEuroState {
  readonly cfg: OneEuroConfig;
  /** The last output, or null before the first sample after create or reset. */
  readonly value: number | null;
  /** The filtered speed of the value, in value units per second; 0 until the second sample. */
  readonly derivative: number;
}

/** A step's new state and its output. */
export interface OneEuroResult {
  readonly state: OneEuroState;
  readonly value: number;
}

/** Unit conversion, not a tuning value. */
const MS_PER_SECOND = 1000;
const TWO_PI = 2 * Math.PI;

/** A filter that has seen no sample. */
export function createOneEuro(cfg: OneEuroConfig): OneEuroState {
  return { cfg, value: null, derivative: 0 };
}

/** The same filter with every sample forgotten: the next sample is output unchanged. */
export function oneEuroReset(state: OneEuroState): OneEuroState {
  return createOneEuro(state.cfg);
}

/** The weight r / (r + 1) of the new sample in a low-pass step, r = 2π · cutoff · dt. In [0, 1). */
function weight(cutoffHz: number, dtSeconds: number): number {
  const r = TWO_PI * cutoffHz * dtSeconds;
  return r / (r + 1);
}

/**
 * Filters one sample taken dtMs after the previous one. The first sample after
 * create or reset is output unchanged, whatever the delta. After that, a delta that
 * is not a positive finite number counts as 0: nothing changes, and the output is
 * the previous output.
 */
export function oneEuroStep(state: OneEuroState, value: number, dtMs: number): OneEuroResult {
  const previous = state.value;
  if (previous === null) {
    return { state: { cfg: state.cfg, value, derivative: 0 }, value };
  }
  if (!Number.isFinite(dtMs) || dtMs <= 0) {
    return { state, value: previous };
  }
  const { minCutoffHz, beta, dCutoffHz } = state.cfg;
  const dtSeconds = dtMs / MS_PER_SECOND;
  const change = value - previous;
  const derivative =
    (TWO_PI * dCutoffHz * change + state.derivative) / (TWO_PI * dCutoffHz * dtSeconds + 1);
  const cutoffHz = minCutoffHz + beta * Math.abs(derivative);
  const output = previous + weight(cutoffHz, dtSeconds) * change;
  return { state: { cfg: state.cfg, value: output, derivative }, value: output };
}
