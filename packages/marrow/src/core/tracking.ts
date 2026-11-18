// The tracking lifecycle (Requirement 18, design sections 1, 3 and 9.4). A pure reducer:
// stepTracking(state, input, dtMs) -> { state, events, holdActive, overlayVisible, oneWristHint },
// with dtMs the presence delta of this step (Req 18.1). It runs between the two stages of the
// clocks: holdActive is the hold of THIS step, so the driver passes it to sessionDelta in the same
// step (design section 3). dtMs is trusted as the Clocks give it, as in the other reducers.
//
// Decisions the requirements leave open (each is recorded in docs/kiro-journal.md):
//  - "Exceeds" is strict and "reaches" is >=: the hold begins when continuous lost time is greater
//    than trackingHoldAfterMs (Req 18.3), the overlay shows when it is greater than
//    trackingOverlayAfterMs (Req 18.4), and the hold ends when continuous valid time is at least
//    trackingResumeMs (Req 18.6). The one-wrist hint needs more than oneWristHintMs (Req 18.9).
//  - Lost time keeps counting during a hold: the overlay rule needs it (Req 18.4). Starting a hold
//    does not reset it. It is reset in any step in which an active wrist is valid (Req 18.2), so it
//    is 0 in the step in which a hold ends, because a hold ends only in such a step.
//  - Valid time counts only during a hold, and is reset in any step without a valid active wrist
//    (Req 18.5). Once the overlay shows it stays until the hold ends (Req 18.4), also through a
//    short valid stretch that resets lost time; it shows again only if it was hidden by the hold's end.
//  - Calibration and simulated input suspend the lifecycle (Req 11.17, 18.10). In a suspended step
//    the whole state is reset: no timer runs, so lost time counts only from the step after
//    calibration ends. A hold therefore cannot be due in the first step of play, and a player whose
//    hands were down for the calm hold (Req 12.5) has trackingHoldAfterMs to raise one. A hold that
//    is running when calibration starts ends, with the events of every flag that was on.
//  - The one-wrist hint (Req 18.9) needs two active wrists, so with one it can never show. It shows
//    when some active wrist has been invalid for more than oneWristHintMs of presence time without
//    a valid step, and another active wrist is valid now. That time is per wrist and counts also
//    while both were invalid, so after a hold ends the hint can show at once for a wrist that never
//    came back. The state remembers which wrist the hint is about, and the hint is hidden when that
//    wrist is valid again or a hold begins, and only then (Req 18.9 names those two): if the other
//    wrist goes invalid too, the hint stays until the hold begins, up to trackingHoldAfterMs later,
//    so a flicker of the other wrist does not make it blink. It does not show during a hold: the
//    overlay is on then.
//  - A wrist of activeWrists that is missing from the input is invalid. A wrist that is not active is
//    never read, whatever the input says about it.
//  - The nose is part of the input (Req 18.1) and is never read: losing only the head never begins a
//    hold and changes nothing here (Req 18.7). The head view eases to centre on its own (Req 9.6).
//  - A step with dtMs of 0 adds nothing to any timer, so it begins and ends nothing and shows and
//    hides nothing. Validity still resets timers in it: lost time is the time since the last valid
//    step, and a valid step is a valid step whatever the clock does.
import type { WristId } from './frame';
import type { CalibrationMode } from './calibration';
import type { Tuning } from './tuning';

/** Camera mode, or simulated input: the same two modes as calibration. */
export type TrackingMode = CalibrationMode;

export interface TrackingConfig {
  /** The wrists the player chose (camera mode) or the right wrist (simulated input). */
  readonly activeWrists: readonly WristId[];
  readonly mode: TrackingMode;
  /** The tuning values every threshold is read from. */
  readonly tuning: Tuning;
}

/** One step's input (Req 18.1), besides the presence delta. */
export interface TrackingInput {
  /** Whether each wrist is valid. Only the active wrists are read; a missing one is invalid. */
  readonly wristValid: { readonly [W in WristId]?: boolean };
  /** Whether the nose is valid. Part of the input and never read (Req 18.7). */
  readonly noseValid: boolean;
  /** Whether calibration is running (Req 11.17, 18.10). */
  readonly calibrating: boolean;
}

/** A change of one of the three flags, in the step it happens. */
export type TrackingEvent =
  | { readonly kind: 'holdBegan' }
  | { readonly kind: 'holdEnded' }
  | { readonly kind: 'overlayShown' }
  | { readonly kind: 'overlayHidden' }
  | { readonly kind: 'oneWristHintShown' }
  | { readonly kind: 'oneWristHintHidden' };

export interface TrackingState {
  readonly cfg: TrackingConfig;
  /** Continuous presence time with no valid active wrist, in milliseconds (Req 18.2). */
  readonly lostMs: number;
  /** Continuous presence time with a valid active wrist during a hold; 0 outside one (Req 18.5). */
  readonly validMs: number;
  /** Continuous presence time each wrist has been invalid (Req 18.9). */
  readonly invalidMs: { readonly [W in WristId]: number };
  readonly holdActive: boolean;
  readonly overlayVisible: boolean;
  /** The wrist the shown one-wrist hint is about, or null when the hint is not shown (Req 18.9). */
  readonly hintWrist: WristId | null;
}

