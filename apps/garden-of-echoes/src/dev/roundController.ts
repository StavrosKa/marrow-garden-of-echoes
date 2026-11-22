// The round controller of the input playground (design sections 14.2 and 14.3, Req 26.4, 26.9, 26.10). It keeps
// the play-area slot filter, the rotation of the slots and the placement of each round. The rounds use the
// Placement of marrow/core. The Pause and hold flags never reach this file (Req 18.11, 23.3).
import {
  isSlotUsable,
  placeTargets,
  TUNING,
  type CalibrationResult,
  type Demand,
  type Mapping,
  type PlacementResult,
  type Vec2,
} from 'marrow/core';
import type { PlaygroundContent } from './playgroundContent';

/** The comfort grids of the calibration that completed (Req 26.4). */
export type Grids = CalibrationResult['grids'];

/** The margin m of design section 14.2. The playground has no parallax, so it is zero. */
export const ROUND_MARGIN = 0;

/**
 * A round avoids the last round's slots only when at least this many slots are usable (Req 26.10). The
 * task sets it at 6 for three targets, so it is twice the target count.
 */
const AVOID_USABLE_PER_TARGET = 2;

/** A slot that survived the play-area filter, with its position in the filtered list. */
export interface PlaySlot {
  readonly position: number;
  readonly slot: Vec2;
}

/** One target of a round. Its id and its activation id are new in each round (Req 26.10). */
export interface RoundTarget {
  readonly id: string;
  readonly activationId: string;
  readonly slot: Vec2;
  /** The position of the slot in the filtered list. */
  readonly slotPosition: number;
}

export type RoundMode = 'simultaneous' | 'sequential' | 'none';

/** The state of the round controller. `targets` is empty when `mode` is `none`. */
export interface RoundState {
  /** The round number, from 1. */
  readonly round: number;
  readonly mode: RoundMode;
  readonly targets: readonly RoundTarget[];
  /** The ids of the targets the player has completed in this round. */
  readonly completed: readonly string[];
  /** The position in the filtered list where the next round starts (Req 26.10). */
  readonly cursor: number;
  /** The positions of the slots this round uses, which the next round avoids when it can. */
  readonly usedPositions: readonly number[];
}

/** What the controller reacts to. The pause and hold flags are not events of this controller. */
export type RoundEvent = { readonly kind: 'start' } | { readonly kind: 'targetCompleted'; readonly targetId: string };

/** What a round needs from the calibration and the window. */
export interface RoundEnvironment {
  readonly content: PlaygroundContent;
  /** The play-area aspect A, from the current window. */
  readonly playAspect: number;
  /** The frame aspect a of the calibrated frame: A in simulated input. */
  readonly frameAspect: number;
  /** The comfort grids of the completed calibration. They never change after it (Req 14.7). */
  readonly grids: Grids;
  /** The mapping of the completed calibration, with its gain and centre. */
  readonly mapping: Mapping;
}

/**
 * The play-area slot filter (design section 14.2). A slot stays when its circle of radius r + m lies inside
 * [0, A] x [0, 1]. A circle that touches an edge stays, because the box is closed.
 */
export function filterSlots(slots: readonly Vec2[], playAspect: number): PlaySlot[] {
  const radius = TUNING.hitRadius + ROUND_MARGIN;
  const kept = slots.filter(
    (slot) =>
      slot.x - radius >= 0 && slot.x + radius <= playAspect && slot.y - radius >= 0 && slot.y + radius <= 1,
  );
  return kept.map((slot, position) => ({ position, slot }));
}

/** The demand the calibration checks at the end of painting (design section 14.2): N, r = hitRadius, m = 0. */
export function calibrationDemand(content: PlaygroundContent, playAspect: number): Demand {
  return {
    slots: filterSlots(content.slots, playAspect).map((entry) => entry.slot),
    n: content.targetCount,
    r: TUNING.hitRadius,
    m: ROUND_MARGIN,
  };
}

/** The targets one placement chose, in target order, with their positions in the list it was given. */
interface Placed {
  readonly mode: RoundMode;
  readonly picks: readonly PlaySlot[];
}

/** Maps a slot object that placeTargets returned back to its entry. Placement returns the caller's own objects. */
function entryOf(list: readonly PlaySlot[], slot: Vec2): PlaySlot {
  const entry = list.find((candidate) => candidate.slot === slot);
  if (entry === undefined) throw new Error('placeTargets returned a slot that was not given to it');
  return entry;
}

