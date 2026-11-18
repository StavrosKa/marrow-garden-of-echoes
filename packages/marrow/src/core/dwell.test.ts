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
import type { Vec2, WristId } from './frame';
import * as core from './index';
import { TUNING } from './tuning';

// Every threshold comes from TUNING. The scripts step the presence clock by STEP, the largest delta
// the Clocks return, and split a duration into steps of at most STEP whose sum is exact (whole
// milliseconds). "One step before" and "the step at" a boundary are two steps of such a script. The
// rest are named test parameters.

/** The presence delta of a full step: the largest the Clocks return. */
const STEP = TUNING.maxClockStepMs;
const DWELL = TUNING.dwellMs;
const OUTSIDE_WINDOW = TUNING.outsideWindowMs;
const INVALID_WINDOW = TUNING.invalidWindowMs;
const RADIUS = TUNING.hitRadius;
/** "Just over" a window: one more millisecond. A test parameter. */
const ONE_MS = 1;
/** How many hit radii away "clearly outside" is. A test parameter. */
const FAR = 3;
/** Half a step. A test parameter. */
const HALF = 1 / 2;

const CENTRE: Vec2 = { x: HALF, y: HALF };
/** A position at the centre of the hit area, and one clearly outside it. */
const IN: Vec2 = CENTRE;
const OUT: Vec2 = { x: CENTRE.x + FAR * RADIUS, y: CENTRE.y };
/** A dyadic offset (2^-4) that is inside the radius, so equal distances are exactly equal. */
const TIE_OFFSET = 2 ** -4;

const AREA: HitArea = { targetId: 'a', activationId: 'a1', centre: CENTRE, radius: RADIUS };
const area = (over: Partial<HitArea> = {}): HitArea => ({ ...AREA, ...over });

const at = (wrist: WristId, pos: Vec2): PointerInput => ({ wrist, valid: true, pos });
const gone = (wrist: WristId): PointerInput => ({ wrist, valid: false });
/** The right wrist at a position, or invalid when null. */
const right = (pos: Vec2 | null): PointerInput => (pos === null ? gone('right') : at('right', pos));
const left = (pos: Vec2 | null): PointerInput => (pos === null ? gone('left') : at('left', pos));

/** One scripted step. The default hit area is AREA and the default delta is STEP. */
interface Move {
  readonly dt?: number;
  readonly pointers: readonly PointerInput[];
  readonly areas?: readonly HitArea[];
}

const move = (pointers: readonly PointerInput[], dt: number = STEP, areas?: readonly HitArea[]): Move =>
  areas === undefined ? { dt, pointers } : { dt, pointers, areas };

/** Whole milliseconds in steps of at most STEP, summing exactly to `total`. */
function splitMs(total: number): number[] {
  const parts: number[] = [];
  for (let left = total; left > 0; left -= STEP) parts.push(Math.min(STEP, left));
  return parts;
}

/** `moves` repeated for each delta of `splitMs(total)`: a stint of exactly `total` milliseconds. */
const stint = (pointers: readonly PointerInput[], total: number, areas?: readonly HitArea[]): Move[] =>
  splitMs(total).map((dt) => move(pointers, dt, areas));
const times = (count: number, one: Move): Move[] => Array.from({ length: count }, () => one);

interface Played {
  readonly states: DwellState[];
  readonly events: DwellEvent[][];
}

function play(start: DwellState, moves: readonly Move[]): Played {
  const states: DwellState[] = [];
  const events: DwellEvent[][] = [];
  let state = start;
  for (const m of moves) {
    const step = stepDwell(state, { dt: m.dt ?? STEP, pointers: m.pointers, hitAreas: m.areas ?? [AREA] });
    state = step.state;
    states.push(state);
    events.push([...step.events]);
  }
  return { states, events };
}

/** The state after the last move. */
function last(played: Played): DwellState {
  const state = played.states[played.states.length - 1];
  if (state === undefined) throw new Error('empty script');
  return state;
}

/** The raw record of a target, or undefined. */
const record = (state: DwellState, id = 'a'): TargetDwell | undefined => state.targets.find((t) => t.targetId === id);

/** The steps of an acquiring script: the first step has the right wrist inside and adds no progress. */
const ACQUIRE: Move = move([right(IN)]);
/** The number of full inside steps that reach dwellMs. */
const SELECT_STEPS = DWELL / STEP;

