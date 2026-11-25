// The placeholder rule of Whisper Hall and Bloom (design 2.7; Req 9.1, 9.2). A stage has one target. Selecting it
// completes the stage, and the completion stays once it has happened. The rule is pure: it reads no clock, no
// randomness and no help level.
import type { PlaceholderContent } from './placeholderContent';

export interface PlaceholderState {
  readonly targetId: string;
  readonly done: boolean;
}

/** The id of the stage's one target. */
export function targetIdOf(content: PlaceholderContent): string {
  return `${content.id}:target`;
}

export function createPlaceholder(content: PlaceholderContent): PlaceholderState {
  return { targetId: targetIdOf(content), done: false };
}

/** One step: the stage completes when its target is among the selected ids. A completed stage stays completed. */
export function stepPlaceholder(
  state: PlaceholderState,
  selectedTargetIds: readonly string[],
): { state: PlaceholderState; completed: boolean } {
  const completed = state.done || selectedTargetIds.includes(state.targetId);
  return { state: completed === state.done ? state : { ...state, done: true }, completed };
}
