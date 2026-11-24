// Property tests of the session machine (design 2.6; Req 1.3 to 1.6, 2.7, 9.3; steering 10 item 4). A script is a
// list of abstract steps. "Complete the active stage" is resolved against the live state when its step runs, so a
// script keeps completing stages it has already left, and it mixes stages that do not match. Problems are collected
// and checked once per run, as in attention.properties.test.ts. The last test checks that the runs visited the phases
// the machine can reach.
import fc from 'fast-check';
import { TUNING as MARROW_TUNING, type MotionLevel } from 'marrow/core';
import { TUNING as WORLD_TUNING } from 'world-view';
import { describe, expect, it } from 'vitest';
import {
  createSession,
  stepSession,
  targetsActive,
  type IgnoreReason,
  type Phase,
  type SessionEffect,
  type SessionEvent,
  type SessionInput,
  type SessionState,
  type Suspension,
} from './machine';
import { ROUTE, STAGE_IDS, type StageId } from './stageOrder';
import { TEST_SEGMENTS } from './testSegments';
import { APP_SESSION_TUNING } from './tuning';

/** Runs for P1 to P7 (the count the attention properties use). */
const RUNS = 300;
/** Runs for P8, the compliant driver. */
const DRIVER_RUNS = 100;

const FREE: Suspension = { paused: false, holdActive: false };
const MOTIONS: readonly MotionLevel[] = ['full', 'gentle', 'reduced'];

/** Phases seen across every run of this file. The last test checks them. */
const visited = new Set<Phase>();

const genMotion = fc.constantFrom(...MOTIONS);
const genStage = fc.constantFrom(...STAGE_IDS);
const genSuspension: fc.Arbitrary<Suspension> = fc.record({ paused: fc.boolean(), holdActive: fc.boolean() });
/** Mostly whole milliseconds from 0 to 9000, and now and then a value the machine must not count. */
const genDt: fc.Arbitrary<number> = fc.oneof(
  { weight: 9, arbitrary: fc.integer({ min: 0, max: 9000 }) },
  { weight: 1, arbitrary: fc.constantFrom(-1, Number.NaN, Number.POSITIVE_INFINITY) },
);

type Act =
  | 'completeActive'
  | 'completeOther'
  | 'completeDone'
  | 'calibrated'
  | 'setupDone'
  | 'startAt'
  | 'endCardShown'
  | 'none';

interface AbstractStep {
  readonly act: Act;
  readonly pick: StageId;
  readonly motion: MotionLevel;
  readonly dtMs: number;
  readonly suspension: Suspension;
}

// Completing the active stage is weighted high, so that the scripts reach BLOOM and SAVED often.
const genAct: fc.Arbitrary<Act> = fc.oneof(
  { weight: 12, arbitrary: fc.constant<Act>('completeActive') },
  { weight: 2, arbitrary: fc.constant<Act>('completeOther') },
  { weight: 2, arbitrary: fc.constant<Act>('completeDone') },
  { weight: 2, arbitrary: fc.constant<Act>('setupDone') },
  { weight: 2, arbitrary: fc.constant<Act>('calibrated') },
  { weight: 1, arbitrary: fc.constant<Act>('startAt') },
  { weight: 1, arbitrary: fc.constant<Act>('endCardShown') },
  { weight: 4, arbitrary: fc.constant<Act>('none') },
);

const genStep: fc.Arbitrary<AbstractStep> = fc.record({
  act: genAct,
  pick: genStage,
  motion: genMotion,
  dtMs: genDt,
  suspension: genSuspension,
});

const genScript = fc.array(genStep, { minLength: 1, maxLength: 400 });