/** The right wrist acquires and then selects: acquisition, then SELECT_STEPS full Inside steps. */
const SELECTING: Move[] = [ACQUIRE, ...times(SELECT_STEPS, move([right(IN)]))];

describe('the thresholds the scripts rely on', () => {
  it('dwellMs is a whole number of steps, and each window lies between one and two steps', () => {
    expect(Number.isInteger(DWELL / STEP)).toBe(true);
    expect(OUTSIDE_WINDOW).toBeGreaterThan(STEP);
    expect(OUTSIDE_WINDOW).toBeLessThan(2 * STEP);
    expect(INVALID_WINDOW).toBeGreaterThan(2 * STEP);
    expect(Number.isInteger(INVALID_WINDOW / STEP)).toBe(true);
  });
});

describe('createDwell', () => {
  it('starts with no target and reads its thresholds from the tuning argument, the shipped ones by default (Req 1.6)', () => {
    expect(createDwell().targets).toEqual([]);
    expect(createDwell().cfg).toEqual({
      dwellMs: TUNING.dwellMs,
      outsideWindowMs: TUNING.outsideWindowMs,
      invalidWindowMs: TUNING.invalidWindowMs,
    });
    const quick = { ...TUNING, dwellMs: 3 * STEP, outsideWindowMs: STEP / 2, invalidWindowMs: STEP };
    const played = play(createDwell(quick), [
      ACQUIRE,
      ...times(2, move([right(IN)])),
      move([right(OUT)], STEP / 2 + ONE_MS),
    ]);
    // The Outside window is half a step here: one step of a little more than that releases.
    expect(dwellView(last(played), 'a').owner).toBeNull();
    const selected = play(createDwell(quick), [ACQUIRE, ...times(3, move([right(IN)]))]);
    expect(selected.events.map((e) => e.length)).toEqual([0, 0, 0, 1]);
    // The Invalid window is one step here: a stint of exactly one step keeps the hold, one more millisecond cancels it.
    const kept = play(createDwell(quick), [ACQUIRE, move([right(null)])]);
    expect(dwellView(last(kept), 'a').owner).toBe('right');
    const cancelled = play(createDwell(quick), [ACQUIRE, move([right(null)]), move([right(null)], ONE_MS)]);
    expect(dwellView(last(cancelled), 'a').owner).toBeNull();
  });
});

describe('stepDwell, targets and classification (Req 17.2, 17.3)', () => {
  it('counts only the targets supplied in this step (Req 17.2)', () => {
    const none = play(createDwell(), [move([right(IN)], STEP, [])]);
    expect(last(none).targets).toEqual([]);
    expect(dwellView(last(none), 'a')).toEqual({ owner: null, progressMs: 0, progress: 0 });
    // A target supplied for the first time is acquired in that step.
    const later = play(createDwell(), [move([right(IN)], STEP, []), ACQUIRE]);
    expect(dwellView(last(later), 'a').owner).toBe('right');
  });

  it('Inside is distance <= radius: a pointer exactly on the circle is Inside, one ULP beyond is Outside (Req 17.3)', () => {
    // The centre is the origin, so the position (radius, 0) is at distance sqrt(radius * radius) = radius exactly.
    const origin = area({ centre: { x: 0, y: 0 } });
    const onCircle: Vec2 = { x: RADIUS, y: 0 };
    const beyond: Vec2 = { x: RADIUS * (1 + Number.EPSILON), y: 0 };
    expect(Math.hypot(onCircle.x, onCircle.y)).toBe(RADIUS);
    expect(beyond.x).toBeGreaterThan(RADIUS);
    const edge = play(createDwell(), [move([right(onCircle)], STEP, [origin]), move([right(onCircle)], STEP, [origin])]);
    expect(dwellView(edge.states[0] as DwellState, 'a').owner).toBe('right');
    expect(dwellView(last(edge), 'a')).toMatchObject({ owner: 'right', progressMs: STEP });
    const out = play(createDwell(), [move([right(beyond)], STEP, [origin])]);
    expect(dwellView(last(out), 'a').owner).toBeNull();
  });

  it('classifies the owner as Inside, Outside or Invalid in every step, whatever an invalid pointer carries (Req 17.3)', () => {
    // Inside adds progress, Outside freezes it and counts the Outside timer, Invalid freezes it and counts the Invalid timer.
    const played = play(createDwell(), [ACQUIRE, move([right(IN)]), move([right(OUT)]), move([right(null)])]);
    expect(dwellView(played.states[1] as DwellState, 'a').progressMs).toBe(STEP);
    expect(record(played.states[2] as DwellState)).toMatchObject({ progressMs: STEP, outsideMs: STEP, invalidMs: 0 });
    expect(record(played.states[3] as DwellState)).toMatchObject({ progressMs: STEP, outsideMs: 0, invalidMs: STEP });
  });
});