function placeOn(list: readonly PlaySlot[], env: RoundEnvironment): Placed {
  const demand: Demand = {
    slots: list.map((entry) => entry.slot),
    n: env.content.targetCount,
    r: TUNING.hitRadius,
    m: ROUND_MARGIN,
  };
  const result: PlacementResult = placeTargets(demand, env.grids, env.mapping, TUNING);
  if (result.kind === 'none') return { mode: 'none', picks: [] };
  if (result.kind === 'simultaneous') {
    return { mode: 'simultaneous', picks: result.slots.map((slot) => entryOf(list, slot)) };
  }
  // Sequential: target i is shown alone in targetSlots[i] (Req 14.5).
  return { mode: 'sequential', picks: result.targetSlots.map((slot) => entryOf(list, slot)) };
}

/** How many slots of the list pass isSlotUsable (Req 14.2). This is the count the "at least 6 usable" rule reads. */
function countUsable(list: readonly PlaySlot[], env: RoundEnvironment): number {
  return list.filter(
    (entry) =>
      isSlotUsable(entry.slot, env.grids, env.mapping, TUNING.hitRadius, ROUND_MARGIN, TUNING) !== null,
  ).length;
}

/** Starts a new round. The first round after calibration has no previous round, so nothing is avoided. */
export function startRound(previous: RoundState | null, env: RoundEnvironment): RoundState {
  const round = (previous?.round ?? 0) + 1;
  const all = filterSlots(env.content.slots, env.playAspect);
  const count = all.length;
  const cursor = count === 0 ? 0 : (previous?.cursor ?? 0) % count;
  const rotated = [...all.slice(cursor), ...all.slice(0, cursor)];
  const full = placeOn(rotated, env);

  let picked = full;
  const previousPositions = new Set(previous?.usedPositions ?? []);
  const avoidable = previous !== null && countUsable(rotated, env) >= AVOID_USABLE_PER_TARGET * env.content.targetCount;
  if (avoidable) {
    const candidates = rotated.filter((entry) => !previousPositions.has(entry.position));
    const avoiding = placeOn(candidates, env);
    // Avoiding gives none, or fewer simultaneous targets than the full list: the full list is used instead.
    const losesSimultaneous = full.mode === 'simultaneous' && avoiding.mode !== 'simultaneous';
    if (avoiding.mode !== 'none' && !losesSimultaneous) picked = avoiding;
  }

  const targets: RoundTarget[] = picked.picks.map((entry, index) => ({
    id: `r${round}-${index}`,
    activationId: `r${round}-${index}`,
    slot: entry.slot,
    slotPosition: entry.position,
  }));
  const last = picked.picks.at(-1);
  return {
    round,
    mode: picked.mode,
    targets,
    completed: [],
    cursor: last === undefined || count === 0 ? cursor : (last.position + 1) % count,
    usedPositions: [...new Set(picked.picks.map((entry) => entry.position))],
  };
}

/** The targets that the Dwell Engine is given now: the open ones, and in sequential mode only the one shown (Req 14.5). */
export function openTargets(state: RoundState | null): readonly RoundTarget[] {
  if (state === null || state.mode === 'none') return [];
  const open = state.targets.filter((target) => !state.completed.includes(target.id));
  return state.mode === 'sequential' ? open.slice(0, 1) : open;
}

/** Whether every target of the round is completed (Req 26.10). */
export function roundComplete(state: RoundState): boolean {
  return state.mode !== 'none' && state.targets.length > 0 && state.completed.length === state.targets.length;
}

/**
 * One step of the controller. A start begins the first round or the next one. A completed target leaves the
 * open targets, and when the round is complete the next round starts (Req 26.9, 26.10).
 */
export function stepRound(state: RoundState | null, event: RoundEvent, env: RoundEnvironment): RoundState | null {
  if (event.kind === 'start') return startRound(state, env);
  if (state === null || state.mode === 'none') return state;
  const open = openTargets(state).some((target) => target.id === event.targetId);
  if (!open) return state;
  const next: RoundState = { ...state, completed: [...state.completed, event.targetId] };
  return roundComplete(next) ? startRound(next, env) : next;
}
