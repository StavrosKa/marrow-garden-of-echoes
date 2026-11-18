import { describe, expect, it } from 'vitest';
import * as core from './index';
import {
  createTracking,
  stepTracking,
  type TrackingConfig,
  type TrackingEvent,
  type TrackingState,
  type TrackingStep,
} from './tracking';
import { TUNING } from './tuning';

// Every threshold comes from TUNING. The scripts step the presence clock by STEP, the largest delta
// the Clocks return, and cut a stint into steps of at most STEP whose sum is exact (whole
// milliseconds). "One step before" and "the step at" a boundary are two steps of such a script. The
// rest are named test parameters.

const STEP = TUNING.maxClockStepMs;
const HOLD_AFTER = TUNING.trackingHoldAfterMs;
const OVERLAY_AFTER = TUNING.trackingOverlayAfterMs;
const RESUME = TUNING.trackingResumeMs;
const HINT_AFTER = TUNING.oneWristHintMs;
/** "Just over" a threshold: one more millisecond. A test parameter. */
const ONE_MS = 1;
/** How long a scripted stretch of calibration or of a pause lasts, in milliseconds. A test parameter. */
const LONG_MS = 5000;

const both: TrackingConfig = { activeWrists: ['left', 'right'], mode: 'camera', tuning: TUNING };
const rightOnly: TrackingConfig = { activeWrists: ['right'], mode: 'camera', tuning: TUNING };
const simulated: TrackingConfig = { activeWrists: ['right'], mode: 'simulated', tuning: TUNING };

/** One scripted step: which wrists are valid, the nose, whether calibration runs, and the delta. */
interface Move {
  readonly dt: number;
  readonly left: boolean;
  readonly right: boolean;
  readonly nose: boolean;
  readonly calibrating: boolean;
}

const moveOf = (valid: { left?: boolean; right?: boolean }, dt: number, more: { nose?: boolean; calibrating?: boolean } = {}): Move => ({
  dt,
  left: valid.left === true,
  right: valid.right === true,
  nose: more.nose ?? true,
  calibrating: more.calibrating ?? false,
});

/** Whole milliseconds in steps of at most STEP, summing exactly to `total`. */
function splitMs(total: number): number[] {
  const parts: number[] = [];
  for (let left = total; left > 0; left -= STEP) parts.push(Math.min(STEP, left));
  return parts;
}

/** A stint of exactly `total` milliseconds in which `valid` wrists are valid. */
const stint = (valid: { left?: boolean; right?: boolean }, total: number, more: { nose?: boolean; calibrating?: boolean } = {}): Move[] =>
  splitMs(total).map((dt) => moveOf(valid, dt, more));
const lost = (total: number, more: { nose?: boolean; calibrating?: boolean } = {}): Move[] => stint({}, total, more);
const seen = (total: number, more: { nose?: boolean; calibrating?: boolean } = {}): Move[] => stint({ left: true, right: true }, total, more);
const step = (valid: { left?: boolean; right?: boolean }, dt: number = STEP, more: { nose?: boolean; calibrating?: boolean } = {}): Move =>
  moveOf(valid, dt, more);

interface Played {
  readonly steps: TrackingStep[];
  readonly last: TrackingStep;
}

function play(cfg: TrackingConfig, moves: readonly Move[], from: TrackingState = createTracking(cfg)): Played {
  const steps: TrackingStep[] = [];
  let state = from;
  for (const m of moves) {
    const result = stepTracking(
      state,
      { wristValid: { left: m.left, right: m.right }, noseValid: m.nose, calibrating: m.calibrating },
      m.dt,
    );
    steps.push(result);
    state = result.state;
  }
  const last = steps[steps.length - 1];
  if (last === undefined) throw new Error('empty script');
  return { steps, last };
}

const kinds = (events: readonly TrackingEvent[]): string[] => events.map((e) => e.kind);
/** The step before the last one of a script. */
function beforeLast(played: Played): TrackingStep {
  const s = played.steps[played.steps.length - 2];
  if (s === undefined) throw new Error('script too short');
  return s;
}

