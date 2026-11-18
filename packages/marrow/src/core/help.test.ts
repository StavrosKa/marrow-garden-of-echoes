import { describe, expect, it } from 'vitest';
import {
  createHelp,
  helpRadiusForMotorLevel,
  stepHelp,
  type HelpAxis,
  type HelpEvent,
  type HelpFlags,
  type HelpOutput,
  type HelpState,
  type HelpStep,
} from './help';
import * as core from './index';
import { TUNING } from './tuning';

// Every threshold comes from TUNING: the difficulties before help, the highest level, the radii.
// A round of "the difficulties before help" difficulties is written with N, and a tie with equal
// counts of each axis that reach N. The sessions are scripts of events with explicit flags.

const N = TUNING.difficultiesBeforeHelp;
const MAX = TUNING.helpMaxLevel;
/** Half of N, rounded up: with this many difficulties of each axis a round ties and has at least N. */
const HALF = Math.ceil(N / 2);

const SAFE: HelpFlags = { dwellActive: false, playbackActive: false };
const DWELL: HelpFlags = { dwellActive: true, playbackActive: false };
const PLAYBACK: HelpFlags = { dwellActive: false, playbackActive: true };
const BOTH: HelpFlags = { dwellActive: true, playbackActive: true };

const start = (steps: number, flags: HelpFlags = SAFE): HelpEvent => ({ kind: 'roundStarted', steps, ...flags });
const hard = (axis: HelpAxis, flags: HelpFlags = SAFE): HelpEvent => ({ kind: 'difficulty', axis, ...flags });
const done = (flags: HelpFlags = SAFE): HelpEvent => ({ kind: 'stepCompleted', ...flags });
const help = (flags: HelpFlags = SAFE): HelpEvent => ({ kind: 'continueWithHelp', ...flags });
const end = (motorStepAllowed = true, flags: HelpFlags = SAFE): HelpEvent => ({ kind: 'roundEnded', motorStepAllowed, ...flags });

const times = <T>(count: number, one: T): T[] => Array.from({ length: count }, () => one);
/** `count` difficulty events of one axis. */
const hards = (count: number, axis: HelpAxis, flags: HelpFlags = SAFE): HelpEvent[] => times(count, hard(axis, flags));
/** `count` difficulties of one axis, as the list a round is made from. */
const many = (count: number, axis: HelpAxis): HelpAxis[] => times(count, axis);

/** A round that ends with the given difficulties: start, the difficulties, end. The flags go on every event of it. */
function round(difficulties: readonly HelpAxis[], flags: HelpFlags = SAFE, motorStepAllowed = true, steps = 3): HelpEvent[] {
  return [start(steps, flags), ...difficulties.map((axis) => hard(axis, flags)), end(motorStepAllowed, flags)];
}

/** At least N difficulties, more of motor, of cognitive, or the same of each. */
const MOTOR_HEAVY: HelpAxis[] = [...times(HALF + 1, 'motor' as const), ...times(HALF, 'cognitive' as const)];
const COGNITIVE_HEAVY: HelpAxis[] = [...times(HALF, 'motor' as const), ...times(HALF + 1, 'cognitive' as const)];
const TIE: HelpAxis[] = [...times(HALF, 'motor' as const), ...times(HALF, 'cognitive' as const)];

interface Played {
  readonly steps: HelpStep[];
  readonly last: HelpStep;
}

function play(events: readonly HelpEvent[], from: HelpState = createHelp(TUNING)): Played {
  const steps: HelpStep[] = [];
  let state = from;
  for (const event of events) {
    const result = stepHelp(state, event);
    steps.push(result);
    state = result.state;
  }
  const last = steps[steps.length - 1];
  if (last === undefined) throw new Error('empty script');
  return { steps, last };
}

const levels = (state: HelpState): [number, number] => [state.motorLevel, state.cognitiveLevel];
const kinds = (outputs: readonly HelpOutput[]): string[] => outputs.map((o) => o.kind);
const raised = (played: Played): string[] =>
  played.steps.flatMap((s) => s.outputs.flatMap((o) => (o.kind === 'levelRaised' ? [`${o.axis}:${o.level}`] : [])));