describe('stepDwell, acquisition (Req 17.4, 17.5)', () => {
  it('a free pointer inside makes its wrist the owner with progress 0, and the acquiring step adds no progress (Req 17.4, 17.5)', () => {
    const played = play(createDwell(), [ACQUIRE, move([right(IN)])]);
    expect(dwellView(played.states[0] as DwellState, 'a')).toEqual({ owner: 'right', progressMs: 0, progress: 0 });
    expect(dwellView(played.states[1] as DwellState, 'a')).toMatchObject({ owner: 'right', progressMs: STEP });
    const leftOwner = play(createDwell(), [move([left(IN)])]);
    expect(dwellView(last(leftOwner), 'a').owner).toBe('left');
  });

  it('a valid pointer outside, an invalid pointer at the centre and no pointer at all acquire nothing (Req 17.4)', () => {
    for (const pointers of [[right(OUT)], [right(null)], [{ wrist: 'right', valid: false } as PointerInput], []]) {
      const played = play(createDwell(), [move(pointers)]);
      expect(last(played).targets).toEqual([]);
    }
    // An invalid pointer that carries a position inside the circle is still invalid.
    const stale = { wrist: 'right', valid: false, pos: IN } as PointerInput;
    expect(last(play(createDwell(), [move([stale])])).targets).toEqual([]);
  });

  it('with two pointers inside, the one nearest the centre owns the target (Req 17.4)', () => {
    const nearLeft = play(createDwell(), [move([left({ x: CENTRE.x + TIE_OFFSET / 2, y: CENTRE.y }), right({ x: CENTRE.x - TIE_OFFSET, y: CENTRE.y })])]);
    expect(dwellView(last(nearLeft), 'a').owner).toBe('left');
    const nearRight = play(createDwell(), [move([left({ x: CENTRE.x + TIE_OFFSET, y: CENTRE.y }), right({ x: CENTRE.x, y: CENTRE.y - TIE_OFFSET / 2 })])]);
    expect(dwellView(last(nearRight), 'a').owner).toBe('right');
    // The array order does not matter.
    const reversed = play(createDwell(), [move([right({ x: CENTRE.x - TIE_OFFSET, y: CENTRE.y }), left({ x: CENTRE.x + TIE_OFFSET / 2, y: CENTRE.y })])]);
    expect(dwellView(last(reversed), 'a').owner).toBe('left');
  });

  it('on an exact tie the right wrist owns the target, whichever order the pointers come in (Req 17.4)', () => {
    const l = left({ x: CENTRE.x - TIE_OFFSET, y: CENTRE.y });
    const r = right({ x: CENTRE.x + TIE_OFFSET, y: CENTRE.y });
    for (const pointers of [[l, r], [r, l]]) {
      expect(dwellView(last(play(createDwell(), [move(pointers)])), 'a').owner).toBe('right');
    }
    // A pointer inside that is not valid does not take part: only the valid one qualifies.
    expect(dwellView(last(play(createDwell(), [move([right(null), left({ x: CENTRE.x - TIE_OFFSET, y: CENTRE.y })])])), 'a').owner).toBe('left');
  });
});

