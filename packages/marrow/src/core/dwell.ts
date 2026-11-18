// Dwell selection (Requirement 17, design sections 1 and 9.3). A pure reducer:
// stepDwell(state, { dt, pointers, hitAreas }) -> { state, events }, with dt the presence
// delta of this step (Req 17.1). dt is trusted as the Clocks give it: it is not clamped a
// second time and not checked. A dt above maxClockStepMs counts in full; a negative or NaN
// dt is outside the contract (Req 16.2 makes the Clocks return 0..maxClockStepMs), and the
// reducer does nothing special with it.
//
// Decisions the requirements leave open (each is recorded in docs/kiro-journal.md):
//  - Targets are independent (Req 17.4 is stated per target). One pointer can own two
//    overlapping targets in the same step, make progress on both, and select both in one
//    step: nothing in Req 17 limits a pointer to one target. Placement keeps the targets of
//    a round apart (Req 14.10), so this does not arise in play.
//  - A target is open to acquisition in a step only if, at the start of that step, it had
//    no owner, no latch, and its current activation had not produced a selection. So no
//    pointer acquires in the step in which ownership is released by the Outside rule, the
//    Invalid rule or a selection (Req 17.10), in the step in which the activation id
//    changes under an owner (Req 17.14), or in the step in which the last latched pointer
//    leaves. Acquisition is possible from the next step on. The step that acquires adds no
//    progress (Req 17.5).
//  - "Exceeds" is strict: the Outside timer must be greater than outsideWindowMs and the
//    Invalid timer greater than invalidWindowMs. "Reaches" is >=: progress of exactly
//    dwellMs selects. Inside is distance <= radius (Req 17.3).
//  - A wrist that is not in `pointers` at all is treated as an invalid pointer. As owner it
//    is Invalid. In a latch it does not leave, because only a step in which the pointer is
//    valid and outside the hit area leaves (Req 17.12). If the same wrist appears twice
//    in `pointers`, its first entry counts.
//  - The latch of a target that is not supplied stays as it was (Req 17.14). No pointer can
//    leave it in a step in which the target has no hit area, since leaving needs this
//    step's hit area. The latch also survives a change of activation id.
//  - The classification of every step uses this step's hit area. A hit area whose radius or
//    centre changes while its activation id stays the same keeps the hold: only the
//    classification moves.
//  - An activation is used once for good: the target remembers every activation id that
//    produced a selection, so an id that comes back later (A, B, A) does not select again
//    (Req 17.13, 17.20). A target keeps a record only while it has an owner, a latch or a
//    used activation, so ids of targets that were never held cost nothing.
//  - If a step supplies two hit areas with the same target id, the first counts.
//  - Events come in the order of the hit areas.
import type { Vec2, WristId } from './frame';
import { dist } from './geometry';
import { TUNING, type Tuning } from './tuning';

/** One target's hit area for this step (glossary): a circle in screen space. */
export interface HitArea {
  readonly targetId: string;
  /** The activation (glossary): a new id is a new period in which the target can be selected. */
  readonly activationId: string;
  readonly centre: Vec2;
  readonly radius: number;
}

/**
 * One active wrist's pointer for this step (Req 17.1): its screen-space position while it is
 * valid, and no position while it is invalid, so no logic can read a stale one (Req 8.7).
 */
export type PointerInput =
  | { readonly wrist: WristId; readonly valid: true; readonly pos: Vec2 }
  | { readonly wrist: WristId; readonly valid: false };

/** The input of one step (Req 17.1): the presence delta, the pointers and the hit areas. */
export interface DwellInput {
  /** The presence delta in milliseconds, 0..maxClockStepMs, used as given. */
  readonly dt: number;
  readonly pointers: readonly PointerInput[];
  readonly hitAreas: readonly HitArea[];
}

/** The tuning values the reducer reads, taken when the state is created. */
export interface DwellConfig {
  readonly dwellMs: number;
  readonly outsideWindowMs: number;
  readonly invalidWindowMs: number;
}