describe('createHelp and helpRadiusForMotorLevel', () => {
  it('starts at level 0 on both axes with nothing waiting and no round, and reads its thresholds from the tuning argument (Req 19.6)', () => {
    expect(createHelp()).toEqual({
      cfg: { difficultiesBeforeHelp: TUNING.difficultiesBeforeHelp, helpMaxLevel: TUNING.helpMaxLevel },
      motorLevel: 0,
      cognitiveLevel: 0,
      lastChanged: null,
      pending: [],
      round: null,
    });
    const other = createHelp({ ...TUNING, difficultiesBeforeHelp: N + 1, helpMaxLevel: 1 });
    expect(other.cfg).toEqual({ difficultiesBeforeHelp: N + 1, helpMaxLevel: 1 });
  });

  it('maps the motor levels to motorRadii, the first of which is the hit radius (Req 19.7)', () => {
    for (let level = 0; level <= MAX; level++) expect(helpRadiusForMotorLevel(level, TUNING)).toBe(TUNING.motorRadii[level]);
    expect(helpRadiusForMotorLevel(0, TUNING)).toBe(TUNING.hitRadius);
    const radii = [0.08, 0.1, 0.12];
    const custom = { ...TUNING, motorRadii: radii, helpMaxLevel: 2 };
    expect([0, 1, 2].map((level) => helpRadiusForMotorLevel(level, custom))).toEqual(radii);
  });

  it('takes a level that is not one of the levels as the nearest one, and NaN as level 0', () => {
    // A hit radius that is none of the level radii, so that a clamp cannot be mistaken for a fallback to the hit radius.
    const apart = { ...TUNING, hitRadius: 2 * TUNING.hitRadiusMax };
    expect(helpRadiusForMotorLevel(-3, apart)).toBe(TUNING.motorRadii[0]);
    expect(helpRadiusForMotorLevel(MAX + 5, apart)).toBe(TUNING.motorRadii[MAX]);
    expect(helpRadiusForMotorLevel(MAX - 0.1, apart)).toBe(TUNING.motorRadii[MAX - 1]);
    expect(helpRadiusForMotorLevel(NaN, apart)).toBe(TUNING.motorRadii[0]);
    // The highest level and the number of radii each bound the level.
    const lower = { ...apart, helpMaxLevel: MAX - 1 };
    expect(helpRadiusForMotorLevel(MAX, lower)).toBe(TUNING.motorRadii[MAX - 1]);
    const fewer = { ...apart, motorRadii: TUNING.motorRadii.slice(0, MAX) };
    expect(helpRadiusForMotorLevel(MAX, fewer)).toBe(TUNING.motorRadii[MAX - 1]);
  });
});

describe('stepHelp, offer help (Req 19.3)', () => {
  it('emits it in the event of difficulty number difficultiesBeforeHelp, counted over both axes, and in no other event of the round', () => {
    const axes: HelpAxis[] = ['motor', 'cognitive', 'cognitive', 'motor', 'motor', 'cognitive'];
    const played = play([start(3), ...axes.map((axis) => hard(axis))]);
    const offerAt = played.steps.flatMap((s, i) => (kinds(s.outputs).includes('offerHelp') ? [i] : []));
    // Index 0 is the round start, so difficulty number k is at index k.
    expect(offerAt).toEqual([N]);
    expect(played.steps.flatMap((s) => kinds(s.outputs)).filter((k) => k === 'offerHelp')).toHaveLength(1);
  });

  it('counts the difficulties of the two axes together, whichever comes first', () => {
    for (const order of [['motor', 'cognitive'], ['cognitive', 'motor']] as const) {
      const axes = [...times(N - 1, order[0]), order[1]];
      const played = play([start(3), ...axes.map((axis) => hard(axis))]);
      expect(played.steps.map((s) => kinds(s.outputs).includes('offerHelp'))).toEqual([false, ...times(N - 1, false), true]);
    }
  });

  it('offers again in each new round, and reports it whatever the flags say', () => {
    const second = play([...round(many(N, 'motor'), BOTH, true), ...round(many(N, 'cognitive'), BOTH, true)]);
    expect(second.steps.flatMap((s) => kinds(s.outputs)).filter((k) => k === 'offerHelp')).toHaveLength(2);
  });

  it('does not count a completed step as a difficulty', () => {
    // N steps completed, then N difficulties: the offer comes with the last difficulty and not before.
    const played = play([start(N), ...times(N, done()), ...hards(N, 'motor')]);
    expect(played.steps.map((s) => kinds(s.outputs).includes('offerHelp'))).toEqual([...times(2 * N, false), true]);
    // N - 1 difficulties and N completed steps are not enough for a raise.
    expect(raised(play([start(N), ...times(N, done()), ...hards(N - 1, 'motor'), end()]))).toEqual([]);
  });

  it('uses the tuning argument, and does nothing outside a round', () => {
    const three = createHelp({ ...TUNING, difficultiesBeforeHelp: 3 });
    const played = play([start(3), hard('motor'), hard('motor'), hard('cognitive'), hard('cognitive')], three);
    expect(played.steps.map((s) => kinds(s.outputs).includes('offerHelp'))).toEqual([false, false, false, true, false]);
    const one = createHelp({ ...TUNING, difficultiesBeforeHelp: 1 });
    expect(kinds(play([start(3), hard('cognitive')], one).last.outputs)).toEqual(['offerHelp']);
    expect(play([hard('motor'), hard('motor'), hard('cognitive')]).steps.flatMap((s) => s.outputs)).toEqual([]);
  });
});

