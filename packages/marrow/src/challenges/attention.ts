// The attention round (garden-level design section 2.3, requirements 6 and 7). It is a pure reducer:
// stepAttention(state, input, dtMs) returns the next state and the events of that step. It reads no
// clock (dtMs is the session delta), no randomness (blocks arrive ordered by orderBlocks), and no
// stimulus content (a stimulus is an opaque id). It does not call the help policy: the caller maps
// the events to help events.
//
// Time model. One step does these things, in order:
//   1. The clock advances by dtMs. A negative or non-finite dtMs counts as 0.
//   2. Timeouts. A let-pass whose window has ended completes. A select whose window has ended, with
//      no dwell held, is a windowEnded mistake. When either happens, the step ends and its input is ignored.
//   3. The input is judged at the clock time after step 1. A dwell on the current stimulus is judged
//      here. A dwell on a let-pass inside its window is a dwellOnPass mistake. A select dwell is held.
//      "Continue with help" marks the presentation as help-completed.
//   4. A held select dwell, or a help or forced completion, completes once the clock is at or past
//      presentationMinMs. A completion or a new presentation drops the time left in the step.
// A mistake restarts the clock at 0 for the repeat of the same presentation. The repeat emits no
// presentationStarted; the mistake event marks it. A forced completion (third mistake) and a help
// completion wait for presentationMinMs from the last mistake or from the start. Inputs during that
// wait are ignored and add no mistakes.
//
// Phases. "starting" lasts one step: that step announces the first presentation. "demonstration"
// runs before each block after the first and is not a presentation.

import type { MotionLevel } from '../core';
import { shuffle, type Rng } from './rng';
import { ATTENTION_TUNING, type AttentionTuning } from './tuning';

/** The rule of one presentation. Select: take it. Pass: let it go. */
export type Mark = 'select' | 'pass';

/** One presentation. The id is opaque to the round. */
export interface Presentation {
  readonly stimulusId: string;
  readonly mark: Mark;
}

/** The windows and thresholds of one round, in milliseconds or counts. */
export interface AttentionWindows {
  readonly presentationMinMs: number;
  readonly demonstrationMs: number;
  readonly selectMs: number;
  readonly letPassMs: number;
  readonly offerAfter: number;
  readonly forceAfter: number;
}

/** The windows for a motion level. Reduced motion uses the Gentle windows (design decision 3). */
export function attentionWindowsFor(motion: MotionLevel, t: AttentionTuning = ATTENTION_TUNING): AttentionWindows {
  const gentle = motion !== 'full';
  return {
    presentationMinMs: t.presentationMinMs,
    demonstrationMs: t.demonstrationMs,
    selectMs: gentle ? t.selectWindowGentleMs : t.selectWindowFullMs,
    letPassMs: gentle ? t.letPassWindowGentleMs : t.letPassWindowFullMs,
    offerAfter: t.offerHelpAfterMistakes,
    forceAfter: t.forceCompleteAfterMistakes,
  };
}

/** The problems with one block: an empty list when it has a select and a let-pass presentation (requirements 5.4). */
export function blockProblems(block: readonly Presentation[]): string[] {
  const problems: string[] = [];
  if (!block.some((p) => p.mark === 'select')) problems.push('a block needs at least one select presentation');
  if (!block.some((p) => p.mark === 'pass')) problems.push('a block needs at least one let-pass presentation');
  return problems;
}

/**
 * The blocks with the presentations inside each block shuffled by the generator (requirements 5.5). The
 * blocks keep their order and their presentations. The generator is threaded through the blocks in order.
 */
export function orderBlocks(
  blocks: readonly (readonly Presentation[])[],
  rng: Rng,
): { blocks: readonly (readonly Presentation[])[]; rng: Rng } {
  let current = rng;
  const ordered: (readonly Presentation[])[] = [];
  for (const block of blocks) {
    const shuffled = shuffle(block, current);
    ordered.push(shuffled.items);
    current = shuffled.rng;
  }
  return { blocks: ordered, rng: current };
}

export type AttentionPhase = 'starting' | 'demonstration' | 'presenting' | 'finished';

/** The round in progress. `completed` never decreases (requirements 6.7). */
export interface AttentionState {
  readonly windows: AttentionWindows;
  readonly blocks: readonly (readonly Presentation[])[];
  readonly block: number;
  readonly index: number;
  readonly phase: AttentionPhase;
  /** Milliseconds since the presentation started or since its last mistake, or since the demonstration started. */
  readonly elapsedMs: number;
  /** Mistakes on the current presentation. */
  readonly mistakes: number;
  /** A select dwell is held, waiting for presentationMinMs. */
  readonly selectedEarly: boolean;
  /** A completion waiting for presentationMinMs: "forced" after the third mistake, "help" after "continue with help". */
  readonly pending: 'forced' | 'help' | null;
  readonly completed: number;
  /** The repeat after a mistake shows its hint. */
  readonly hint: boolean;
}

export type AttentionInput =
  | { readonly kind: 'dwellSelected'; readonly stimulusId: string }
  | { readonly kind: 'helpRequested' };

export type AttentionEvent =
  | { readonly kind: 'demonstrationStarted'; readonly block: number }
  | {
      readonly kind: 'presentationStarted';
      readonly block: number;
      readonly index: number;
      readonly stimulusId: string;
      readonly mark: Mark;
    }
  | {
      readonly kind: 'mistake';
      readonly stimulusId: string;
      readonly count: number;
      readonly reason: 'windowEnded' | 'dwellOnPass';
      readonly offerHelp: boolean;
      readonly forced: boolean;
    }
  | { readonly kind: 'presentationCompleted'; readonly stimulusId: string; readonly byHelp: boolean }
  | { readonly kind: 'roundFinished' };