/** What the reducer keeps for one target. */
export interface TargetDwell {
  readonly targetId: string;
  /** The activation id of the last step that supplied the target. */
  readonly activationId: string;
  /** The pointer that holds the target, or null. */
  readonly owner: WristId | null;
  /** The dwell time of the current hold, in milliseconds; 0 without an owner. */
  readonly progressMs: number;
  /** Continuous presence time with the owner Outside; 0 otherwise (Req 17.7). */
  readonly outsideMs: number;
  /** Continuous presence time with the owner Invalid; 0 otherwise (Req 17.8). */
  readonly invalidMs: number;
  /** Every activation id of this target that produced a selection (Req 17.13). */
  readonly usedActivations: readonly string[];
  /** The pointers latched by the last selection that have not yet left (Req 17.11, 17.12). */
  readonly latch: readonly WristId[];
}

export interface DwellState {
  readonly cfg: DwellConfig;
  /** Only the targets with an owner, a latch or a used activation. Read it through dwellView. */
  readonly targets: readonly TargetDwell[];
}

/** One selection (Req 17.11): the target, the activation and the pointer that held it. */
export interface DwellEvent {
  readonly kind: 'selected';
  readonly targetId: string;
  readonly activationId: string;
  readonly wrist: WristId;
}

export interface DwellStep {
  readonly state: DwellState;
  readonly events: readonly DwellEvent[];
}

/** What the renderer reads for one target (Req 17.15). */
export interface DwellView {
  readonly owner: WristId | null;
  /** The dwell time of the current hold in milliseconds. */
  readonly progressMs: number;
  /** progressMs as a fraction of dwellMs. */
  readonly progress: number;
}

/** The right wrist first, so that it wins an exact tie for the nearest pointer (Req 17.4). */
const TIE_ORDER: readonly WristId[] = ['right', 'left'];
/** The order of a latch set, so equal sets are equal arrays. */
const LATCH_ORDER: readonly WristId[] = ['left', 'right'];

/** A state with no targets, reading its thresholds from `tuning` (the shipped values by default). */
export function createDwell(tuning: Tuning = TUNING): DwellState {
  return {
    cfg: {
      dwellMs: tuning.dwellMs,
      outsideWindowMs: tuning.outsideWindowMs,
      invalidWindowMs: tuning.invalidWindowMs,
    },
    targets: [],
  };
}

type Standing = 'inside' | 'outside' | 'invalid';

/** The first pointer of a wrist, or undefined. */
function pointerOf(pointers: readonly PointerInput[], wrist: WristId): PointerInput | undefined {
  return pointers.find((p) => p.wrist === wrist);
}

/** Req 17.3: Inside, Outside or Invalid. A missing pointer is invalid. */
function standing(pointer: PointerInput | undefined, area: HitArea): Standing {
  if (pointer === undefined || !pointer.valid) return 'invalid';
  return dist(pointer.pos, area.centre) <= area.radius ? 'inside' : 'outside';
}

/** Req 17.4: the valid pointer inside the hit area that is nearest its centre; on an exact tie the right wrist. */
function nearestInside(pointers: readonly PointerInput[], area: HitArea): WristId | null {
  let best: WristId | null = null;
  let bestDistance = Infinity;
  for (const wrist of TIE_ORDER) {
    const pointer = pointerOf(pointers, wrist);
    if (pointer === undefined || !pointer.valid) continue;
    const d = dist(pointer.pos, area.centre);
    if (d <= area.radius && d < bestDistance) {
      best = wrist;
      bestDistance = d;
    }
  }
  return best;
}

/** The record for a target, or null when it has nothing worth keeping. */
function recordOf(record: TargetDwell): TargetDwell | null {
  const idle = record.owner === null && record.latch.length === 0 && record.usedActivations.length === 0;
  return idle ? null : record;
}