/** Resolves an abstract step against the live state. Returns null for "no event". */
function resolve(s: SessionState, step: AbstractStep): SessionEvent | null {
  const active = (): SessionEvent => ({ kind: 'stageCompleted', stage: s.stage ?? step.pick });
  switch (step.act) {
    case 'none':
      return null;
    case 'setupDone':
      return { kind: 'setupDone' };
    case 'calibrated':
      return { kind: 'calibrated' };
    case 'endCardShown':
      return { kind: 'endCardShown' };
    case 'startAt':
      return { kind: 'startAt', stage: step.pick };
    case 'completeActive':
      return active();
    case 'completeOther': {
      const others = STAGE_IDS.filter((id) => id !== s.stage);
      return { kind: 'stageCompleted', stage: others.includes(step.pick) ? step.pick : (others[0] ?? step.pick) };
    }
    case 'completeDone':
      return s.done.length === 0 ? active() : { kind: 'stageCompleted', stage: s.done.includes(step.pick) ? step.pick : (s.done[0] ?? step.pick) };
  }
}

const inputOf = (step: AbstractStep): SessionInput => ({ dtMs: step.dtMs, motion: step.motion, suspension: step.suspension });

const isRewarded = (effects: readonly SessionEffect[]): boolean => effects.some((e) => e.kind === 'rewardStarted');

const stageIndex = (stage: StageId): number => STAGE_IDS.indexOf(stage);

/** The reason a completion is refused, by the order of the rules: phase, stage, done, suspended. Null when accepted. */
function refusalOf(s: SessionState, stage: StageId, suspension: Suspension): IgnoreReason | null {
  if (s.phase !== 'PLAYING' && s.phase !== 'BLOOM') return 'phase';
  if (stage !== s.stage) return 'stage';
  if (s.done.includes(stage)) return 'done';
  if (suspension.paused || suspension.holdActive) return 'suspended';
  return null;
}

/** Runs the abstract steps from SETUP and returns every state, so a property can look at each step. */
function runScript(script: readonly AbstractStep[]): SessionState {
  let s = createSession(TEST_SEGMENTS);
  for (const step of script) {
    s = stepSession(s, resolve(s, step), inputOf(step)).state;
    visited.add(s.phase);
  }
  return s;
}

