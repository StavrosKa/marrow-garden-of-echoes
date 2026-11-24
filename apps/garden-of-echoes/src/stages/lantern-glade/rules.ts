// The Lantern Glade rule (garden-level design 2.7; requirements 4.1 to 4.4, 4.5; steering 7). Pure: it reads no clock,
// no randomness and no help level. Time arrives as dtMs. The lanterns are placed by placeRound, and this rule only
// takes the slots it is given (Req 4.5). It holds no text: the line of each step is a copy key the driver looks up.
import { TUNING, type MotionLevel } from 'marrow/core';
import type { WorldPoint } from 'world-view';
import type { PlacedRound } from '../shared/placeRound';
import { LANTERN_COUNT, type LanternGladeContent } from './content';

/** The target id of a lantern: its index in the order of the stage. */
export function targetIdOf(index: number): string {
  return `lantern-${index}`;
}

export interface LanternState {
  /** The notes of the lanterns, in order (Req 4.2). */
  readonly notes: readonly string[];
  /** The copy keys of the two lantern lines (Req 4.1). */
  readonly copy: { readonly first: string; readonly next: string };
  /** The slot of each lantern, from placeRound. Length LANTERN_COUNT. */
  readonly points: readonly WorldPoint[];
  readonly motion: MotionLevel;
  /** The active lantern. It equals LANTERN_COUNT once every lantern is lit. */
  readonly next: number;
  /** Time since the last lantern was lit, capped at the light ease (Req 4.3). */
  readonly sinceLitMs: number;
  /** True from the selection of the fourth lantern: the path is lit (Req 4.4). */
  readonly completed: boolean;
}

export interface LanternStep {
  readonly state: LanternState;
  /** True only in the step that lights the fourth lantern. */
  readonly completed: boolean;
  /** The note of the lantern selected in this step, or null. */
  readonly note: string | null;
  /** The index of the colour patch revealed in this step, or null (Req 4.2). */
  readonly patch: number | null;
}

/** The number of lanterns the stage lights (Req 4.1). */
export { LANTERN_COUNT };

/**
 * The stage's state at the start. The placed round must hold one slot per lantern. The driver starts a stage only when
 * placeRound gives slots, so a round with fewer slots is a programming error here.
 */
export function createLanternGlade(content: LanternGladeContent, placed: PlacedRound, motion: MotionLevel): LanternState {
  if (placed.points.length < LANTERN_COUNT) {
    throw new Error(`lantern-glade needs ${LANTERN_COUNT} slots; the placed round has ${placed.points.length}`);
  }
  return {
    notes: content.notes,
    copy: content.copy,
    points: placed.points.slice(0, LANTERN_COUNT),
    motion,
    next: 0,
    sinceLitMs: TUNING.uiMinLightEaseMs,
    completed: false,
  };
}

/** The lanterns that can be selected now: the active one, and none once the path is lit. */
export function activeLanternIds(state: LanternState): string[] {
  return state.completed ? [] : [targetIdOf(state.next)];
}

/** The copy key of the instruction line now: the tutorial line for the first lantern, then the next line (Req 4.1). */
export function lineKey(state: LanternState): string | null {
  if (state.completed) return null;
  return state.next === 0 ? state.copy.first : state.copy.next;
}

/**
 * One step: the time moves the light on, and a selection of the active lantern lights it (Req 4.2). Selecting the
 * fourth lantern lights the path and completes the stage once. A selection after that, or of another lantern, does
 * nothing. A dtMs that is not finite or is 0 or less adds no time.
 */
export function stepLanternGlade(state: LanternState, selectedTargetIds: readonly string[], dtMs: number): LanternStep {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const aged: LanternState = { ...state, sinceLitMs: Math.min(TUNING.uiMinLightEaseMs, state.sinceLitMs + dt) };
  if (state.completed || !selectedTargetIds.includes(targetIdOf(state.next))) {
    return { state: aged, completed: false, note: null, patch: null };
  }
  const index = state.next;
  const next = index + 1;
  const done = next === LANTERN_COUNT;
  return {
    state: { ...aged, next, sinceLitMs: 0, completed: done },
    completed: done,
    note: state.notes[index] ?? null,
    patch: index,
  };
}

/** The smootherstep of a fraction in 0..1 (the ease of world-view, which the app does not import). */
function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * The light of the most recently lit lantern, from 0 to 1 (Req 4.3, 17.1). It rises over the light ease of marrow's
 * tuning after each lantern is lit, and it is 1 at all other times. The flicker of the light is in scene/flicker.ts,
 * which keeps Reduced motion steady.
 */
export function lightLevel(state: LanternState): number {
  return ease(state.sinceLitMs / TUNING.uiMinLightEaseMs);
}