/** One supplied target for one step: its next record and its selection, if any. */
function stepTarget(
  cfg: DwellConfig,
  prev: TargetDwell | undefined,
  area: HitArea,
  pointers: readonly PointerInput[],
  dt: number,
): { record: TargetDwell | null; event: DwellEvent | null } {
  const used = prev?.usedActivations ?? [];
  const latchAtStart = prev?.latch ?? [];
  // Open to acquisition: judged on the state at the start of the step (see the header).
  const open = (prev?.owner ?? null) === null && latchAtStart.length === 0 && !used.includes(area.activationId);

  let owner: WristId | null = null;
  let progressMs = 0;
  let outsideMs = 0;
  let invalidMs = 0;
  let usedNow = used;
  let latch = latchAtStart;
  let event: DwellEvent | null = null;

  // The hold goes on only under the same activation id (Req 17.14).
  if (prev !== undefined && prev.owner !== null && prev.activationId === area.activationId) {
    owner = prev.owner;
    progressMs = prev.progressMs;
    outsideMs = prev.outsideMs;
    invalidMs = prev.invalidMs;
    const where = standing(pointerOf(pointers, owner), area);
    if (where === 'inside') {
      // Req 17.6: add dt, and both timers go to 0.
      progressMs += dt;
      outsideMs = 0;
      invalidMs = 0;
      if (progressMs >= cfg.dwellMs) {
        // Req 17.11: one selection, release, the activation used, a latch on the pointers inside.
        event = { kind: 'selected', targetId: area.targetId, activationId: area.activationId, wrist: owner };
        usedNow = [...used, area.activationId];
        latch = LATCH_ORDER.filter((wrist) => standing(pointerOf(pointers, wrist), area) === 'inside');
        owner = null;
      }
    } else if (where === 'outside') {
      // Req 17.7: progress frozen, the Invalid timer 0, release once the Outside timer exceeds its window.
      outsideMs += dt;
      invalidMs = 0;
      if (outsideMs > cfg.outsideWindowMs) owner = null;
    } else {
      // Req 17.8: progress frozen, the Outside timer 0, cancel once the Invalid timer exceeds its window.
      invalidMs += dt;
      outsideMs = 0;
      if (invalidMs > cfg.invalidWindowMs) owner = null;
    }
    if (owner === null) {
      progressMs = 0;
      outsideMs = 0;
      invalidMs = 0;
    }
  }

  // Req 17.12: a pointer leaves the latch only in a step in which it is valid and outside.
  if (event === null && latchAtStart.length > 0) {
    latch = latchAtStart.filter((wrist) => standing(pointerOf(pointers, wrist), area) !== 'outside');
  }

  // Req 17.4, 17.5: acquisition with progress 0, only for a target that was open at the start of the step.
  if (open) owner = nearestInside(pointers, area);

  const record = recordOf({
    targetId: area.targetId,
    activationId: area.activationId,
    owner,
    progressMs,
    outsideMs,
    invalidMs,
    usedActivations: usedNow,
    latch,
  });
  return { record, event };
}

/**
 * One step of dwell selection (Req 17). Only the targets in `input.hitAreas` count (Req 17.2).
 * A target that is not supplied loses its hold and keeps its latch and used activations
 * (Req 17.14). The arguments are only read.
 */
export function stepDwell(state: DwellState, input: DwellInput): DwellStep {
  const { cfg } = state;
  const targets: TargetDwell[] = [];
  const events: DwellEvent[] = [];
  const supplied = new Set<string>();
  for (const area of input.hitAreas) {
    if (supplied.has(area.targetId)) continue;
    supplied.add(area.targetId);
    const prev = state.targets.find((t) => t.targetId === area.targetId);
    const { record, event } = stepTarget(cfg, prev, area, input.pointers, input.dt);
    if (record !== null) targets.push(record);
    if (event !== null) events.push(event);
  }
  for (const prev of state.targets) {
    if (supplied.has(prev.targetId)) continue;
    const record = recordOf({ ...prev, owner: null, progressMs: 0, outsideMs: 0, invalidMs: 0 });
    if (record !== null) targets.push(record);
  }
  return { state: { cfg, targets }, events };
}

/** The owner and progress of one target (Req 17.15). A target the state knows nothing about has no owner and no progress. */
export function dwellView(state: DwellState, targetId: string): DwellView {
  const target = state.targets.find((t) => t.targetId === targetId);
  if (target === undefined) return { owner: null, progressMs: 0, progress: 0 };
  return { owner: target.owner, progressMs: target.progressMs, progress: target.progressMs / state.cfg.dwellMs };
}