describe('stepDwell, the holding rules (Req 17.6 - 17.9)', () => {
  it('Inside adds dt and sets both timers to 0 (Req 17.6)', () => {
    const played = play(createDwell(), [
      ACQUIRE,
      move([right(OUT)]),
      move([right(IN)], STEP / 2),
      move([right(null)]),
      move([right(IN)], STEP / 4),
    ]);
    expect(record(played.states[1] as DwellState)).toMatchObject({ outsideMs: STEP, invalidMs: 0, progressMs: 0 });
    expect(record(played.states[2] as DwellState)).toMatchObject({ outsideMs: 0, invalidMs: 0, progressMs: STEP / 2 });
    expect(record(played.states[3] as DwellState)).toMatchObject({ outsideMs: 0, invalidMs: STEP, progressMs: STEP / 2 });
    expect(record(played.states[4] as DwellState)).toMatchObject({ outsideMs: 0, invalidMs: 0, progressMs: STEP / 2 + STEP / 4 });
  });

  it('Outside freezes progress; a stint of exactly the window keeps the hold, one more millisecond releases it in that step (Req 17.7)', () => {
    const base = [ACQUIRE, ...times(2, move([right(IN)]))];
    const exact = play(createDwell(), [...base, ...stint([right(OUT)], OUTSIDE_WINDOW)]);
    for (const state of exact.states.slice(base.length)) expect(dwellView(state, 'a')).toMatchObject({ owner: 'right', progressMs: 2 * STEP });
    expect(record(last(exact))).toMatchObject({ outsideMs: OUTSIDE_WINDOW });
    // Inside again: the same hold goes on, and the Outside timer starts from 0 the next time.
    const back = play(last(exact), [move([right(IN)])]);
    expect(record(last(back))).toMatchObject({ owner: 'right', progressMs: 3 * STEP, outsideMs: 0 });
    // One step before the boundary the hold is intact; the step that takes the timer over releases it.
    const over = play(createDwell(), [...base, ...stint([right(OUT)], OUTSIDE_WINDOW), move([right(OUT)], ONE_MS)]);
    const before = over.states[over.states.length - 2] as DwellState;
    expect(dwellView(before, 'a').owner).toBe('right');
    expect(dwellView(last(over), 'a')).toEqual({ owner: null, progressMs: 0, progress: 0 });
    expect(over.events.flat()).toEqual([]);
    // With full steps: 100 keeps it, 200 releases, in the second step.
    const full = play(createDwell(), [ACQUIRE, move([right(OUT)]), move([right(OUT)])]);
    expect(dwellView(full.states[1] as DwellState, 'a').owner).toBe('right');
    expect(dwellView(full.states[2] as DwellState, 'a').owner).toBeNull();
  });

  it('Invalid freezes progress; a stint of exactly the window keeps the hold, one more millisecond cancels it in that step (Req 17.8)', () => {
    const base = [ACQUIRE, ...times(2, move([right(IN)]))];
    const exact = play(createDwell(), [...base, ...stint([right(null)], INVALID_WINDOW)]);
    for (const state of exact.states.slice(base.length)) expect(dwellView(state, 'a')).toMatchObject({ owner: 'right', progressMs: 2 * STEP });
    expect(record(last(exact))).toMatchObject({ invalidMs: INVALID_WINDOW });
    const back = play(last(exact), [move([right(IN)])]);
    expect(record(last(back))).toMatchObject({ owner: 'right', progressMs: 3 * STEP, invalidMs: 0 });
    const over = play(createDwell(), [...base, ...stint([right(null)], INVALID_WINDOW), move([right(null)], ONE_MS)]);
    expect(dwellView(over.states[over.states.length - 2] as DwellState, 'a').owner).toBe('right');
    expect(dwellView(last(over), 'a')).toEqual({ owner: null, progressMs: 0, progress: 0 });
    expect(over.events.flat()).toEqual([]);
    // The owner's wrist missing from the pointers counts as Invalid.
    const missing = play(createDwell(), [...base, ...stint([], INVALID_WINDOW), move([], ONE_MS)]);
    expect(dwellView(missing.states[missing.states.length - 2] as DwellState, 'a').owner).toBe('right');
    expect(dwellView(last(missing), 'a').owner).toBeNull();
  });

  it('the Outside and Invalid timers are separate: time in one never counts toward the other (Req 17.7, 17.8)', () => {
    // Each stint is at most its window, and they alternate, so neither timer ever exceeds its window.
    const round = [...stint([right(OUT)], OUTSIDE_WINDOW), ...stint([right(null)], INVALID_WINDOW)];
    const played = play(createDwell(), [ACQUIRE, ...times(2, move([right(IN)])), ...round, ...round, ...round]);
    expect(dwellView(last(played), 'a')).toMatchObject({ owner: 'right', progressMs: 2 * STEP });
    expect(played.events.flat()).toEqual([]);
  });

  it('a pointer that is not the owner changes nothing about a held target (Req 17.9)', () => {
    const owner = [ACQUIRE, ...times(8, move([right({ x: CENTRE.x + TIE_OFFSET, y: CENTRE.y })]))];
    const alone = play(createDwell(), owner);
    const nearer = right({ x: CENTRE.x + TIE_OFFSET, y: CENTRE.y });
    // The other wrist wanders: at the centre (nearer than the owner), outside, invalid, and absent.
    const wander = [left(OUT), left(IN), left(IN), left(null), left(OUT), left(IN), left(CENTRE), left(null), left(IN)];
    const crowded = play(
      createDwell(),
      owner.map((m, i) => move([nearer, wander[i] as PointerInput], m.dt)),
    );
    expect(crowded.states.map((s) => s.targets)).toEqual(alone.states.map((s) => s.targets));
    expect(crowded.events).toEqual(alone.events);
  });
});