describe('stepHelp, the raise at the end of a round (Req 19.4)', () => {
  it('changes nothing for a round with fewer than difficultiesBeforeHelp difficulties, and raises one axis for N', () => {
    const few = play(round(many(N - 1, 'motor')));
    expect(levels(few.last.state)).toEqual([0, 0]);
    expect(raised(few)).toEqual([]);
    const enough = play(round(many(N, 'motor')));
    expect(levels(enough.last.state)).toEqual([1, 0]);
    expect(raised(enough)).toEqual(['motor:1']);
    expect(enough.last.state.round).toBeNull();
  });

  it('reads the number of difficulties it needs from the tuning argument', () => {
    const more = createHelp({ ...TUNING, difficultiesBeforeHelp: N + 1 });
    expect(raised(play(round(many(N, 'motor')), more))).toEqual([]);
    expect(raised(play(round(many(N + 1, 'motor')), more))).toEqual(['motor:1']);
    const one = createHelp({ ...TUNING, difficultiesBeforeHelp: 1 });
    expect(raised(play(round(many(one.cfg.difficultiesBeforeHelp, 'cognitive')), one))).toEqual(['cognitive:1']);
    expect(raised(play(round([]), one))).toEqual([]);
  });

  it('raises the axis with more difficulties by one level, whichever it is, even for the first change', () => {
    expect(raised(play(round(MOTOR_HEAVY)))).toEqual(['motor:1']);
    expect(raised(play(round(COGNITIVE_HEAVY)))).toEqual(['cognitive:1']);
    // More difficulties win over "not changed last": motor was raised, and cognitive has more now.
    const then = play([...round(MOTOR_HEAVY), ...round(COGNITIVE_HEAVY)]);
    expect(raised(then)).toEqual(['motor:1', 'cognitive:1']);
    // The same axis again: it has more difficulties each time, so it is raised each time.
    const again = play([...round(COGNITIVE_HEAVY), ...round(COGNITIVE_HEAVY)]);
    expect(raised(again)).toEqual(['cognitive:1', 'cognitive:2']);
  });

  it('breaks a tie towards motor for the first change of the session', () => {
    expect(raised(play(round(TIE)))).toEqual(['motor:1']);
  });

  it('breaks a tie towards the axis not changed last: the other axis when only one has ever changed, and then each in turn', () => {
    expect(raised(play([...round(MOTOR_HEAVY), ...round(TIE)]))).toEqual(['motor:1', 'cognitive:1']);
    expect(raised(play([...round(COGNITIVE_HEAVY), ...round(TIE)]))).toEqual(['cognitive:1', 'motor:1']);
    expect(raised(play([...round(TIE), ...round(TIE), ...round(TIE), ...round(TIE)]))).toEqual([
      'motor:1',
      'cognitive:1',
      'motor:2',
      'cognitive:2',
    ]);
  });

  it('counts the fallback of Req 19.5 as the last change: the next tie goes to the axis that was passed over', () => {
    // A tie goes to motor, motor is not allowed, so cognitive is raised and counts as changed last.
    const played = play([...round(TIE, SAFE, false), ...round(TIE, SAFE, true)]);
    expect(raised(played)).toEqual(['cognitive:1', 'motor:1']);
    // Where it matters: motor was changed last, then motor is chosen but not allowed and cognitive is raised in its place.
    // That counts as the last change, so a tie goes to motor. Had it not counted, motor would still be the last change
    // and the tie would go to cognitive.
    const matters = play([...round(MOTOR_HEAVY), ...round(MOTOR_HEAVY, SAFE, false), ...round(TIE)]);
    expect(raised(matters)).toEqual(['motor:1', 'cognitive:1', 'motor:2']);
  });
});