describe('the thresholds the scripts rely on', () => {
  it('the hold, overlay, resume and hint times are whole numbers of steps, in the order the rules need', () => {
    for (const ms of [HOLD_AFTER, OVERLAY_AFTER, RESUME, HINT_AFTER]) expect(ms % STEP === 0).toBe(true);
    expect(HOLD_AFTER).toBeLessThanOrEqual(OVERLAY_AFTER);
    expect(HOLD_AFTER).toBeGreaterThan(STEP);
  });
});

describe('createTracking', () => {
  it('starts with no timer running and nothing shown', () => {
    const state = createTracking(both);
    expect(state).toEqual({
      cfg: both,
      lostMs: 0,
      validMs: 0,
      invalidMs: { left: 0, right: 0 },
      holdActive: false,
      overlayVisible: false,
      hintWrist: null,
    });
  });
});

describe('stepTracking, the hold (Req 18.2, 18.3)', () => {
  it('begins the hold in the step in which continuous lost time exceeds trackingHoldAfterMs, and in no earlier step (Req 18.3)', () => {
    // Exactly the threshold: no hold in any step.
    const exact = play(both, lost(HOLD_AFTER));
    expect(exact.steps.every((s) => !s.holdActive)).toBe(true);
    expect(exact.last.state.lostMs).toBe(HOLD_AFTER);
    expect(exact.steps.flatMap((s) => kinds(s.events))).toEqual([]);
    // One millisecond more: the hold begins in that very step, and the step before had none.
    const over = play(both, [...lost(HOLD_AFTER), step({}, ONE_MS)]);
    expect(beforeLast(over).holdActive).toBe(false);
    expect(over.last.holdActive).toBe(true);
    expect(over.last.state.holdActive).toBe(true);
    expect(kinds(over.last.events)).toEqual(['holdBegan']);
    // In full steps: the hold begins in the step that takes the time from the threshold to over it.
    const full = play(both, times(HOLD_AFTER / STEP + 1, step({})));
    expect(full.steps.map((s) => s.holdActive)).toEqual([...times(HOLD_AFTER / STEP, false), true]);
  });

  it('resets lost time in any step in which an active wrist is valid (Req 18.2)', () => {
    // Just short of the threshold, one valid step, and the same again: no hold.
    const flicker = play(both, [...lost(HOLD_AFTER - ONE_MS), step({ right: true }), ...lost(HOLD_AFTER - ONE_MS)]);
    expect(flicker.steps.every((s) => !s.holdActive)).toBe(true);
    // The valid step, whatever its delta, sets lost time to 0: the threshold counts from after it.
    const after = play(both, [...lost(HOLD_AFTER), step({ left: true }), ...lost(HOLD_AFTER)]);
    expect(after.steps.every((s) => !s.holdActive)).toBe(true);
    expect(play(both, [...lost(HOLD_AFTER), step({ left: true }), ...lost(HOLD_AFTER), step({}, ONE_MS)]).last.holdActive).toBe(true);
    expect(play(both, [...lost(HOLD_AFTER - ONE_MS), step({ left: true })]).last.state.lostMs).toBe(0);
  });

  it('losing only the nose, or one wrist while another is valid, never begins a hold (Req 18.7, 18.8)', () => {
    const noseOnly = play(both, seen(LONG_MS, { nose: false }));
    expect(noseOnly.steps.every((s) => !s.holdActive && !s.overlayVisible && !s.oneWristHint)).toBe(true);
    expect(noseOnly.steps.flatMap((s) => kinds(s.events))).toEqual([]);
    const oneWrist = play(both, stint({ right: true }, LONG_MS));
    expect(oneWrist.steps.every((s) => !s.holdActive && !s.overlayVisible)).toBe(true);
    const otherWrist = play(both, stint({ left: true }, LONG_MS));
    expect(otherWrist.steps.every((s) => !s.holdActive)).toBe(true);
    // The nose changes nothing: the same script with the nose valid and invalid gives the same steps.
    const script = [...seen(500), ...lost(2000), ...seen(1500), ...lost(400)];
    const withNose = play(both, script);
    const withoutNose = play(both, script.map((m) => ({ ...m, nose: false })));
    expect(withoutNose.steps).toEqual(withNose.steps);
  });

  it('reads only the active wrists: another wrist that is valid does not count, and a missing active wrist is invalid', () => {
    const rightLostLeftSeen = play(rightOnly, stint({ left: true }, HOLD_AFTER + ONE_MS));
    expect(rightLostLeftSeen.last.holdActive).toBe(true);
    const bothActive = play(both, stint({ left: true }, HOLD_AFTER + ONE_MS));
    expect(bothActive.last.holdActive).toBe(false);
    const missing = stepTracking(createTracking(both), { wristValid: {}, noseValid: true, calibrating: false }, HOLD_AFTER + ONE_MS);
    expect(missing.holdActive).toBe(true);
  });
});