describe('stepDwell, release and re-acquisition (Req 17.10)', () => {
  it('after an Outside release another pointer, or the same one, can acquire from the next step on, not in the release step (Req 17.10)', () => {
    const release = [ACQUIRE, ...times(2, move([right(IN)])), move([right(OUT), left(IN)]), move([right(OUT), left(IN)])];
    const base = play(createDwell(), release);
    expect(dwellView(base.states[3] as DwellState, 'a').owner).toBe('right');
    // The release step: the left wrist is inside, but nobody acquires in it.
    expect(dwellView(last(base), 'a')).toEqual({ owner: null, progressMs: 0, progress: 0 });
    const other = play(last(base), [move([right(OUT), left(IN)])]);
    expect(dwellView(last(other), 'a')).toEqual({ owner: 'left', progressMs: 0, progress: 0 });
    // The same pointer, back inside from the next step.
    const same = play(createDwell(), [...release.slice(0, 4), move([right(OUT)]), move([right(IN)])]);
    expect(dwellView(same.states[4] as DwellState, 'a').owner).toBeNull();
    expect(dwellView(last(same), 'a')).toEqual({ owner: 'right', progressMs: 0, progress: 0 });
  });

  it('after an Invalid cancel another pointer, or the same one, can acquire from the next step on, not in the cancel step (Req 17.10)', () => {
    const lost = [...stint([right(null), left(IN)], INVALID_WINDOW), move([right(null), left(IN)], ONE_MS)];
    const base = play(createDwell(), [ACQUIRE, ...lost]);
    expect(dwellView(base.states[base.states.length - 2] as DwellState, 'a').owner).toBe('right');
    expect(dwellView(last(base), 'a').owner).toBeNull();
    expect(dwellView(last(play(last(base), [move([right(null), left(IN)])])), 'a').owner).toBe('left');
    expect(dwellView(last(play(last(base), [move([right(IN)])])), 'a')).toEqual({ owner: 'right', progressMs: 0, progress: 0 });
  });
});

describe('stepDwell, selection (Req 17.11, 17.13)', () => {
  it('selects in the step in which progress reaches dwellMs, and not in the step before (Req 17.11)', () => {
    // Whole milliseconds: acquire, then DWELL - 1 ms, then 1 ms.
    const nearly = play(createDwell(), [ACQUIRE, ...splitMs(DWELL - ONE_MS).map((dt) => move([right(IN)], dt))]);
    expect(nearly.events.flat()).toEqual([]);
    expect(dwellView(last(nearly), 'a').progressMs).toBe(DWELL - ONE_MS);
    const exactly = play(last(nearly), [move([right(IN)], ONE_MS)]);
    expect(exactly.events).toEqual([[{ kind: 'selected', targetId: 'a', activationId: 'a1', wrist: 'right' }]]);
    expect(dwellView(last(exactly), 'a')).toEqual({ owner: null, progressMs: 0, progress: 0 });
    // Full steps: the step before reaching has no event, the step that reaches has exactly one.
    const full = play(createDwell(), SELECTING);
    expect(full.events.slice(0, -1).flat()).toEqual([]);
    expect(full.events[full.events.length - 1]).toHaveLength(1);
    expect(dwellView(full.states[full.states.length - 2] as DwellState, 'a').progressMs).toBe(DWELL - STEP);
    // Progress above dwellMs also selects (reaches means >=), once.
    const over = play(createDwell(), [ACQUIRE, ...times(SELECT_STEPS - 1, move([right(IN)])), move([right(IN)], STEP + STEP)]);
    expect(over.events.flat()).toHaveLength(1);
  });

  it('a selection sets progress to 0, releases the owner, marks the activation used and latches the pointers valid and inside (Req 17.11)', () => {
    const both = play(createDwell(), [
      move([right(IN), left({ x: CENTRE.x + TIE_OFFSET, y: CENTRE.y })]),
      ...times(SELECT_STEPS, move([right(IN), left({ x: CENTRE.x + TIE_OFFSET, y: CENTRE.y })])),
    ]);
    expect(record(last(both))).toEqual({
      targetId: 'a',
      activationId: 'a1',
      owner: null,
      progressMs: 0,
      outsideMs: 0,
      invalidMs: 0,
      usedActivations: ['a1'],
      latch: ['left', 'right'],
    });
    // Only pointers valid and inside are latched: an outside pointer and an invalid one at the centre are not.
    const some = play(createDwell(), [ACQUIRE, ...times(SELECT_STEPS, move([right(IN), left(OUT)]))]);
    expect(record(last(some))?.latch).toEqual(['right']);
    const invalidOther = play(createDwell(), [ACQUIRE, ...times(SELECT_STEPS, move([right(IN), left(null)]))]);
    expect(record(last(invalidOther))?.latch).toEqual(['right']);
  });

  it('never emits a second selection for an activation, even after the latch has ended and the pointer re-entered (Req 17.13)', () => {
    const again = [move([right(OUT)]), ...times(2 * SELECT_STEPS, move([right(IN)]))];
    const played = play(createDwell(), [...SELECTING, ...again]);
    expect(played.events.flat()).toHaveLength(1);
    expect(record(last(played))).toMatchObject({ owner: null, latch: [], usedActivations: ['a1'] });
    // A new activation id can be selected again, with its own event.
    const next = area({ activationId: 'a2' });
    const second = play(last(played), [...times(1 + SELECT_STEPS, move([right(IN)], STEP, [next]))]);
    expect(second.events.flat()).toEqual([{ kind: 'selected', targetId: 'a', activationId: 'a2', wrist: 'right' }]);
    // An activation that comes back after another one is still used.
    const back = play(last(second), [move([right(OUT)], STEP, [AREA]), ...times(2 * SELECT_STEPS, move([right(IN)], STEP, [AREA]))]);
    expect(back.events.flat()).toEqual([]);
    expect(record(last(back))?.usedActivations).toEqual(['a1', 'a2']);
  });
});