describe('stepHelp, when the chosen axis cannot step (Req 19.5)', () => {
  /** A state with the given levels, reached by rounds that raise exactly those. */
  function reach(motor: number, cognitive: number): HelpState {
    const events = [...times(motor, round(MOTOR_HEAVY)).flat(), ...times(cognitive, round(COGNITIVE_HEAVY)).flat()];
    return events.length === 0 ? createHelp(TUNING) : play(events).last.state;
  }

  it('raises the other axis when motor is chosen but a motor step is not allowed', () => {
    expect(raised(play(round(MOTOR_HEAVY, SAFE, false)))).toEqual(['cognitive:1']);
  });

  it('raises the other axis when the chosen axis is at its highest level', () => {
    const motorTop = reach(MAX, 0);
    expect(levels(motorTop)).toEqual([MAX, 0]);
    expect(raised(play(round(MOTOR_HEAVY), motorTop))).toEqual(['cognitive:1']);
    const cognitiveTop = reach(0, MAX);
    expect(raised(play(round(COGNITIVE_HEAVY), cognitiveTop))).toEqual(['motor:1']);
  });

  it('changes nothing when the other axis cannot step either', () => {
    // Cognitive chosen at its top, and motor not allowed.
    expect(raised(play(round(COGNITIVE_HEAVY, SAFE, false), reach(0, MAX)))).toEqual([]);
    // Motor chosen but not allowed, and cognitive at its top.
    expect(raised(play(round(MOTOR_HEAVY, SAFE, false), reach(0, MAX)))).toEqual([]);
    // Both at their top.
    const top = reach(MAX, MAX);
    expect(levels(top)).toEqual([MAX, MAX]);
    const after = play([...round(MOTOR_HEAVY), ...round(COGNITIVE_HEAVY), ...round(TIE)], top);
    expect(raised(after)).toEqual([]);
    expect(levels(after.last.state)).toEqual([MAX, MAX]);
  });

  it('ignores the motor flag when cognitive is chosen', () => {
    expect(raised(play(round(COGNITIVE_HEAVY, SAFE, false)))).toEqual(['cognitive:1']);
  });

  it('keeps each level in 0..helpMaxLevel and never lowers one, however many rounds end', () => {
    const rounds = times(4 * MAX + 2, [...round(MOTOR_HEAVY), ...round(COGNITIVE_HEAVY), ...round(TIE)]).flat();
    const played = play(rounds);
    let motor = 0;
    let cognitive = 0;
    for (const s of played.steps) {
      expect(s.state.motorLevel).toBeGreaterThanOrEqual(motor);
      expect(s.state.cognitiveLevel).toBeGreaterThanOrEqual(cognitive);
      expect(s.state.motorLevel).toBeLessThanOrEqual(MAX);
      expect(s.state.cognitiveLevel).toBeLessThanOrEqual(MAX);
      motor = s.state.motorLevel;
      cognitive = s.state.cognitiveLevel;
    }
    expect(levels(played.last.state)).toEqual([MAX, MAX]);
    expect(raised(played)).toHaveLength(2 * MAX);
  });

  it('uses the highest level of the tuning argument', () => {
    const low = createHelp({ ...TUNING, helpMaxLevel: 1 });
    const played = play([...round(MOTOR_HEAVY), ...round(MOTOR_HEAVY), ...round(MOTOR_HEAVY)], low);
    expect(raised(played)).toEqual(['motor:1', 'cognitive:1']);
  });
});