/** What one step returns: the new state, the changes, and the three flags of this step. */
export interface TrackingStep {
  readonly state: TrackingState;
  readonly events: readonly TrackingEvent[];
  /** Whether a hold is in effect in this step: the flag for sessionDelta (design section 3). */
  readonly holdActive: boolean;
  /** Whether the "Step back into view" overlay shows (Req 18.4). */
  readonly overlayVisible: boolean;
  /** Whether the one-wrist hint shows (Req 18.9). */
  readonly oneWristHint: boolean;
}

/** A lifecycle with no timer running and nothing shown. */
export function createTracking(cfg: TrackingConfig): TrackingState {
  return {
    cfg,
    lostMs: 0,
    validMs: 0,
    invalidMs: { left: 0, right: 0 },
    holdActive: false,
    overlayVisible: false,
    hintWrist: null,
  };
}

/** The events for flags that were on and are now off, in the order hold, overlay, hint. */
function eventsForOff(state: TrackingState): TrackingEvent[] {
  const events: TrackingEvent[] = [];
  if (state.holdActive) events.push({ kind: 'holdEnded' });
  if (state.overlayVisible) events.push({ kind: 'overlayHidden' });
  if (state.hintWrist !== null) events.push({ kind: 'oneWristHintHidden' });
  return events;
}

/**
 * One step of the lifecycle with presence delta dtMs (Req 18). In camera mode outside calibration
 * it times lost and valid time, begins and ends the hold, and shows the overlay and the hint; in
 * simulated input or during calibration it does nothing but reset (see the decisions above). The
 * arguments are only read.
 */
export function stepTracking(state: TrackingState, input: TrackingInput, dtMs: number): TrackingStep {
  const { cfg } = state;
  const t = cfg.tuning;

  if (cfg.mode === 'simulated' || input.calibrating) {
    return {
      state: createTracking(cfg),
      events: eventsForOff(state),
      holdActive: false,
      overlayVisible: false,
      oneWristHint: false,
    };
  }

  const validNow = (wrist: WristId): boolean => cfg.activeWrists.includes(wrist) && input.wristValid[wrist] === true;
  const anyValid = validNow('left') || validNow('right');
  const events: TrackingEvent[] = [];

  // Req 18.2: lost time counts presence time with no valid active wrist, and is reset by any valid step.
  const lostMs = anyValid ? 0 : state.lostMs + dtMs;

  let holdActive = state.holdActive;
  let overlayVisible = state.overlayVisible;
  let validMs = state.validMs;

  if (!holdActive) {
    // Req 18.3: the hold begins in the step in which lost time exceeds trackingHoldAfterMs.
    if (lostMs > t.trackingHoldAfterMs) {
      holdActive = true;
      validMs = 0;
      events.push({ kind: 'holdBegan' });
    }
  } else {
    // Req 18.5, 18.6: valid time counts during the hold, and the hold ends in the step it reaches trackingResumeMs.
    validMs = anyValid ? validMs + dtMs : 0;
    if (validMs >= t.trackingResumeMs) {
      holdActive = false;
      validMs = 0;
      events.push({ kind: 'holdEnded' });
      if (overlayVisible) {
        overlayVisible = false;
        events.push({ kind: 'overlayHidden' });
      }
    }
  }

  // Req 18.4: during a hold, the overlay shows once lost time exceeds trackingOverlayAfterMs.
  if (holdActive && !overlayVisible && lostMs > t.trackingOverlayAfterMs) {
    overlayVisible = true;
    events.push({ kind: 'overlayShown' });
  }

  // Req 18.9: per wrist, continuous invalid time; the hint needs two active wrists.
  const invalidMs = {
    left: validNow('left') ? 0 : state.invalidMs.left + dtMs,
    right: validNow('right') ? 0 : state.invalidMs.right + dtMs,
  };
  // A shown hint is hidden when its wrist is valid again or a hold begins, and only then.
  let hintWrist = state.hintWrist;
  if (hintWrist !== null && (validNow(hintWrist) || holdActive)) hintWrist = null;
  if (hintWrist === null && !holdActive && anyValid && new Set(cfg.activeWrists).size >= 2) {
    hintWrist = cfg.activeWrists.find((wrist) => !validNow(wrist) && invalidMs[wrist] > t.oneWristHintMs) ?? null;
  }
  const oneWristHint = hintWrist !== null;
  if (oneWristHint !== (state.hintWrist !== null)) {
    events.push({ kind: oneWristHint ? 'oneWristHintShown' : 'oneWristHintHidden' });
  }

  return {
    state: { cfg, lostMs, validMs, invalidMs, holdActive, overlayVisible, hintWrist },
    events,
    holdActive,
    overlayVisible,
    oneWristHint,
  };
}