describe('stepDwell, the latch (Req 17.12)', () => {
  const NEXT = area({ activationId: 'a2' });

  it('blocks acquisition, also under a new activation id, until a latched pointer has a valid and outside step (Req 17.12)', () => {
    // Selected with the right wrist inside. It stays inside: the new activation cannot be acquired.
    const stay = play(createDwell(), [...SELECTING, ...times(3, move([right(IN)], STEP, [NEXT]))]);
    expect(record(last(stay))).toMatchObject({ owner: null, latch: ['right'] });
    // Going invalid is not leaving, however long it lasts, and the pointer coming back inside is still latched.
    const invalid = play(last(stay), [...times(3 * SELECT_STEPS, move([right(null)], STEP, [NEXT])), move([right(IN)], STEP, [NEXT])]);
    expect(record(last(invalid))).toMatchObject({ owner: null, latch: ['right'] });
    // A valid and outside step ends the latch in that step, and acquisition follows from the next step.
    const leave = play(last(invalid), [move([right(OUT)], STEP, [NEXT])]);
    expect(record(last(leave))).toBeDefined();
    expect(record(last(leave))?.latch).toEqual([]);
    const enter = play(last(leave), [move([right(IN)], STEP, [NEXT])]);
    expect(dwellView(last(enter), 'a').owner).toBe('right');
  });

  it('the latch ends only when its set is empty, and a pointer that was not latched cannot acquire meanwhile (Req 17.12)', () => {
    const together = [move([right(IN), left(IN)]), ...times(SELECT_STEPS, move([right(IN), left(IN)]))];
    const selected = play(createDwell(), together);
    expect(record(last(selected))?.latch).toEqual(['left', 'right']);
    const oneLeaves = play(last(selected), [move([right(OUT), left(IN)], STEP, [NEXT])]);
    expect(record(last(oneLeaves))?.latch).toEqual(['left']);
    // The right wrist comes back inside: the left wrist is still latched, so nobody acquires.
    const back = play(last(oneLeaves), [move([right(IN), left(IN)], STEP, [NEXT])]);
    expect(dwellView(last(back), 'a').owner).toBeNull();
    // The left wrist leaves: the set is empty. The right wrist, inside in that step, acquires only in the next one.
    const bothGone = play(last(back), [move([right(IN), left(OUT)], STEP, [NEXT])]);
    expect(record(last(bothGone))?.latch).toEqual([]);
    expect(dwellView(last(bothGone), 'a').owner).toBeNull();
    const free = play(last(bothGone), [move([right(IN), left(OUT)], STEP, [NEXT])]);
    expect(dwellView(last(free), 'a').owner).toBe('right');
  });

  it('a wrist that is not supplied does not leave the latch (Req 17.12)', () => {
    const played = play(last(play(createDwell(), SELECTING)), times(5, move([], STEP, [NEXT])));
    expect(record(last(played))?.latch).toEqual(['right']);
  });
});

