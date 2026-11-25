// The Whisper Glade rule (garden-level design 2.7; requirements 5.1 to 5.8, 6, 7.5). Pure: it reads no clock, no
// randomness and no help level. Time arrives as dtMs, and the order of the presentations arrives from the seeded
// generator passed to startWhisperGlade. The attention round (marrow's challenges) runs the presentations. The
// stimulus of a presentation is the stem of its spirit, and each spirit has one hit target (spiritTargetId). This rule
// holds no text: the line of each step is a copy key the driver looks up.
import {
  attentionWindowsFor,
  createAttentionRound,
  currentPresentation,
  orderBlocks,
  stepAttention,
  type AttentionEvent,
  type AttentionInput,
  type AttentionState,
  type Presentation,
  type Rng,
} from 'marrow/challenges';
import type { MotionLevel } from 'marrow/core';
import type { Block, WhisperGladeContent } from './content';
import { initialPath, pathChoice, pathOptionSelected, type PathState } from './pathChoice';

/** The target id of a spirit: it names the spirit by its stem, so the drawing and the hit test agree. */
export function spiritTargetId(stem: string): string {
  return `spirit-${stem}`;
}

export interface WhisperState {
  /** The rule of each block, in block order: which spirit to select and which to let pass (Req 5.2). */
  readonly rules: readonly Block[];
  /** The attention round: six presentations in two blocks, with the demonstration between them (Req 5.1, 5.3). */
  readonly attention: AttentionState;
  /** The path choice, which opens when the attention round has finished (Req 8.1). */
  readonly path: PathState;
}

/**
 * The Whisper Glade state at the start. The presentations of each block take their order from the seeded generator
 * (Req 5.5). The attention round runs with the windows of the motion level (Req 6.5), and it returns the generator after
 * the shuffles, so the caller can keep threading it.
 */
export function startWhisperGlade(content: WhisperGladeContent, rng: Rng, motion: MotionLevel): { state: WhisperState; rng: Rng } {
  const blocks: Presentation[][] = content.blocks.map((block) =>
    block.marks.map((mark) => ({ stimulusId: mark === 'select' ? block.select : block.pass, mark })),
  );
  const ordered = orderBlocks(blocks, rng);
  const attention = createAttentionRound(attentionWindowsFor(motion), ordered.blocks);
  return { state: { rules: content.blocks, attention, path: initialPath() }, rng: ordered.rng };
}

/**
 * One step. A selection of the current spirit's target is a dwell on the current stimulus (a select completes, a let-pass
 * is a mistake). `helpRequested` is "Continue with help", which ends a demonstration and completes the current
 * presentation with help. Once the attention round has finished, the path targets are open. The step returns the
 * attention events, which the driver maps to help events.
 */
/**
 * The target id of the spirit presented now, or null. A demonstration, the path choice and the end of the round present
 * no spirit, so none of them has a spirit target (Req 5.3, 8.1).
 */
export function presentedTargetId(state: WhisperState): string | null {
  if (state.path.phase !== 'waiting') return null;
  const presentation = currentPresentation(state.attention);
  return presentation === null ? null : spiritTargetId(presentation.stimulusId);
}

export function stepWhisperGlade(
  state: WhisperState,
  selectedTargetIds: readonly string[],
  dtMs: number,
  helpRequested = false,
): { state: WhisperState; events: readonly AttentionEvent[]; completed: boolean } {
  // A path option selected while the path is open completes the stage (Req 8.1). The path is open only after the round,
  // so a selection during the round names no option and falls through to the spirits.
  const option = state.path.phase === 'open' ? pathOptionSelected(selectedTargetIds) : null;
  if (option !== null) {
    return { state: { ...state, path: pathChoice(state.path, option) }, events: [], completed: true };
  }
  const presentation = currentPresentation(state.attention);
  let input: AttentionInput | null = null;
  if (helpRequested) {
    input = { kind: 'helpRequested' };
  } else if (presentation !== null && selectedTargetIds.includes(spiritTargetId(presentation.stimulusId))) {
    input = { kind: 'dwellSelected', stimulusId: presentation.stimulusId };
  }
  const step = stepAttention(state.attention, input, dtMs);
  const opened = step.state.phase === 'finished' && state.path.phase === 'waiting';
  const path = opened ? { ...state.path, phase: 'open' as const } : state.path;
  return { state: { ...state, attention: step.state, path }, events: step.events, completed: false };
}

/**
 * The copy key of the instruction line now (Req 5.8, 14). During a demonstration the line is the demonstration line. A
 * presentation uses the keys of the rule of the current block: a select line names the select spirit, a pass line the
 * pass spirit, and a repeat after a mistake uses the mistake key. When the path targets are open, the line is the path
 * line. Null when no line is due.
 */
export function lineKey(state: WhisperState): string | null {
  if (state.path.phase === 'open') return 'path.choose';
  if (state.path.phase === 'chosen') return null;
  if (state.attention.phase === 'demonstration') return 'whisper.demo';
  const presentation = currentPresentation(state.attention);
  const rule = state.rules[state.attention.block];
  if (presentation === null || rule === undefined) return null;
  const stem = presentation.mark === 'select' ? rule.select : rule.pass;
  const prefix = state.attention.hint ? 'mistake' : 'whisper';
  return `${prefix}.${presentation.mark}.${stem}`;
}