describe('stepTracking, the overlay (Req 18.4)', () => {
  it('shows the overlay in the step in which lost time exceeds trackingOverlayAfterMs during a hold, which keeps counting from before the hold began', () => {
    const exact = play(both, lost(OVERLAY_AFTER));
    expect(exact.last.holdActive).toBe(true);
    expect(exact.steps.every((s) => !s.overlayVisible)).toBe(true);
    expect(exact.last.state.lostMs).toBe(OVERLAY_AFTER);
    const over = play(both, [...lost(OVERLAY_AFTER), step({}, ONE_MS)]);
    expect(beforeLast(over).overlayVisible).toBe(false);
    expect(over.last.overlayVisible).toBe(true);
    expect(kinds(over.last.events)).toEqual(['overlayShown']);
    // Starting the hold did not reset lost time: it kept counting from before the hold, up to the overlay.
    const holdAt = over.steps.findIndex((s) => s.holdActive);
    const overlayAt = over.steps.findIndex((s) => s.overlayVisible);
    expect(over.steps[holdAt]?.state.lostMs).toBeGreaterThan(HOLD_AFTER);
    expect(over.steps[holdAt + 1]?.state.lostMs).toBeGreaterThan(over.steps[holdAt]?.state.lostMs ?? Infinity);
    expect(over.steps[overlayAt]?.state.lostMs).toBe(OVERLAY_AFTER + ONE_MS);
  });

  it('keeps the overlay until the hold ends, through a short valid stretch', () => {
    const shown = play(both, [...lost(OVERLAY_AFTER), step({}, ONE_MS)]);
    const flicker = play(both, [...seen(RESUME - STEP), ...lost(2 * STEP)], shown.last.state);
    expect(flicker.steps.every((s) => s.overlayVisible && s.holdActive)).toBe(true);
    expect(flicker.steps.flatMap((s) => kinds(s.events))).toEqual([]);
  });

  it('does not show it when lost time is reset before it exceeds the threshold', () => {
    const script = [...lost(OVERLAY_AFTER - ONE_MS), step({ right: true }), ...lost(OVERLAY_AFTER - ONE_MS)];
    const played = play(both, script);
    expect(played.steps.some((s) => s.holdActive)).toBe(true);
    expect(played.steps.every((s) => !s.overlayVisible)).toBe(true);
  });
});