describe('stepDwell, a changed activation id or a missing target (Req 17.14)', () => {
  const NEXT = area({ activationId: 'a2' });

  it('a changed activation id drops the hold without an event, and the pointer inside acquires from the next step (Req 17.14, 17.10)', () => {
    const hold = [ACQUIRE, ...times(6, move([right(IN)]))];
    const held = play(createDwell(), hold);
    expect(dwellView(last(held), 'a').progressMs).toBe(6 * STEP);
    const changed = play(last(held), [move([right(IN)], STEP, [NEXT])]);
    expect(changed.events.flat()).toEqual([]);
    expect(dwellView(last(changed), 'a')).toEqual({ owner: null, progressMs: 0, progress: 0 });
    const next = play(last(changed), [move([right(IN)], STEP, [NEXT])]);
    expect(dwellView(last(next), 'a')).toEqual({ owner: 'right', progressMs: 0, progress: 0 });
    // With nobody holding, a new activation id is acquired in the step it appears.
    const free = play(createDwell(), [move([right(OUT)]), move([right(IN)], STEP, [NEXT])]);
    expect(dwellView(last(free), 'a').owner).toBe('right');
  });

  it('a target that is not supplied loses its hold, and starts again from 0 when it is supplied (Req 17.2, 17.14)', () => {
    const held = play(createDwell(), [ACQUIRE, ...times(6, move([right(IN)]))]);
    const missing = play(last(held), [move([right(IN)], STEP, [])]);
    expect(last(missing).targets).toEqual([]);
    expect(missing.events.flat()).toEqual([]);
    const again = play(last(missing), [move([right(IN)])]);
    expect(dwellView(last(again), 'a')).toEqual({ owner: 'right', progressMs: 0, progress: 0 });
    // It needs the whole dwell time again.
    const whole = play(last(again), times(SELECT_STEPS - 1, move([right(IN)])));
    expect(whole.events.flat()).toEqual([]);
    expect(play(last(whole), [move([right(IN)])]).events.flat()).toHaveLength(1);
  });

  it('the latch, and the used activation, survive both a changed activation id and a missing target (Req 17.14)', () => {
    const selected = last(play(createDwell(), SELECTING));
    // Missing for several steps while the pointer is outside: it cannot leave a latch it has no hit area for.
    const missing = play(selected, times(4, move([right(OUT)], STEP, [])));
    expect(record(last(missing))).toMatchObject({ latch: ['right'], usedActivations: ['a1'] });
    const supplied = play(last(missing), [move([right(IN)]), move([right(IN)])]);
    expect(dwellView(last(supplied), 'a').owner).toBeNull();
    expect(supplied.events.flat()).toEqual([]);
    const changed = play(last(missing), times(3, move([right(IN)], STEP, [NEXT])));
    expect(record(last(changed))).toMatchObject({ owner: null, latch: ['right'] });
    // Once the pointer leaves, the changed activation can be held, and the old one stays used.
    const free = play(last(changed), [move([right(OUT)], STEP, [NEXT]), move([right(IN)], STEP, [NEXT])]);
    expect(dwellView(last(free), 'a').owner).toBe('right');
    expect(record(last(free))?.usedActivations).toEqual(['a1']);
  });
});

