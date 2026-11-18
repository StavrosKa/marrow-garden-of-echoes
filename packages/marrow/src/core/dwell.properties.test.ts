import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createDwell,
  dwellView,
  stepDwell,
  type DwellEvent,
  type DwellState,
  type HitArea,
  type PointerInput,
  type TargetDwell,
} from './dwell';
import type { WristId } from './frame';
import { dist } from './geometry';
import { genDwellRun, genReselectRun, genStintRun, genTwoPointerInterleaving, type DwellStepCase } from './testgen';
import { TUNING } from './tuning';

// The properties of Req 17.16 - 17.22 (steering section 10, invariant 1). Each has an oracle that
// is written here, from the inputs and from what dwellView and the events show, and not taken from
// dwell.ts. The one thing they share with it is the distance, `dist`: Inside is distance <= radius
// (Req 17.3), and a second formula could differ in the last bit exactly on a circle. Problems are
// collected and checked once per run, because an expect call for every target of every step is too slow.

const RUNS = 300;
/** How many problems of a failing run are shown. A test parameter. */
const SHOWN = 5;

type Standing = 'inside' | 'outside' | 'invalid';

/** Req 17.3, from the input alone: a missing or invalid pointer is Invalid. */
function standing(pointers: readonly PointerInput[], wrist: WristId, area: HitArea): Standing {
  const pointer = pointers.find((p) => p.wrist === wrist);
  if (pointer === undefined || !pointer.valid) return 'invalid';
  return dist(pointer.pos, area.centre) <= area.radius ? 'inside' : 'outside';
}

/** One step of a run: the states around it, its events and its input. */
interface Traced {
  readonly index: number;
  readonly before: DwellState;
  readonly after: DwellState;
  readonly events: readonly DwellEvent[];
  readonly step: DwellStepCase;
}

function trace(run: readonly DwellStepCase[]): Traced[] {
  let state = createDwell();
  return run.map((step, index) => {
    const before = state;
    const result = stepDwell(before, { dt: step.dt, pointers: step.pointers, hitAreas: step.hitAreas });
    state = result.state;
    return { index, before, after: result.state, events: result.events, step };
  });
}

const recordOf = (state: DwellState, id: string): TargetDwell | undefined => state.targets.find((t) => t.targetId === id);
const areaOf = (step: DwellStepCase, id: string): HitArea | undefined => step.hitAreas.find((a) => a.targetId === id);
/** The target ids a step involves: those with a record before it and those it supplies. */
const idsOf = (before: DwellState, step: DwellStepCase): string[] => [
  ...new Set([...before.targets.map((t) => t.targetId), ...step.hitAreas.map((a) => a.targetId)]),
];

