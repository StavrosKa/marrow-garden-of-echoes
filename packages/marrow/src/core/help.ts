// The help policy (Requirement 19, design sections 1 and 9.5). A pure, event-driven reducer:
// stepHelp(state, event) -> { state, outputs }. It has no timers: time for it is the sequence of
// events the caller sends (Req 19.1), and the caller decides what a difficulty is (Req 19.2).
// It is content-free: the two axes are named motor and cognitive, and what a cognitive level
// means is the app's business (Req 19.7).
//
// Decisions the requirements leave open (each is recorded in docs/kiro-journal.md):
//  - "Offer help" (Req 19.3) is emitted in the event that reports difficulty number
//    difficultiesBeforeHelp of the round, counted over both axes, and in no other event of that
//    round: the round remembers that it has offered.
//  - "The axis that was not changed last" (Req 19.4) is the axis whose level was raised last, by a
//    raise of its own or by the fallback of Req 19.5, whichever it was. If only one axis has ever
//    changed, a tie goes to the other one; if none has, to motor. A change that is waiting counts as
//    changed, because it will be applied before anything decided later (next point).
//  - A change that Req 19.8 defers waits in a queue of axes, applied one per event, in order. A round
//    that ends while changes are waiting adds its own to the end of the queue: it is neither merged
//    nor dropped, because Req 19.4 gives each round that ends with enough difficulties its own raise
//    and Req 19.8 only delays it, and two raises in one event would break Req 19.11. Each decision is
//    made against the levels and the last changed axis as they will be once the queue is applied, so
//    every queued change is valid when its turn comes, the queue never holds more than the two axes
//    can still rise, and the session has at most 2 * helpMaxLevel changes (Req 19.13).
//  - Only one level changes in an event (Req 19.11). In an event that reports neither dwell nor
//    playback, the waiting change is applied first, before the event is handled (Req 19.8). If that
//    event is a round end whose round also earns a raise, the new raise goes to the queue.
//  - "Continue with help" (Req 19.9) is accepted in every state: it never fails. When the round has a
//    current step (the first one not completed) it reveals it and counts it completed. When the round
//    has no step left, or there is no round, there is nothing to reveal, and it does nothing but
//    what every event does (apply a waiting change).
//  - A difficulty, a completed step or a round end outside a round does nothing. A round start while
//    a round is still open replaces it: the unfinished round never ended, so it earns no raise.
//  - A step count outside the contract of Req 19.1 (not a finite number, or below 1) gives a round
//    with no steps; a fractional count is rounded down.
//  - helpRadiusForMotorLevel maps a level to its radius in motorRadii; a level outside the levels, or
//    not a number, is taken as the nearest one, 0 for NaN.
import { TUNING, type Tuning } from './tuning';

/** The two adaptation axes (Req 19.1). */
export type HelpAxis = 'motor' | 'cognitive';

/** What every event reports about the moment it happens (Req 19.1). */
export interface HelpFlags {
  readonly dwellActive: boolean;
  readonly playbackActive: boolean;
}

/** The events of Req 19.1. A round ended also reports whether the motor axis can step (Req 19.5). */
export type HelpEvent =
  | (HelpFlags & { readonly kind: 'roundStarted'; readonly steps: number })
  | (HelpFlags & { readonly kind: 'difficulty'; readonly axis: HelpAxis })
  | (HelpFlags & { readonly kind: 'stepCompleted' })
  | (HelpFlags & { readonly kind: 'continueWithHelp' })
  | (HelpFlags & { readonly kind: 'roundEnded'; readonly motorStepAllowed: boolean });

/** What the policy tells the caller (Req 19.3, 19.4, 19.9). */
export type HelpOutput =
  | { readonly kind: 'offerHelp' }
  /** The step to reveal, counted from 0; it counts as completed. */
  | { readonly kind: 'revealStep'; readonly step: number }
  /** A level went up by one, to `level`. */
  | { readonly kind: 'levelRaised'; readonly axis: HelpAxis; readonly level: number };

/** The tuning values the policy reads, taken when the state is created. */
export interface HelpConfig {
  readonly difficultiesBeforeHelp: number;
  readonly helpMaxLevel: number;
}

/** The round in progress. */
export interface HelpRound {
  readonly steps: number;
  /** The steps completed: by the player or by "continue with help". The current step is the one at this index. */
  readonly completed: number;
  readonly motorDifficulties: number;
  readonly cognitiveDifficulties: number;
  /** Whether "offer help" has been emitted for this round. */
  readonly offered: boolean;
}

export interface HelpState {
  readonly cfg: HelpConfig;
  /** 0..helpMaxLevel, never lowered within a session (Req 19.6). */
  readonly motorLevel: number;
  readonly cognitiveLevel: number;
  /** The axis whose level was raised last, or null before the first change. */
  readonly lastChanged: HelpAxis | null;
  /** Changes decided at a round end that are waiting for an event with no dwell and no playback (Req 19.8), in order. */
  readonly pending: readonly HelpAxis[];
  /** The round in progress, or null between rounds. */
  readonly round: HelpRound | null;
}

export interface HelpStep {
  readonly state: HelpState;
  readonly outputs: readonly HelpOutput[];
}

const OTHER: Readonly<Record<HelpAxis, HelpAxis>> = { motor: 'cognitive', cognitive: 'motor' };

/** A policy at the start of a session: both levels 0, nothing waiting, no round, thresholds read from `tuning`. */
export function createHelp(tuning: Tuning = TUNING): HelpState {
  return {
    cfg: { difficultiesBeforeHelp: tuning.difficultiesBeforeHelp, helpMaxLevel: tuning.helpMaxLevel },
    motorLevel: 0,
    cognitiveLevel: 0,
    lastChanged: null,
    pending: [],
    round: null,
  };
}