describe('stepHelp, a change that waits for a moment without a dwell or a playback (Req 19.8)', () => {
  it('does not change a level in a round end that reports a dwell or a playback, and keeps the change waiting', () => {
    for (const flags of [DWELL, PLAYBACK, BOTH]) {
      const played = play([start(3), ...hards(N, 'motor'), end(true, flags)]);
      expect(kinds(played.last.outputs)).toEqual([]);
      expect(levels(played.last.state)).toEqual([0, 0]);
      expect(played.last.state.pending).toEqual(['motor']);
      expect(played.last.state.lastChanged).toBeNull();
    }
  });

  it('applies it in the next event that reports neither, before handling that event, and not in an event that reports one', () => {
    const waiting = play([start(3), ...hards(N, 'motor'), end(true, DWELL)]).last.state;
    for (const flags of [DWELL, PLAYBACK, BOTH]) {
      const still = play([help(flags), done(flags), start(2, flags)], waiting);
      expect(still.steps.every((s) => s.outputs.length === 0)).toBe(true);
      expect(still.last.state.pending).toEqual(['motor']);
    }
    const applied = play([start(2)], waiting);
    expect(applied.last.outputs).toEqual([{ kind: 'levelRaised', axis: 'motor', level: 1 }]);
    expect(applied.last.state.pending).toEqual([]);
    expect(applied.last.state.lastChanged).toBe('motor');
    // Before the event: the offer of the same event comes after the raise.
    const mixed = play([start(3, DWELL), ...hards(N - 1, 'motor', DWELL), hard('cognitive')], waiting);
    expect(kinds(mixed.last.outputs)).toEqual(['levelRaised', 'offerHelp']);
    // Before a "continue with help" too.
    const revealing = play([start(2, DWELL), help()], waiting);
    expect(kinds(revealing.last.outputs)).toEqual(['levelRaised', 'revealStep']);
  });

  it('applies it at an event of any kind, also outside a round', () => {
    const waiting = play([start(3), ...hards(N, 'cognitive'), end(true, PLAYBACK)]).last.state;
    for (const event of [done(), help(), hard('motor'), end(true)]) {
      expect(raised(play([event], waiting))).toEqual(['cognitive:1']);
    }
  });

  it('applies a change decided in a round end with neither flag at once', () => {
    const played = play(round(many(N, 'cognitive')));
    expect(kinds(played.last.outputs)).toEqual(['levelRaised']);
    expect(played.last.state.pending).toEqual([]);
  });
});