describe('dwell properties: time and ownership (Req 17.16 - 17.19)', () => {
  // dwell_progress_only_owner_inside (Req 17.16): in every step, the progress of every target rises by
  // exactly dt when the same pointer owned it at the start and at the end of the step and that pointer
  // was Inside, and does not rise otherwise. "The same pointer owned it" means the same hold: the target
  // is supplied under the activation id it had, so a changed id or a missing target starts afresh. An
  // owner that stays Outside or Invalid keeps its progress exactly (Req 17.7, 17.8).
  it('dwell_progress_only_owner_inside', () => {
    fc.assert(
      fc.property(genDwellRun(), (run) => {
        const problems: string[] = [];
        for (const { index, before, after, step } of trace(run)) {
          for (const id of idsOf(before, step)) {
            const prev = recordOf(before, id);
            const area = areaOf(step, id);
            const progressBefore = prev?.progressMs ?? 0;
            const ownerBefore = prev?.owner ?? null;
            const next = dwellView(after, id);
            const same =
              ownerBefore !== null && area !== undefined && prev?.activationId === area.activationId && next.owner === ownerBefore;
            const where = same && area !== undefined && ownerBefore !== null ? standing(step.pointers, ownerBefore, area) : null;
            if (where === 'inside') {
              if (next.progressMs !== progressBefore + step.dt) {
                problems.push(`step ${index} ${id}: ${progressBefore} + ${step.dt} expected, got ${next.progressMs}`);
              }
            } else if (same) {
              if (next.progressMs !== progressBefore) problems.push(`step ${index} ${id}: ${where} owner changed progress`);
            } else if (next.progressMs > progressBefore) {
              problems.push(`step ${index} ${id}: progress rose from ${progressBefore} to ${next.progressMs} without a held Inside step`);
            }
            // Time is never counted for two pointers: a target has at most one owner, and none without progress 0.
            if (next.owner === null && next.progressMs !== 0) problems.push(`step ${index} ${id}: progress without an owner`);
          }
        }
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  // dwell_select_sums_inside_time (Req 17.17): the progress reached in a selecting step equals the sum of
  // dt over the owner's Inside steps after it acquired the target, and that sum is at least dwellMs. The
  // oracle keeps its own sum for each hold it has seen begin, adds dt in the owner's Inside steps with the
  // same operation the reducer uses, and requires that the selection comes in the first step in which the
  // sum reaches dwellMs, never before and never later, and that the progress shown always equals the sum.
  it('dwell_select_sums_inside_time', () => {
    fc.assert(
      fc.property(genDwellRun(), (run) => {
        const problems: string[] = [];
        const holds = new Map<string, { wrist: WristId; sum: number }>();
        for (const { index, before, after, events, step } of trace(run)) {
          for (const id of idsOf(before, step)) {
            const prev = recordOf(before, id);
            const area = areaOf(step, id);
            const event = events.find((e) => e.targetId === id);
            const nextOwner = dwellView(after, id).owner;
            const hold = holds.get(id);
            if (hold === undefined) {
              if (event !== undefined) problems.push(`step ${index} ${id}: a selection with no hold`);
              if ((prev?.owner ?? null) !== null) problems.push(`step ${index} ${id}: an owner the oracle never saw acquire`);
              if (nextOwner !== null) {
                holds.set(id, { wrist: nextOwner, sum: 0 });
                if (dwellView(after, id).progressMs !== 0) problems.push(`step ${index} ${id}: progress at acquisition`);
              }
              continue;
            }
            if (prev?.owner !== hold.wrist) problems.push(`step ${index} ${id}: the owner is not the one that acquired`);
            const continues = area !== undefined && prev !== undefined && prev.activationId === area.activationId;
            if (!continues || area === undefined) {
              holds.delete(id);
              if (event !== undefined) problems.push(`step ${index} ${id}: a selection from a dropped hold`);
              continue;
            }
            const inside = standing(step.pointers, hold.wrist, area) === 'inside';
            const sum = inside ? hold.sum + step.dt : hold.sum;
            if (event !== undefined) {
              if (event.wrist !== hold.wrist) problems.push(`step ${index} ${id}: selected by ${event.wrist}, held by ${hold.wrist}`);
              if (!(sum >= TUNING.dwellMs)) problems.push(`step ${index} ${id}: selected with a sum of ${sum}`);
              if (!(hold.sum < TUNING.dwellMs)) problems.push(`step ${index} ${id}: selected a step after the sum reached dwellMs`);
              if ((prev?.progressMs ?? 0) + step.dt !== sum) problems.push(`step ${index} ${id}: the progress reached is not the sum ${sum}`);
              holds.delete(id);
            } else if (nextOwner === null) {
              holds.delete(id);
            } else {
              hold.sum = sum;
              if (!(sum < TUNING.dwellMs)) problems.push(`step ${index} ${id}: the sum ${sum} reached dwellMs without a selection`);
              if (dwellView(after, id).progressMs !== sum) problems.push(`step ${index} ${id}: progress ${dwellView(after, id).progressMs}, sum ${sum}`);
            }
          }
        }
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  // dwell_select_requires_valid_inside (Req 17.18): every selection event comes in a step in which the
  // pointer that selects is valid and inside the hit area of that target in that step. The invalid
  // pointers of the runs carry positions inside the circles, so a reducer that read them would select.
  it('dwell_select_requires_valid_inside', () => {
    fc.assert(
      fc.property(genDwellRun(), (run) => {
        const problems: string[] = [];
        for (const { index, events, step } of trace(run)) {
          for (const event of events) {
            const area = areaOf(step, event.targetId);
            const pointer = step.pointers.find((p) => p.wrist === event.wrist);
            if (area === undefined) problems.push(`step ${index} ${event.targetId}: selected but not supplied`);
            else if (event.activationId !== area.activationId) problems.push(`step ${index} ${event.targetId}: another activation id`);
            else if (pointer === undefined || !pointer.valid) problems.push(`step ${index} ${event.targetId}: selected by an invalid pointer`);
            else if (!(dist(pointer.pos, area.centre) <= area.radius)) problems.push(`step ${index} ${event.targetId}: selected from outside`);
          }
        }
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  // dwell_owner_isolated_from_other_pointer (Req 17.19): with two pointers, while a target has an owner,
  // replacing the other pointer's path with any other path leaves that target's state unchanged until the
  // owner releases it. In genTwoPointerInterleaving the owner is inside first and the other pointer is not
  // inside until it has arrived, in both runs. Each step is compared from the arrival to the step in which the
  // owner releases it, in both runs at once: the hold (owner, progress, both timers) and the events are equal
  // in every step, and the whole record, latch and used activations too, in every step in which it is still held.
  it('dwell_owner_isolated_from_other_pointer', () => {
    fc.assert(
      fc.property(genTwoPointerInterleaving(), ({ owner, acquireAt, steps, replaced }) => {
        const problems: string[] = [];
        const a = trace(steps);
        const b = trace(replaced);
        for (let i = acquireAt; i < a.length; i++) {
          const left = a[i];
          const right = b[i];
          if (left === undefined || right === undefined) break;
          const recordA = recordOf(left.after, 't0');
          const recordB = recordOf(right.after, 't0');
          const hold = (r: TargetDwell | undefined) => [r?.owner ?? null, r?.progressMs ?? 0, r?.outsideMs ?? 0, r?.invalidMs ?? 0];
          if (JSON.stringify(hold(recordA)) !== JSON.stringify(hold(recordB))) problems.push(`step ${i}: the hold differs`);
          if (JSON.stringify(left.events) !== JSON.stringify(right.events)) problems.push(`step ${i}: the events differ`);
          if (i === acquireAt && recordA?.owner !== owner) problems.push(`step ${i}: the owner did not acquire`);
          if (recordA?.owner !== owner) break;
          if (JSON.stringify(recordA) !== JSON.stringify(recordB)) problems.push(`step ${i}: the record differs while held`);
        }
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('dwell properties: re-entry and the release timers (Req 17.20 - 17.22)', () => {
  // dwell_reentry_between_selections (Req 17.20): between two selections of the same target the activation
  // id differs, and every pointer latched by the first selection has had a step in which it was valid and
  // outside the hit area. The oracle takes the latched pointers from the input of the selecting step (the
  // wrists valid and inside) and marks one as having left in a later step in which the target is supplied
  // and that pointer is valid and outside this step's hit area. It also requires that no activation id of a
  // target is selected twice, which is Req 17.13 and holds for an id that comes back after another one. The
  // runs are the general ones of genDwellRun and the runs of genReselectRun, which select one target again
  // and again, with ids that repeat and return, and leave it by going outside, going invalid or not at all.
  it('dwell_reentry_between_selections', () => {
    fc.assert(
      fc.property(fc.oneof(genDwellRun(), genReselectRun()), (run) => {
        const problems: string[] = [];
        const last = new Map<string, { activationId: string; latched: WristId[]; left: Set<WristId> }>();
        const used = new Map<string, Set<string>>();
        for (const { index, events, step } of trace(run)) {
          for (const [id, entry] of last) {
            const area = areaOf(step, id);
            if (area === undefined) continue;
            for (const wrist of entry.latched) if (standing(step.pointers, wrist, area) === 'outside') entry.left.add(wrist);
          }
          for (const event of events) {
            const area = areaOf(step, event.targetId);
            if (area === undefined) {
              problems.push(`step ${index} ${event.targetId}: selected but not supplied`);
              continue;
            }
            const previous = last.get(event.targetId);
            if (previous !== undefined) {
              if (previous.activationId === event.activationId) {
                problems.push(`step ${index} ${event.targetId}: two selections under ${event.activationId}`);
              }
              for (const wrist of previous.latched) {
                if (!previous.left.has(wrist)) problems.push(`step ${index} ${event.targetId}: the ${wrist} wrist never left after the last selection`);
              }
            }
            const ids = used.get(event.targetId) ?? new Set<string>();
            if (ids.has(event.activationId)) problems.push(`step ${index} ${event.targetId}: ${event.activationId} selected again`);
            ids.add(event.activationId);
            used.set(event.targetId, ids);
            last.set(event.targetId, {
              activationId: event.activationId,
              latched: (['left', 'right'] as const).filter((wrist) => standing(step.pointers, wrist, area) === 'inside'),
              left: new Set(),
            });
          }
        }
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  // dwell_release_timers_exact (Req 17.21): the Outside rule releases ownership exactly in the first step in
  // which continuous Outside time exceeds outsideWindowMs, and the Invalid rule exactly in the first step in
  // which continuous Invalid time exceeds invalidWindowMs, never earlier. genStintRun puts stints at, just
  // under and just over each window, cut into steps in three sizes. The oracle sums dt over the owner's
  // consecutive Outside steps and over its consecutive Invalid steps, each reset by any step of another
  // kind, and demands a release in exactly the steps where a sum is over its window.
  it('dwell_release_timers_exact', () => {
    fc.assert(
      fc.property(genStintRun(false), ({ steps }) => {
        const problems: string[] = [];
        let outsideMs = 0;
        let invalidMs = 0;
        for (const { index, before, after, events, step } of trace(steps)) {
          const area = step.hitAreas[0] as HitArea;
          const owner = dwellView(after, 't0').owner;
          if (dwellView(before, 't0').owner === null) {
            // No hold at the start of the step: nothing to time; an acquisition starts both timers at 0.
            outsideMs = 0;
            invalidMs = 0;
            continue;
          }
          const where = standing(step.pointers, 'right', area);
          if (where === 'inside') {
            outsideMs = 0;
            invalidMs = 0;
            if (events.length === 0 && owner === null) problems.push(`step ${index}: released in an Inside step without a selection`);
            continue;
          }
          if (where === 'outside') {
            outsideMs += step.dt;
            invalidMs = 0;
          } else {
            invalidMs += step.dt;
            outsideMs = 0;
          }
          const over = outsideMs > TUNING.outsideWindowMs || invalidMs > TUNING.invalidWindowMs;
          if (events.length > 0) problems.push(`step ${index}: a selection in a ${where} step`);
          if (over && owner !== null) problems.push(`step ${index}: not released with ${where} time ${where === 'outside' ? outsideMs : invalidMs}`);
          if (!over && owner === null) problems.push(`step ${index}: released early, ${where} time ${where === 'outside' ? outsideMs : invalidMs}`);
          if (over) {
            outsideMs = 0;
            invalidMs = 0;
          }
        }
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  // dwell_bounded_stints_never_release (Req 17.22): when every continuous Outside stint is at most
  // outsideWindowMs and every continuous Invalid stint at most invalidWindowMs, those rules never release
  // ownership, whatever the total time of the stints. The premise is measured here, from the steps, and not
  // taken from the generator. The hold ends only in a selection, which the Inside stints can still reach.
  it('dwell_bounded_stints_never_release', () => {
    fc.assert(
      fc.property(genStintRun(true), ({ steps }) => {
        let outsideMs = 0;
        let invalidMs = 0;
        let longestOutside = 0;
        let longestInvalid = 0;
        for (const step of steps) {
          const where = standing(step.pointers, 'right', step.hitAreas[0] as HitArea);
          outsideMs = where === 'outside' ? outsideMs + step.dt : 0;
          invalidMs = where === 'invalid' ? invalidMs + step.dt : 0;
          longestOutside = Math.max(longestOutside, outsideMs);
          longestInvalid = Math.max(longestInvalid, invalidMs);
        }
        expect(longestOutside, 'the longest Outside stint').toBeLessThanOrEqual(TUNING.outsideWindowMs);
        expect(longestInvalid, 'the longest Invalid stint').toBeLessThanOrEqual(TUNING.invalidWindowMs);

        const problems: string[] = [];
        let held = false;
        for (const { index, after, events } of trace(steps)) {
          const owner = dwellView(after, 't0').owner;
          if (index === 0 && owner === null) problems.push('step 0: the first step did not acquire the target');
          if (held && owner === null && events.length === 0) problems.push(`step ${index}: the hold was released without a selection`);
          held = owner !== null;
        }
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });
});
