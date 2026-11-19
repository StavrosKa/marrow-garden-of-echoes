// View lock (Req 6; design 4.2): while a dwell holds a target, the interaction layer keeps the value
// it had before the hold, and the decorative layers keep following the live head. When the hold ends,
// the interaction layer eases back to the live head over lockEaseMs.
import type { Vec2 } from 'marrow/core';
import { smootherstep } from './ease';
import { TUNING, type Tuning } from './tuning';

const ZERO = 0;
const ONE = 1;
const ORIGIN: Vec2 = { x: ZERO, y: ZERO };

export type LockMode = 'free' | 'locked' | 'easing';

export interface LockState {
  readonly mode: LockMode;
  /** locked: the held value. easing: where the ease started. free: equals `last`. */
  readonly held: Vec2;
  /** easing only: the presence time since the ease started, in ms. 0 otherwise. */
  readonly easeElapsedMs: number;
  /** The interactionHead returned by the previous step. */
  readonly last: Vec2;
}

export interface LockInput {
  readonly liveHead: Vec2;
  /** True while any dwell is in progress on a target (Req 6.1). The caller computes it. */
  readonly lockRequested: boolean;
}

export interface LockStep {
  readonly state: LockState;
  readonly interactionHead: Vec2;
  readonly decorativeHead: Vec2;
}

export function createLock(): LockState {
  return { mode: 'free', held: ORIGIN, easeElapsedMs: ZERO, last: ORIGIN };
}

/**
 * The ease-back value at the ease fraction `u`: held + (live - held) * smootherstep(u). At `u` of 1
 * or more the ease is complete and the value is `live` itself, not a computed value that may differ
 * from it by a rounding (Req 6.4).
 */
function easeValue(held: Vec2, live: Vec2, u: number): Vec2 {
  if (u >= ONE) return live;
  const w = smootherstep(u);
  return { x: held.x + (live.x - held.x) * w, y: held.y + (live.y - held.y) * w };
}

/**
 * One step of the lock on the presence clock. `dtMs` is the presence delta of this frame; a delta
 * that is zero, negative or not finite does not advance the ease. `decorativeHead` is `liveHead` in
 * every row of the table.
 */
export function stepLock(state: LockState, input: LockInput, dtMs: number, tuning: Tuning = TUNING): LockStep {
  const dt = dtMs > ZERO && Number.isFinite(dtMs) ? dtMs : ZERO;
  const live = input.liveHead;
  const requested = input.lockRequested;
  const decorativeHead = live;

  if (state.mode === 'free') {
    if (requested) {
      // Row 1: free, lockRequested -> locked, held = last.
      const interactionHead = state.last;
      return {
        state: { mode: 'locked', held: state.last, easeElapsedMs: ZERO, last: interactionHead },
        interactionHead,
        decorativeHead,
      };
    }
    // Row 2: free, not requested -> free, liveHead.
    return {
      state: { mode: 'free', held: live, easeElapsedMs: ZERO, last: live },
      interactionHead: live,
      decorativeHead,
    };
  }

  if (state.mode === 'locked') {
    if (requested) {
      // Row 3: locked, lockRequested -> locked, held exactly.
      const interactionHead = state.held;
      return {
        state: { mode: 'locked', held: state.held, easeElapsedMs: ZERO, last: interactionHead },
        interactionHead,
        decorativeHead,
      };
    }
    // Row 4: locked, not requested -> easing from held, elapsed = dt.
    const interactionHead = easeValue(state.held, live, dt / tuning.lockEaseMs);
    return {
      state: { mode: 'easing', held: state.held, easeElapsedMs: dt, last: interactionHead },
      interactionHead,
      decorativeHead,
    };
  }

  // The mode is easing.
  if (requested) {
    // Row 5: easing, lockRequested -> locked, held = last (the current value, so no jump).
    const interactionHead = state.last;
    return {
      state: { mode: 'locked', held: state.last, easeElapsedMs: ZERO, last: interactionHead },
      interactionHead,
      decorativeHead,
    };
  }
  const elapsed = state.easeElapsedMs + dt;
  if (elapsed < tuning.lockEaseMs) {
    // Row 6: easing, not requested, the ease is not over -> easing.
    const interactionHead = easeValue(state.held, live, elapsed / tuning.lockEaseMs);
    return {
      state: { mode: 'easing', held: state.held, easeElapsedMs: elapsed, last: interactionHead },
      interactionHead,
      decorativeHead,
    };
  }
  // Row 7: easing, not requested, the ease is over -> free, liveHead (assigned).
  return {
    state: { mode: 'free', held: live, easeElapsedMs: ZERO, last: live },
    interactionHead: live,
    decorativeHead,
  };
}