describe('stepTracking, the end of the hold (Req 18.5, 18.6)', () => {
  const held = play(both, lost(OVERLAY_AFTER + STEP));

  it('ends the hold and hides the overlay in the step in which continuous valid time reaches trackingResumeMs, and not before (Req 18.6)', () => {
    const nearly = play(both, seen(RESUME - ONE_MS), held.last.state);
    expect(nearly.steps.every((s) => s.holdActive && s.overlayVisible)).toBe(true);
    expect(nearly.last.state.validMs).toBe(RESUME - ONE_MS);
    const reached = play(both, [...seen(RESUME - ONE_MS), step({ left: true }, ONE_MS)], held.last.state);
    expect(beforeLast(reached).holdActive).toBe(true);
    expect(reached.last.holdActive).toBe(false);
    expect(reached.last.overlayVisible).toBe(false);
    expect(kinds(reached.last.events)).toEqual(['holdEnded', 'overlayHidden']);
    // Lost time is 0 in that step (a valid step) and nothing is left running.
    expect(reached.last.state.lostMs).toBe(0);
    expect(reached.last.state.validMs).toBe(0);
    // In full steps: the step that makes the valid time exactly trackingResumeMs ends it.
    const full = play(both, times(RESUME / STEP, step({ right: true })), held.last.state);
    expect(full.steps.map((s) => s.holdActive)).toEqual([...times(RESUME / STEP - 1, true), false]);
  });

  it('resets valid time in any step without a valid wrist, so valid stretches shorter than trackingResumeMs never end it (Req 18.5)', () => {
    const stretch = [...seen(RESUME - STEP), step({}, STEP)];
    const many = play(both, [...stretch, ...stretch, ...stretch, ...stretch], held.last.state);
    expect(many.steps.every((s) => s.holdActive)).toBe(true);
    expect(many.steps.flatMap((s) => kinds(s.events))).toEqual([]);
    // Valid time counts from 0 again after the lost step: the next full second ends the hold.
    const then = play(both, seen(RESUME), many.last.state);
    expect(then.last.holdActive).toBe(false);
    // The lost step keeps counting lost time, so a hold that never ends stays in step with it.
    expect(many.last.state.lostMs).toBe(STEP);
  });

  it('counts valid time only during a hold: valid time before a hold does not end the next one', () => {
    const script = [...seen(RESUME * 2), ...lost(HOLD_AFTER + ONE_MS), ...seen(RESUME - ONE_MS)];
    const played = play(both, script);
    expect(played.last.holdActive).toBe(true);
  });

  it('can begin a new hold after one ends, with lost time counting from 0', () => {
    const ended = play(both, seen(RESUME), held.last.state);
    expect(ended.last.holdActive).toBe(false);
    const again = play(both, [...lost(HOLD_AFTER), step({}, ONE_MS)], ended.last.state);
    expect(again.steps.slice(0, -1).every((s) => !s.holdActive)).toBe(true);
    expect(again.last.holdActive).toBe(true);
    expect(again.last.overlayVisible).toBe(false);
  });
});