describe('session machine properties (machine.properties.test.ts)', () => {
  it('P1: each stage activates once and is rewarded once, with at most one transition per step (Req 1.3)', () => {
    fc.assert(
      fc.property(genScript, (script) => {
        const problems: string[] = [];
        const activated = new Map<StageId, number>();
        const rewarded = new Map<StageId, number>();
        let s = createSession(TEST_SEGMENTS);
        script.forEach((step, i) => {
          const r = stepSession(s, resolve(s, step), inputOf(step));
          const transitions = r.effects.filter(
            (e) => e.kind === 'stageActivated' || e.kind === 'rewardStarted' || e.kind === 'travelStarted',
          );
          if (transitions.length > 1) problems.push(`step ${i}: ${transitions.length} transitions`);
          for (const e of r.effects) {
            if (e.kind === 'stageActivated') activated.set(e.stage, (activated.get(e.stage) ?? 0) + 1);
            if (e.kind === 'rewardStarted') rewarded.set(e.stage, (rewarded.get(e.stage) ?? 0) + 1);
          }
          s = r.state;
          visited.add(s.phase);
        });
        for (const [stage, n] of activated) if (n > 1) problems.push(`${stage} activated ${n} times`);
        for (const [stage, n] of rewarded) if (n > 1) problems.push(`${stage} rewarded ${n} times`);
        expect(problems).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('P2: a completion is accepted exactly when the rules allow it, and a refusal changes nothing (Req 1.3, 1.4)', () => {
    fc.assert(
      fc.property(genScript, genStage, genSuspension, (script, stage, suspension) => {
        const problems: string[] = [];
        const before = runScript(script);
        const refusal = refusalOf(before, stage, suspension);
        const r = stepSession(before, { kind: 'stageCompleted', stage }, { dtMs: 0, motion: 'full', suspension });
        const accepted = isRewarded(r.effects);
        if (accepted !== (refusal === null)) problems.push(`accepted=${accepted}, expected refusal=${refusal}`);
        if (!accepted) {
          if (refusal !== null && !r.effects.some((e) => e.kind === 'ignored' && e.reason === refusal)) {
            problems.push(`refusal reason ${refusal} missing from ${JSON.stringify(r.effects)}`);
          }
          if (JSON.stringify(r.state) !== JSON.stringify(before)) problems.push('a refused completion changed the state');
        }
        expect(problems).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('P3: no completion is accepted while entering, travelling, celebrating, in setup, calibrating or saved (Req 1.4)', () => {
    const closed: readonly Phase[] = ['SETUP', 'CALIBRATING', 'ENTERING', 'CELEBRATING', 'TRAVELLING', 'SAVED'];
    fc.assert(
      fc.property(genScript, genStage, (script, stage) => {
        const problems: string[] = [];
        const before = runScript(script);
        const r = stepSession(before, { kind: 'stageCompleted', stage }, { dtMs: 0, motion: 'full', suspension: FREE });
        if (closed.includes(before.phase)) {
          if (isRewarded(r.effects)) problems.push(`completion accepted in ${before.phase}`);
          if (!r.effects.some((e) => e.kind === 'ignored' && e.reason === 'phase')) problems.push(`no phase refusal in ${before.phase}`);
        }
        expect(problems).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('P4: under any suspension flag, a step with no event changes nothing (Req 1.5)', () => {
    const quietFlags = genSuspension.filter((x) => x.paused || x.holdActive);
    const quietStep = fc.record({ dtMs: genDt, suspension: quietFlags });
    fc.assert(
      fc.property(genScript, genMotion, fc.array(quietStep, { minLength: 1, maxLength: 20 }), (script, motion, quiet) => {
        // One motion level for the whole run, prefix included. A change to less motion during a paused travel is
        // the only state change that flags allow, so a changing level would make this property false.
        const fixed = script.map((step) => ({ ...step, motion }));
        const problems: string[] = [];
        let s = runScript(fixed);
        for (const q of quiet) {
          const before = s;
          const r = stepSession(s, null, { dtMs: q.dtMs, motion, suspension: q.suspension });
          if (JSON.stringify(r.state) !== JSON.stringify(before)) problems.push(`state changed under ${JSON.stringify(q.suspension)} in ${before.phase}`);
          if (r.effects.length > 0) problems.push(`effects under a flag: ${JSON.stringify(r.effects)}`);
          s = r.state;
        }
        expect(problems).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('P5: the same inputs always give the same state and effects (Req 1.6)', () => {
    fc.assert(
      fc.property(genScript, (script) => {
        const trace = (): string[] => {
          const out: string[] = [];
          let s = createSession(TEST_SEGMENTS);
          for (const step of script) {
            const r = stepSession(s, resolve(s, step), inputOf(step));
            out.push(JSON.stringify({ state: r.state, effects: r.effects }));
            s = r.state;
          }
          return out;
        };
        expect(trace()).toEqual(trace());
      }),
      { numRuns: RUNS },
    );
  });

  it('P6: targets are active only in PLAYING or BLOOM, after travel has arrived (Req 2.7)', () => {
    fc.assert(
      fc.property(genScript, (script) => {
        const problems: string[] = [];
        let s = createSession(TEST_SEGMENTS);
        script.forEach((step, i) => {
          s = stepSession(s, resolve(s, step), inputOf(step)).state;
          if (targetsActive(s)) {
            if (s.phase !== 'PLAYING' && s.phase !== 'BLOOM') problems.push(`step ${i}: targets active in ${s.phase}`);
            if (s.travel !== null && s.travel.phase !== 'arrived') problems.push(`step ${i}: targets active while travel is ${s.travel.phase}`);
          }
          if (s.phase === 'TRAVELLING' && targetsActive(s)) problems.push(`step ${i}: targets active while travelling`);
        });
        expect(problems).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('P7: activations come in stage order, done is a contiguous run in stage order, and SAVED changes only by ignored effects', () => {
    fc.assert(
      fc.property(genScript, (script) => {
        const problems: string[] = [];
        let s = createSession(TEST_SEGMENTS);
        let lastActivated = -1;
        script.forEach((step, i) => {
          const before = s;
          const r = stepSession(s, resolve(s, step), inputOf(step));
          for (const e of r.effects) {
            if (e.kind !== 'stageActivated') continue;
            const index = stageIndex(e.stage);
            if (index <= lastActivated) problems.push(`step ${i}: ${e.stage} activated after a later stage`);
            lastActivated = index;
          }
          // startAt may begin at any stage, so done is a contiguous run from its first entry, not a prefix from lantern.
          const indexes = r.state.done.map(stageIndex);
          if (!indexes.every((value, k) => k === 0 || value === (indexes[k - 1] ?? value) + 1)) {
            problems.push(`step ${i}: done is not contiguous: ${r.state.done.join(',')}`);
          }
          if (before.phase === 'SAVED') {
            if (JSON.stringify(r.state) !== JSON.stringify(before)) problems.push(`step ${i}: SAVED changed`);
            if (r.effects.some((e) => e.kind !== 'ignored')) problems.push(`step ${i}: SAVED produced a non-ignored effect`);
          }
          s = r.state;
          visited.add(s.phase);
        });
        expect(problems).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('P8: a compliant driver reaches SAVED within a bounded number of steps, for every motion level', () => {
    // The bound: the longest session in time (Gentle travel, the slowest level) plus a slack of one maximum step for
    // each transition, divided by the smallest step the generator uses.
    const MAX_DT = MARROW_TUNING.maxClockStepMs;
    const MIN_DT = MAX_DT / 2;
    const travelMs = ROUTE.flatMap((step) => (step.kind === 'travel' ? [TEST_SEGMENTS[step.journey].durationMs] : []));
    const worstMs =
      APP_SESSION_TUNING.entryTitleMs +
      STAGE_IDS.length * APP_SESSION_TUNING.rewardToTravelMs +
      WORLD_TUNING.gentleTravelMultiplier * travelMs.reduce((a, b) => a + b, 0);
    const stepBound = Math.ceil((worstMs + (ROUTE.length + STAGE_IDS.length) * MAX_DT) / MIN_DT);

    fc.assert(
      fc.property(genMotion, fc.integer({ min: MIN_DT, max: MAX_DT }), (motion, dtMs) => {
        const problems: string[] = [];
        let s = createSession(TEST_SEGMENTS);
        let steps = 0;
        let ignored = 0;
        const feed = (event: SessionEvent | null): void => {
          const r = stepSession(s, event, { dtMs, motion, suspension: FREE });
          s = r.state;
          steps += 1;
          ignored += r.effects.filter((e) => e.kind === 'ignored').length;
          visited.add(s.phase);
        };
        feed({ kind: 'setupDone' });
        feed({ kind: 'calibrated' });
        while (s.phase !== 'SAVED' && steps < stepBound) {
          feed(targetsActive(s) && s.stage !== null ? { kind: 'stageCompleted', stage: s.stage } : null);
        }
        if (s.phase !== 'SAVED') problems.push(`not SAVED after ${steps} steps (bound ${stepBound}), phase ${s.phase}`);
        if (ignored > 0) problems.push(`${ignored} ignored effects in a compliant run`);
        if (JSON.stringify(s.done) !== JSON.stringify(STAGE_IDS)) problems.push(`done is ${s.done.join(',')}`);
        expect(problems).toEqual([]);
      }),
      { numRuns: DRIVER_RUNS },
    );
  });

  it('every phase the machine can reach is visited across the property runs', () => {
    const required: readonly Phase[] = ['ENTERING', 'PLAYING', 'CELEBRATING', 'TRAVELLING', 'BLOOM', 'SAVED'];
    const missing = required.filter((phase) => !visited.has(phase));
    expect(missing).toEqual([]);
  });
});