/**
 * The hit radius of a motor level (Req 19.7): motorRadii[level]. A level that is not one of the
 * levels is taken as the nearest one, and NaN as level 0.
 */
export function helpRadiusForMotorLevel(level: number, tuning: Tuning): number {
  const top = Math.min(tuning.helpMaxLevel, tuning.motorRadii.length - 1);
  const index = Number.isNaN(level) ? 0 : Math.min(Math.max(Math.floor(level), 0), top);
  return tuning.motorRadii[index] ?? tuning.hitRadius;
}

/** The levels and the last changed axis as they will be once every waiting change has been applied. */
function projected(state: HelpState): { motor: number; cognitive: number; last: HelpAxis | null } {
  let motor = state.motorLevel;
  let cognitive = state.cognitiveLevel;
  let last = state.lastChanged;
  for (const axis of state.pending) {
    if (axis === 'motor') motor += 1;
    else cognitive += 1;
    last = axis;
  }
  return { motor, cognitive, last };
}

/**
 * The raise a round earns when it ends (Req 19.4, 19.5), or null: at least difficultiesBeforeHelp
 * difficulties; the axis with more of them, a tie to the axis not changed last (motor for the first
 * change); and if that axis is at its highest level, or is motor and a motor step is not allowed,
 * the other axis, if it can; otherwise nothing.
 */
function decide(state: HelpState, round: HelpRound, motorStepAllowed: boolean): HelpAxis | null {
  const { cfg } = state;
  if (round.motorDifficulties + round.cognitiveDifficulties < cfg.difficultiesBeforeHelp) return null;
  const now = projected(state);
  const canStep = (axis: HelpAxis): boolean =>
    axis === 'motor' ? motorStepAllowed && now.motor < cfg.helpMaxLevel : now.cognitive < cfg.helpMaxLevel;
  let chosen: HelpAxis;
  if (round.motorDifficulties > round.cognitiveDifficulties) chosen = 'motor';
  else if (round.cognitiveDifficulties > round.motorDifficulties) chosen = 'cognitive';
  else chosen = now.last === null ? 'motor' : OTHER[now.last];
  if (canStep(chosen)) return chosen;
  return canStep(OTHER[chosen]) ? OTHER[chosen] : null;
}

/** The state with one axis one level higher, and the output that says so. */
function raise(state: HelpState, axis: HelpAxis, outputs: HelpOutput[]): HelpState {
  const level = (axis === 'motor' ? state.motorLevel : state.cognitiveLevel) + 1;
  outputs.push({ kind: 'levelRaised', axis, level });
  return axis === 'motor'
    ? { ...state, motorLevel: level, lastChanged: axis }
    : { ...state, cognitiveLevel: level, lastChanged: axis };
}

/**
 * One event of the policy (Req 19). In an event that reports neither a dwell nor a playback, the
 * oldest waiting change is applied first (Req 19.8). Then the event is handled: a round starts, a
 * difficulty is counted (and help is offered at difficulty number difficultiesBeforeHelp), a step is
 * completed, "continue with help" reveals the current step and completes it, or a round ends and its
 * raise, if any, is applied at once or queued. At most one level changes in an event (Req 19.11).
 * The arguments are only read.
 */
export function stepHelp(state: HelpState, event: HelpEvent): HelpStep {
  const outputs: HelpOutput[] = [];
  const safe = !event.dwellActive && !event.playbackActive;
  let next = state;
  let changed = false;

  const waiting = state.pending[0];
  if (safe && waiting !== undefined) {
    next = raise({ ...next, pending: next.pending.slice(1) }, waiting, outputs);
    changed = true;
  }

  const round = next.round;
  switch (event.kind) {
    case 'roundStarted': {
      const steps = Number.isFinite(event.steps) ? Math.max(0, Math.floor(event.steps)) : 0;
      next = { ...next, round: { steps, completed: 0, motorDifficulties: 0, cognitiveDifficulties: 0, offered: false } };
      break;
    }
    case 'difficulty': {
      if (round === null) break;
      const motorDifficulties = round.motorDifficulties + (event.axis === 'motor' ? 1 : 0);
      const cognitiveDifficulties = round.cognitiveDifficulties + (event.axis === 'cognitive' ? 1 : 0);
      const offer = !round.offered && motorDifficulties + cognitiveDifficulties >= next.cfg.difficultiesBeforeHelp;
      if (offer) outputs.push({ kind: 'offerHelp' });
      next = { ...next, round: { ...round, motorDifficulties, cognitiveDifficulties, offered: round.offered || offer } };
      break;
    }
    case 'stepCompleted': {
      if (round === null) break;
      next = { ...next, round: { ...round, completed: Math.min(round.steps, round.completed + 1) } };
      break;
    }
    case 'continueWithHelp': {
      if (round === null || round.completed >= round.steps) break;
      outputs.push({ kind: 'revealStep', step: round.completed });
      next = { ...next, round: { ...round, completed: round.completed + 1 } };
      break;
    }
    case 'roundEnded': {
      if (round === null) break;
      const axis = decide(next, round, event.motorStepAllowed);
      next = { ...next, round: null };
      if (axis === null) break;
      // A change is applied now only if this event has not changed a level yet and may; otherwise it waits its turn.
      if (safe && !changed) next = raise(next, axis, outputs);
      else next = { ...next, pending: [...next.pending, axis] };
      break;
    }
  }
  return { state: next, outputs };
}