describe('stepTracking, the one-wrist hint (Req 18.9)', () => {
  it('shows in the step in which one wrist has been invalid for more than oneWristHintMs while the other is valid, and not before', () => {
    const exact = play(both, stint({ right: true }, HINT_AFTER));
    expect(exact.steps.every((s) => !s.oneWristHint)).toBe(true);
    const over = play(both, [...stint({ right: true }, HINT_AFTER), step({ right: true }, ONE_MS)]);
    expect(beforeLast(over).oneWristHint).toBe(false);
    expect(over.last.oneWristHint).toBe(true);
    expect(over.last.holdActive).toBe(false);
    expect(kinds(over.last.events)).toEqual(['oneWristHintShown']);
    // The same for the other wrist.
    const left = play(both, [...stint({ left: true }, HINT_AFTER), step({ left: true }, ONE_MS)]);
    expect(left.last.oneWristHint).toBe(true);
    expect(left.last.state.hintWrist).toBe('right');
  });

  it('needs another wrist valid in that step: it does not show when both wrists are invalid, before the hold begins', () => {
    // The left wrist has been invalid for more than the hint time, but the right wrist is invalid now too.
    const script = [...stint({ right: true }, HINT_AFTER), step({}, ONE_MS)];
    const played = play(both, script);
    expect(played.last.state.invalidMs.left).toBe(HINT_AFTER + ONE_MS);
    expect(played.last.holdActive).toBe(false);
    expect(played.steps.every((s) => !s.oneWristHint)).toBe(true);
  });

  it('counts the time per wrist without a valid step: a valid step of that wrist starts it again', () => {
    const script = [...stint({ right: true }, HINT_AFTER - ONE_MS), step({ left: true, right: true }, ONE_MS), ...stint({ right: true }, HINT_AFTER - ONE_MS)];
    expect(play(both, script).steps.every((s) => !s.oneWristHint)).toBe(true);
  });

  it('is hidden in the step in which that wrist is valid again', () => {
    const shown = play(both, [...stint({ right: true }, HINT_AFTER), step({ right: true }, ONE_MS)]);
    const back = play(both, [step({ left: true, right: true }, STEP)], shown.last.state);
    expect(back.last.oneWristHint).toBe(false);
    expect(kinds(back.last.events)).toEqual(['oneWristHintHidden']);
  });

  it('is hidden when a hold begins, and only then when the other wrist is lost too', () => {
    const shown = play(both, [...stint({ right: true }, HINT_AFTER), step({ right: true }, ONE_MS)]);
    // Both wrists invalid: the hint stays while lost time is at most trackingHoldAfterMs.
    const bothGone = play(both, lost(HOLD_AFTER), shown.last.state);
    expect(bothGone.steps.every((s) => s.oneWristHint && !s.holdActive)).toBe(true);
    // The step in which the hold begins hides it.
    const begin = play(both, [...lost(HOLD_AFTER), step({}, ONE_MS)], shown.last.state);
    expect(begin.last.holdActive).toBe(true);
    expect(begin.last.oneWristHint).toBe(false);
    expect(kinds(begin.last.events)).toEqual(['holdBegan', 'oneWristHintHidden']);
    // The other wrist coming back before the hold keeps it.
    const flicker = play(both, [...lost(HOLD_AFTER), step({ right: true }, STEP)], shown.last.state);
    expect(flicker.last.oneWristHint).toBe(true);
  });

  it('does not show during a hold, and shows in the step the hold ends for a wrist that never came back', () => {
    const held = play(both, lost(OVERLAY_AFTER + STEP));
    // One wrist comes back; the other has been invalid for over a second, but a hold is on.
    const during = play(both, stint({ right: true }, RESUME - ONE_MS), held.last.state);
    expect(during.steps.every((s) => s.holdActive && !s.oneWristHint)).toBe(true);
    const ends = play(both, [...stint({ right: true }, RESUME - ONE_MS), step({ right: true }, ONE_MS)], held.last.state);
    expect(ends.last.holdActive).toBe(false);
    expect(ends.last.oneWristHint).toBe(true);
    expect(kinds(ends.last.events)).toEqual(['holdEnded', 'overlayHidden', 'oneWristHintShown']);
  });

  it('can never show with one active wrist, or when both wrists are invalid', () => {
    const one = play(rightOnly, stint({ left: true }, LONG_MS));
    expect(one.steps.every((s) => !s.oneWristHint)).toBe(true);
    const oneSeen = play(rightOnly, [...stint({ right: true }, HOLD_AFTER), ...stint({ left: true }, LONG_MS)]);
    expect(oneSeen.steps.every((s) => !s.oneWristHint)).toBe(true);
    const neither = play(both, lost(LONG_MS));
    expect(neither.steps.every((s) => !s.oneWristHint)).toBe(true);
    // A duplicated wrist in the configuration is still one wrist.
    const twice = play({ ...both, activeWrists: ['right', 'right'] }, stint({ left: true }, LONG_MS));
    expect(twice.steps.every((s) => !s.oneWristHint)).toBe(true);
  });
});

