// The path choice of Whisper Glade (garden-level design 2.7; requirements 8.1 to 8.5). Two targets follow the attention
// round: the fireflies on the left and the candles on the right. Either pointer can select either one (Req 8.2). The
// choice is stored as the dressing of journey B and changes nothing else (Req 8.4). The state holds no geometry, so the
// journey B segment is the same for both options (Req 8.3).

/** The two options of the path choice. Left is the fireflies, right is the candles (Req 8.1). */
export type PathOption = 'fireflies' | 'candles';

/**
 * waiting: the attention round is running. open: the path targets can be selected. chosen: one option was selected,
 * and the stage is complete.
 */
export type PathPhase = 'waiting' | 'open' | 'chosen';

export interface PathState {
  readonly phase: PathPhase;
  /** The option chosen, which only changes the dressing along journey B (Req 8.4). Null until a choice is made. */
  readonly dressing: PathOption | null;
}

/** The target id of each option, as the hit test and the markers name them. Ids name options, never wrists (Req 8.2). */
export const PATH_TARGET_IDS: Readonly<Record<PathOption, string>> = Object.freeze({
  fireflies: 'path-fireflies',
  candles: 'path-candles',
});

/** The path state before the attention round ends. */
export function initialPath(): PathState {
  return { phase: 'waiting', dressing: null };
}

/**
 * The option that a selection names, or null. The first selected path target wins. A selection of any other target
 * names no option.
 */
export function pathOptionSelected(selectedTargetIds: readonly string[]): PathOption | null {
  for (const option of ['fireflies', 'candles'] as const) {
    if (selectedTargetIds.includes(PATH_TARGET_IDS[option])) return option;
  }
  return null;
}

/**
 * The path after a choice. Only an open path takes a choice (Req 8.1); a waiting or chosen path is returned as it is.
 * The choice sets the dressing and nothing else.
 */
export function pathChoice(path: PathState, option: PathOption): PathState {
  if (path.phase !== 'open') return path;
  return { phase: 'chosen', dressing: option };
}