describe('stepHelp, changes that wait while another round ends (Req 19.8, 19.11, 19.13)', () => {
  it('queues the change of a later round behind the waiting one, deciding against the levels as they will be', () => {
    const played = play([...round(TIE, DWELL), ...round(TIE, PLAYBACK)]);
    // The first tie goes to motor; for the second, motor counts as changed last, so cognitive.
    expect(played.last.state.pending).toEqual(['motor', 'cognitive']);
    expect(levels(played.last.state)).toEqual([0, 0]);
  });

  it('applies one change per event, in order, in events that report neither', () => {
    const waiting = play([...round(TIE, DWELL), ...round(TIE, PLAYBACK)]).last.state;
    // An event that reports a dwell applies nothing; each of the next two events with neither applies one; the last applies none.
    const played = play([help(DWELL), start(2), done(), start(2)], waiting);
    expect(played.steps.map((s) => kinds(s.outputs))).toEqual([[], ['levelRaised'], ['levelRaised'], []]);
    expect(raised(played)).toEqual(['motor:1', 'cognitive:1']);
    expect(played.last.state.pending).toEqual([]);
  });

  it('applies the waiting change first when a round ends in a safe event, and queues the raise of that round', () => {
    // The whole round reports a dwell until its end, which reports neither.
    const events = [...round(TIE, DWELL).slice(0, -1), end(true, SAFE)];
    const waiting = play(round(TIE, DWELL)).last.state;
    const played = play(events, waiting);
    // The round-end event applies the waiting motor raise and queues the cognitive one: one change in the event.
    expect(kinds(played.last.outputs)).toEqual(['levelRaised']);
    expect(raised(played)).toEqual(['motor:1']);
    expect(played.last.state.pending).toEqual(['cognitive']);
    // Nothing is raised before the round end (the Nth difficulty only offers help).
    expect(played.steps.slice(0, -1).every((s) => !kinds(s.outputs).includes('levelRaised'))).toBe(true);
    expect(raised(play([start(1)], played.last.state))).toEqual(['cognitive:1']);
  });

  it('never queues more changes than the axes can still rise, and the whole session has at most 2 * helpMaxLevel', () => {
    const queued = play(times(3 * MAX + 3, round(MOTOR_HEAVY, DWELL)).flat());
    expect(queued.last.state.pending).toHaveLength(2 * MAX);
    expect(queued.last.state.pending.filter((a) => a === 'motor')).toHaveLength(MAX);
    const applied = play(times(2 * MAX + 3, start(1)), queued.last.state);
    expect(raised(applied)).toHaveLength(2 * MAX);
    expect(levels(applied.last.state)).toEqual([MAX, MAX]);
    expect(applied.last.state.pending).toEqual([]);
  });

  it('does not queue a change the other axis cannot take: a motor step that is not allowed is not queued', () => {
    const played = play(round(MOTOR_HEAVY, DWELL, false));
    expect(played.last.state.pending).toEqual(['cognitive']);
  });
});

describe('stepHelp, continue with help (Req 19.9)', () => {
  it('reveals the current step and counts it completed, one per event, in order', () => {
    const played = play([start(3), help(), help(), help()]);
    expect(played.steps.slice(1).map((s) => s.outputs)).toEqual([
      [{ kind: 'revealStep', step: 0 }],
      [{ kind: 'revealStep', step: 1 }],
      [{ kind: 'revealStep', step: 2 }],
    ]);
    expect(played.steps.slice(1).map((s) => s.state.round?.completed)).toEqual([1, 2, 3]);
  });

  it('reveals the first step that is not completed, after steps the player completed', () => {
    const played = play([start(4), done(), done(), help(), help()]);
    expect(played.steps.slice(3).map((s) => s.outputs)).toEqual([
      [{ kind: 'revealStep', step: 2 }],
      [{ kind: 'revealStep', step: 3 }],
    ]);
    expect(played.last.state.round?.completed).toBe(4);
  });

  it('is accepted in every state of a round, with a dwell or a playback active', () => {
    for (const flags of [SAFE, DWELL, PLAYBACK, BOTH]) {
      const played = play([start(2), help(flags)]);
      expect(played.last.outputs).toEqual([{ kind: 'revealStep', step: 0 }]);
    }
  });

  it('does nothing when the round has no step left, or when there is no round', () => {
    const finished = play([start(2), done(), done(), help()]);
    expect(finished.last.outputs).toEqual([]);
    expect(finished.last.state).toEqual(finished.steps[2]?.state);
    const extra = play([help(), help()], finished.last.state);
    expect(extra.steps.every((s) => s.outputs.length === 0 && s.state.round?.completed === 2)).toBe(true);
    const outside = play([help(), help(DWELL)]);
    expect(outside.steps.every((s) => s.outputs.length === 0)).toBe(true);
    expect(outside.last.state).toEqual(createHelp(TUNING));
    const between = play([...round(TIE), help()]);
    expect(between.last.outputs).toEqual([]);
  });

  it('is not a difficulty: it does not count toward offering help, or toward the raise', () => {
    const played = play([start(3), ...hards(N - 1, 'motor'), help(), help(), hard('motor')]);
    expect(played.steps.map((s) => kinds(s.outputs).includes('offerHelp'))).toEqual([...times(N + 2, false), true]);
    const noRaise = play([start(3), ...hards(N - 1, 'motor'), help(), help(), help(), end()]);
    expect(raised(noRaise)).toEqual([]);
  });

  it('applies a waiting change first when it comes in an event that reports neither', () => {
    const waiting = play([start(2), ...hards(N, 'motor'), end(true, DWELL)]).last.state;
    const played = play([start(2, DWELL), help()], waiting);
    expect(kinds(played.last.outputs)).toEqual(['levelRaised', 'revealStep']);
  });

  it('completes a round with n steps and c completed after n - c of them', () => {
    for (const [n, c] of [[1, 0], [5, 0], [5, 3], [10, 9]] as const) {
      const prefix = [start(n), ...times(c, done())];
      const played = play([...prefix, ...times(n - c, help())]);
      expect(played.last.state.round?.completed).toBe(n);
      expect(played.steps.slice(prefix.length).flatMap((s) => s.outputs.map((o) => (o.kind === 'revealStep' ? o.step : -1)))).toEqual(
        Array.from({ length: n - c }, (_, i) => c + i),
      );
    }
  });
});