describe('stepTracking, calibration and simulated input (Req 6.9, 11.17, 18.10)', () => {
  it('never begins a hold or shows the overlay or the hint while calibration runs, however long no wrist is valid', () => {
    const played = play(both, [...lost(LONG_MS, { calibrating: true }), ...stint({ right: true }, LONG_MS, { calibrating: true })]);
    expect(played.steps.every((s) => !s.holdActive && !s.overlayVisible && !s.oneWristHint)).toBe(true);
    expect(played.steps.flatMap((s) => kinds(s.events))).toEqual([]);
    expect(played.last.state).toEqual(createTracking(both));
  });

  it('counts lost time only from the end of calibration: no hold is due in the first step of play', () => {
    const script = [...lost(LONG_MS, { calibrating: true }), ...lost(HOLD_AFTER), step({}, ONE_MS)];
    const played = play(both, script);
    const first = played.steps[splitMs(LONG_MS).length];
    expect(first?.holdActive).toBe(false);
    expect(played.steps.slice(0, -1).every((s) => !s.holdActive)).toBe(true);
    expect(played.last.holdActive).toBe(true);
  });

  it('counts the invalid time of a wrist only from the end of calibration too', () => {
    const calibrating = stint({ left: true }, LONG_MS, { calibrating: true });
    const exact = play(both, [...calibrating, ...stint({ left: true }, HINT_AFTER)]);
    expect(exact.steps.every((s) => !s.oneWristHint)).toBe(true);
    const over = play(both, [...calibrating, ...stint({ left: true }, HINT_AFTER), step({ left: true }, ONE_MS)]);
    expect(over.last.oneWristHint).toBe(true);
  });

  it('ends a hold, and hides what was shown, in the step in which calibration starts', () => {
    const shown = play(both, [...lost(OVERLAY_AFTER), step({}, ONE_MS)]);
    const start = play(both, [step({}, STEP, { calibrating: true })], shown.last.state);
    expect(kinds(start.last.events)).toEqual(['holdEnded', 'overlayHidden']);
    expect(start.last.holdActive).toBe(false);
    expect(start.last.state).toEqual(createTracking(both));
    const hinted = play(both, [...stint({ right: true }, HINT_AFTER), step({ right: true }, ONE_MS)]);
    expect(kinds(play(both, [step({ right: true }, STEP, { calibrating: true })], hinted.last.state).last.events)).toEqual(['oneWristHintHidden']);
  });

  it('never begins a hold and never shows the hint in simulated input mode', () => {
    const played = play(simulated, [...lost(LONG_MS), ...stint({ right: true }, LONG_MS), ...lost(OVERLAY_AFTER + RESUME)]);
    expect(played.steps.every((s) => !s.holdActive && !s.overlayVisible && !s.oneWristHint)).toBe(true);
    expect(played.steps.flatMap((s) => kinds(s.events))).toEqual([]);
    const twoWrists = play({ ...simulated, activeWrists: ['left', 'right'] }, stint({ right: true }, LONG_MS));
    expect(twoWrists.steps.every((s) => !s.oneWristHint)).toBe(true);
  });
});

describe('stepTracking with a presence delta of 0 (a pause or a hidden tab)', () => {
  it('advances no timer: it begins no hold, shows no overlay or hint, and ends no hold, whatever the wrists do', () => {
    // Lost time exactly at each threshold, then any number of steps of delta 0 with every combination of validity.
    const pause = (n: number): Move[] => times(n, step({})).map((m, i) => ({ ...m, dt: 0, left: i % 3 === 1, right: i % 5 === 2 }));
    const none = [step({}, 0), step({ left: true, right: true }, 0), step({ left: true }, 0), step({ right: true }, 0)];
    // A hold does not begin at the threshold, by delta 0.
    const atHold = play(both, [...lost(HOLD_AFTER), ...times(8, step({}, 0))]);
    expect(atHold.steps.every((s) => !s.holdActive)).toBe(true);
    // The overlay does not show at its threshold, by delta 0.
    const atOverlay = play(both, [...lost(OVERLAY_AFTER), ...times(8, step({}, 0))]);
    expect(atOverlay.steps.slice(-8).every((s) => s.holdActive && !s.overlayVisible)).toBe(true);
    // A hold does not end one millisecond before trackingResumeMs, by delta 0.
    const held = play(both, lost(OVERLAY_AFTER + STEP));
    const nearlyBack = play(both, [...seen(RESUME - ONE_MS), ...none, ...none, ...pause(6).filter((m) => m.left || m.right)], held.last.state);
    expect(nearlyBack.steps.every((s) => s.holdActive)).toBe(true);
    // The hint does not show at its threshold, by delta 0.
    const atHint = play(both, [...stint({ right: true }, HINT_AFTER), ...times(8, step({ right: true }, 0))]);
    expect(atHint.steps.every((s) => !s.oneWristHint)).toBe(true);
    expect(atHint.steps.flatMap((s) => kinds(s.events))).toEqual([]);
  });

  it('still resets a timer in a valid step: lost time is the time since the last valid step', () => {
    const played = play(both, [...lost(HOLD_AFTER), step({ left: true }, 0), ...lost(HOLD_AFTER)]);
    expect(played.steps.every((s) => !s.holdActive)).toBe(true);
    expect(play(both, [...lost(HOLD_AFTER), step({ left: true }, 0), ...lost(HOLD_AFTER), step({}, ONE_MS)]).last.holdActive).toBe(true);
  });
});