/** A round ready to start. The first step announces the first presentation. */
export function createAttentionRound(windows: AttentionWindows, blocks: readonly (readonly Presentation[])[]): AttentionState {
  return {
    windows,
    blocks,
    block: 0,
    index: 0,
    phase: blocks.length > 0 ? 'starting' : 'finished',
    elapsedMs: 0,
    mistakes: 0,
    selectedEarly: false,
    pending: null,
    completed: 0,
    hint: false,
  };
}

/** The presentation on screen (or announced next), or null during a demonstration or after the round. */
export function currentPresentation(state: AttentionState): Presentation | null {
  if (state.phase !== 'starting' && state.phase !== 'presenting') return null;
  return state.blocks[state.block]?.[state.index] ?? null;
}

function current(state: AttentionState): Presentation | undefined {
  return state.blocks[state.block]?.[state.index];
}

/** Starts the presentation at (block, index): announces it and clears the per-presentation fields. */
function begin(state: AttentionState, events: AttentionEvent[]): AttentionState {
  const p = current(state);
  if (p === undefined) return { ...state, phase: 'finished' };
  events.push({
    kind: 'presentationStarted',
    block: state.block,
    index: state.index,
    stimulusId: p.stimulusId,
    mark: p.mark,
  });
  return {
    ...state,
    phase: 'presenting',
    elapsedMs: 0,
    mistakes: 0,
    selectedEarly: false,
    pending: null,
    hint: false,
  };
}

/** Moves on after a completion: the next presentation of the block, a demonstration, or the end of the round. */
function advance(state: AttentionState, events: AttentionEvent[]): AttentionState {
  const blockLength = state.blocks[state.block]?.length ?? 0;
  if (state.index + 1 < blockLength) return begin({ ...state, index: state.index + 1 }, events);
  const nextBlock = state.block + 1;
  if (nextBlock < state.blocks.length) {
    events.push({ kind: 'demonstrationStarted', block: nextBlock });
    return {
      ...state,
      block: nextBlock,
      index: 0,
      phase: 'demonstration',
      elapsedMs: 0,
      mistakes: 0,
      selectedEarly: false,
      pending: null,
      hint: false,
    };
  }
  events.push({ kind: 'roundFinished' });
  return { ...state, phase: 'finished', elapsedMs: 0, selectedEarly: false, pending: null, hint: false };
}

function complete(state: AttentionState, byHelp: boolean, events: AttentionEvent[]): AttentionState {
  const p = current(state);
  if (p === undefined) return state;
  events.push({ kind: 'presentationCompleted', stimulusId: p.stimulusId, byHelp });
  return advance({ ...state, completed: state.completed + 1 }, events);
}

/** A mistake on the current presentation: the repeat starts its clock again, and the third one forces completion. */
function mistake(state: AttentionState, reason: 'windowEnded' | 'dwellOnPass', events: AttentionEvent[]): AttentionState {
  const p = current(state);
  if (p === undefined) return state;
  const count = state.mistakes + 1;
  const offerHelp = count >= state.windows.offerAfter;
  const forced = count >= state.windows.forceAfter;
  events.push({ kind: 'mistake', stimulusId: p.stimulusId, count, reason, offerHelp, forced });
  return {
    ...state,
    mistakes: count,
    hint: true,
    elapsedMs: 0,
    pending: forced ? 'forced' : state.pending,
  };
}

function presenting(state: AttentionState, input: AttentionInput | null, events: AttentionEvent[]): AttentionState {
  const p = current(state);
  if (p === undefined) return state;
  const { windows } = state;
  let next = state;

  // Step 2: timeouts. A pending completion has no window to end, since presentationMinMs is shorter than every window.
  if (next.pending === null) {
    if (p.mark === 'pass' && next.elapsedMs >= windows.letPassMs) return complete(next, false, events);
    if (p.mark === 'select' && !next.selectedEarly && next.elapsedMs >= windows.selectMs) {
      return mistake(next, 'windowEnded', events);
    }
  }

  // Step 3: the input, judged at the clock time after step 1. Input is ignored while a completion is pending.
  if (input !== null && next.pending === null) {
    if (input.kind === 'dwellSelected' && input.stimulusId === p.stimulusId) {
      if (p.mark === 'pass') return mistake(next, 'dwellOnPass', events);
      next = { ...next, selectedEarly: true };
    } else if (input.kind === 'helpRequested') {
      next = { ...next, pending: 'help' };
    }
  }

  // Step 4: a held select dwell, or a help or forced completion, completes at presentationMinMs.
  if (next.pending !== null && next.elapsedMs >= windows.presentationMinMs) {
    return complete(next, true, events);
  }
  if (next.pending === null && next.selectedEarly && next.elapsedMs >= windows.presentationMinMs) {
    return complete(next, false, events);
  }
  return next;
}

function demonstrating(state: AttentionState, input: AttentionInput | null, events: AttentionEvent[]): AttentionState {
  if (state.elapsedMs >= state.windows.demonstrationMs || input?.kind === 'helpRequested') {
    return begin(state, events);
  }
  return state;
}

/**
 * One step of the round (see the time model above). `dtMs` is the session delta since the previous step.
 * The state argument is not changed.
 */
export function stepAttention(
  state: AttentionState,
  input: AttentionInput | null,
  dtMs: number,
): { state: AttentionState; events: readonly AttentionEvent[] } {
  const events: AttentionEvent[] = [];
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const clocked: AttentionState = { ...state, elapsedMs: state.elapsedMs + dt };
  switch (state.phase) {
    case 'finished':
      return { state, events };
    case 'starting':
      return { state: begin(state, events), events };
    case 'demonstration':
      return { state: demonstrating(clocked, input, events), events };
    case 'presenting':
      return { state: presenting(clocked, input, events), events };
  }
}