describe('stepDwell, the hit area of this step, dt and odd input', () => {
  it('a radius or centre that changes under the same activation id keeps the hold and classifies with this step\'s hit area', () => {
    const NEAR: Vec2 = { x: CENTRE.x + RADIUS / 2, y: CENTRE.y };
    const played = play(createDwell(), [
      move([right(NEAR)]),
      move([right(NEAR)]),
      // The radius shrinks under the pointer: Outside this step, progress frozen, the hold kept.
      move([right(NEAR)], STEP, [area({ radius: RADIUS / 4 })]),
      // The centre moves to the pointer: Inside again, the same hold goes on.
      move([right(NEAR)], STEP, [area({ centre: NEAR, radius: RADIUS / 4 })]),
    ]);
    expect(record(played.states[2] as DwellState)).toMatchObject({ owner: 'right', progressMs: STEP, outsideMs: STEP });
    expect(record(played.states[3] as DwellState)).toMatchObject({ owner: 'right', progressMs: 2 * STEP, outsideMs: 0 });
  });

  it('uses dt as given: a delta above maxClockStepMs counts in full, and a delta of 0 changes no timer or progress', () => {
    const big = play(createDwell(), [ACQUIRE, move([right(IN)], 3 * STEP)]);
    expect(dwellView(last(big), 'a').progressMs).toBe(3 * STEP);
    const zero = play(createDwell(), [ACQUIRE, move([right(IN)]), move([right(OUT)], 0), move([right(null)], 0), move([right(IN)], 0)]);
    expect(record(last(zero))).toMatchObject({ progressMs: STEP, outsideMs: 0, invalidMs: 0, owner: 'right' });
    const bigOutside = play(createDwell(), [ACQUIRE, move([right(OUT)], 2 * OUTSIDE_WINDOW)]);
    expect(dwellView(last(bigOutside), 'a').owner).toBeNull();
  });

  it('counts the first hit area of a target id and the first pointer of a wrist', () => {
    const far = area({ centre: { x: CENTRE.x + FAR * RADIUS, y: CENTRE.y } });
    expect(last(play(createDwell(), [move([right(IN)], STEP, [far, AREA])])).targets).toEqual([]);
    expect(dwellView(last(play(createDwell(), [move([right(IN)], STEP, [AREA, far])])), 'a').owner).toBe('right');
    expect(last(play(createDwell(), [move([right(null), right(IN)])])).targets).toEqual([]);
    expect(dwellView(last(play(createDwell(), [move([right(IN), right(null)])])), 'a').owner).toBe('right');
  });

  it('keeps targets apart: overlapping targets are held, progressed and selected independently, one pointer on both (Req 17.4, 17.6)', () => {
    const b = area({ targetId: 'b', activationId: 'b1' });
    const both = [AREA, b];
    const played = play(createDwell(), [
      move([right(IN)], STEP, both),
      ...times(SELECT_STEPS - 1, move([right(IN)], STEP, both)),
    ]);
    expect(dwellView(last(played), 'a')).toMatchObject({ owner: 'right', progressMs: DWELL - STEP });
    expect(dwellView(last(played), 'b')).toMatchObject({ owner: 'right', progressMs: DWELL - STEP });
    const done = play(last(played), [move([right(IN)], STEP, both)]);
    expect(done.events.flat()).toEqual([
      { kind: 'selected', targetId: 'a', activationId: 'a1', wrist: 'right' },
      { kind: 'selected', targetId: 'b', activationId: 'b1', wrist: 'right' },
    ]);
    // Another target does not disturb a target that is not supplied.
    const only = play(last(played), [move([right(IN)], STEP, [b])]);
    expect(dwellView(last(only), 'a')).toEqual({ owner: null, progressMs: 0, progress: 0 });
    expect(only.events.flat()).toHaveLength(1);
  });
});

describe('dwellView (Req 17.15)', () => {
  it('gives the owner, the progress in ms and as a fraction of dwellMs, and nothing for an unknown target', () => {
    const held = play(createDwell(), [ACQUIRE, ...times(3, move([right(IN)]))]);
    expect(dwellView(last(held), 'a')).toEqual({ owner: 'right', progressMs: 3 * STEP, progress: (3 * STEP) / DWELL });
    expect(dwellView(last(held), 'unknown')).toEqual({ owner: null, progressMs: 0, progress: 0 });
    expect(dwellView(createDwell(), 'a')).toEqual({ owner: null, progressMs: 0, progress: 0 });
  });
});

describe('stepDwell does not change its arguments', () => {
  it('leaves the state, the pointers and the hit areas as they were', () => {
    const deepFreeze = <T>(value: T): T => {
      if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    let state = deepFreeze(createDwell());
    const moves = [...SELECTING, move([right(OUT), left(IN)]), move([right(null)], STEP, [])];
    for (const m of moves) {
      const input = deepFreeze({ dt: m.dt ?? STEP, pointers: [...m.pointers], hitAreas: [...(m.areas ?? [AREA])] });
      const before = structuredClone({ state, input });
      const step = stepDwell(state, input);
      expect(structuredClone({ state, input })).toEqual(before);
      state = deepFreeze(step.state);
    }
  });
});

describe('marrow/core', () => {
  it('exports createDwell, stepDwell and dwellView (design section 6)', () => {
    expect(core.createDwell).toBe(createDwell);
    expect(core.stepDwell).toBe(stepDwell);
    expect(core.dwellView).toBe(dwellView);
  });
});