describe('stepHelp, rounds and events outside them', () => {
  it('counts a completed step, never beyond the steps of the round, and ignores one outside a round', () => {
    const played = play([start(2), done(), done(), done()]);
    expect(played.steps.map((s) => s.state.round?.completed)).toEqual([0, 1, 2, 2]);
    expect(played.steps.every((s) => s.outputs.length === 0)).toBe(true);
    expect(play([done(), done()]).last.state).toEqual(createHelp(TUNING));
  });

  it('counts a round start, a difficulty and a completed step whatever the flags say: the flags only gate a change of level', () => {
    for (const flags of [DWELL, PLAYBACK, BOTH]) {
      const played = play([start(3, flags), ...hards(N - 1, 'motor', flags), done(flags), done(flags)]);
      expect(played.last.state.round).toEqual({ steps: 3, completed: 2, motorDifficulties: N - 1, cognitiveDifficulties: 0, offered: false });
      expect(played.steps.every((s) => s.outputs.length === 0)).toBe(true);
    }
  });

  it('starts a fresh round, dropping an unfinished one: its difficulties earn no raise', () => {
    const played = play([start(3), done(), ...hards(N, 'motor'), start(2), end()]);
    expect(raised(played)).toEqual([]);
    // The step completed and the difficulties of the dropped round, and its offer, are not carried over.
    expect(played.steps[N + 2]?.state.round).toEqual({ steps: 2, completed: 0, motorDifficulties: 0, cognitiveDifficulties: 0, offered: false });
  });

  it('takes a step count outside the contract as a round with no steps, and a fractional one rounded down', () => {
    for (const steps of [0, -3, NaN, Infinity]) {
      const played = play([start(steps), help()]);
      expect(played.last.outputs).toEqual([]);
      expect(played.steps[0]?.state.round?.steps).toBe(0);
    }
    expect(play([start(2.9)]).last.state.round?.steps).toBe(2);
  });

  it('ignores a difficulty and a round end outside a round', () => {
    const played = play([hard('motor'), hard('cognitive'), end(true), ...round(many(N - 1, 'motor')), hard('motor'), end()]);
    expect(raised(played)).toEqual([]);
    expect(played.steps.flatMap((s) => kinds(s.outputs))).toEqual([]);
  });
});

describe('stepHelp, arguments and barrel', () => {
  it('leaves the state and the event as they were', () => {
    const deepFreeze = <T>(value: T): T => {
      if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    let state = deepFreeze(createHelp(TUNING));
    const events = [...round(TIE, DWELL), ...round(TIE, PLAYBACK), start(3), help(), ...round(MOTOR_HEAVY), hard('motor')];
    for (const raw of events) {
      const event = deepFreeze({ ...raw });
      const before = structuredClone({ state, event });
      const result = stepHelp(state, event);
      expect(structuredClone({ state, event })).toEqual(before);
      state = deepFreeze(result.state);
    }
  });

  it('exports createHelp, stepHelp and helpRadiusForMotorLevel (design section 6)', () => {
    expect(core.createHelp).toBe(createHelp);
    expect(core.stepHelp).toBe(stepHelp);
    expect(core.helpRadiusForMotorLevel).toBe(helpRadiusForMotorLevel);
  });
});