describe('stepTracking, outputs and arguments', () => {
  it('gives each flag of the step as in the state, and an event only where a flag changes', () => {
    const script = [...seen(500), ...lost(OVERLAY_AFTER + STEP), ...stint({ right: true }, RESUME), ...stint({ left: true }, HINT_AFTER + STEP), ...seen(300)];
    const played = play(both, script);
    let before = createTracking(both);
    for (const s of played.steps) {
      expect([s.holdActive, s.overlayVisible, s.oneWristHint]).toEqual([s.state.holdActive, s.state.overlayVisible, s.state.hintWrist !== null]);
      const expected: string[] = [];
      if (s.holdActive !== before.holdActive) expected.push(s.holdActive ? 'holdBegan' : 'holdEnded');
      if (s.overlayVisible !== before.overlayVisible) expected.push(s.overlayVisible ? 'overlayShown' : 'overlayHidden');
      if (s.oneWristHint !== (before.hintWrist !== null)) expected.push(s.oneWristHint ? 'oneWristHintShown' : 'oneWristHintHidden');
      expect(kinds(s.events)).toEqual(expected);
      before = s.state;
    }
  });

  it('reads every threshold from the tuning of the configuration', () => {
    const quick = { ...TUNING, trackingHoldAfterMs: STEP, trackingOverlayAfterMs: 2 * STEP, trackingResumeMs: 2 * STEP, oneWristHintMs: STEP };
    const cfg: TrackingConfig = { activeWrists: ['left', 'right'], mode: 'camera', tuning: quick };
    const hold = play(cfg, [step({}), step({})]);
    expect(hold.steps.map((s) => s.holdActive)).toEqual([false, true]);
    const overlay = play(cfg, times(3, step({})));
    expect(overlay.steps.map((s) => s.overlayVisible)).toEqual([false, false, true]);
    const end = play(cfg, [step({}), step({}), step({ left: true }), step({ left: true })], createTracking(cfg));
    expect(end.steps.map((s) => s.holdActive)).toEqual([false, true, true, false]);
    const hint = play(cfg, [step({ left: true }), step({ left: true })]);
    expect(hint.steps.map((s) => s.oneWristHint)).toEqual([false, true]);
  });

  it('leaves the state and the input as they were', () => {
    const deepFreeze = <T>(value: T): T => {
      if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    let state = deepFreeze(createTracking(both));
    for (const m of [...lost(OVERLAY_AFTER + STEP), ...seen(RESUME), ...stint({ right: true }, HINT_AFTER + STEP)]) {
      const input = deepFreeze({ wristValid: { left: m.left, right: m.right }, noseValid: m.nose, calibrating: m.calibrating });
      const before = structuredClone({ state, input });
      const result = stepTracking(state, input, m.dt);
      expect(structuredClone({ state, input })).toEqual(before);
      state = deepFreeze(result.state);
    }
  });
});

describe('marrow/core', () => {
  it('exports createTracking and stepTracking (design section 6)', () => {
    expect(core.createTracking).toBe(createTracking);
    expect(core.stepTracking).toBe(stepTracking);
  });
});

/** `one` repeated `count` times. */
function times<T>(count: number, one: T): T[] {
  return Array.from({ length: count }, () => one);
}
