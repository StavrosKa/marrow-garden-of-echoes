import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createHelp, stepHelp, type HelpEvent, type HelpFlags, type HelpOutput, type HelpState } from './help';
import { genHelpSession } from './testgen';
import { TUNING } from './tuning';

// The properties of Req 19.11 - 19.13 (steering section 10, invariant 6). Each runs a generated session
// through stepHelp and judges it with an oracle written here from the events alone: the rounds are followed
// as the caller sees them (a round starts, counts its difficulties and its completed steps, and ends), and
// nothing is read from the policy but its outputs, its levels and the list of changes it keeps waiting.
// Problems are collected and checked once per run, because an expect call for every event is too slow.

const RUNS = 300;
/** How many problems of a failing run are shown. A test parameter. */
const SHOWN = 5;
const N = TUNING.difficultiesBeforeHelp;
const MAX = TUNING.helpMaxLevel;

const NEITHER: HelpFlags = { dwellActive: false, playbackActive: false };
/** Every combination of the two flags, for the events a property sends itself. */
const FLAG_SETS: readonly HelpFlags[] = [
  NEITHER,
  { dwellActive: true, playbackActive: false },
  { dwellActive: false, playbackActive: true },
  { dwellActive: true, playbackActive: true },
];
const flagsAt = (n: number): HelpFlags => FLAG_SETS[n % FLAG_SETS.length] ?? NEITHER;

/** Whether the event reports neither a dwell nor a playback. */
const hasNeither = (event: HelpEvent): boolean => !event.dwellActive && !event.playbackActive;

/** What the events alone say about the round in progress: its steps, how many are completed, and its difficulties. */
interface Open {
  readonly steps: number;
  readonly done: number;
  readonly difficulties: number;
}

/**
 * The round in progress after an event, and whether the event ended a round that earns a change: one
 * with at least difficultiesBeforeHelp difficulties. A round start replaces a round that is open, an
 * event outside a round does nothing, and a completed step or "continue with help" completes one more
 * step, up to the steps of the round.
 */
function follow(open: Open | null, event: HelpEvent): { open: Open | null; earns: boolean } {
  switch (event.kind) {
    case 'roundStarted':
      return { open: { steps: event.steps, done: 0, difficulties: 0 }, earns: false };
    case 'difficulty':
      return { open: open === null ? null : { ...open, difficulties: open.difficulties + 1 }, earns: false };
    case 'stepCompleted':
    case 'continueWithHelp':
      return { open: open === null ? null : { ...open, done: Math.min(open.steps, open.done + 1) }, earns: false };
    case 'roundEnded':
      return { open: null, earns: open !== null && open.difficulties >= N };
  }
}

type Raised = Extract<HelpOutput, { readonly kind: 'levelRaised' }>;
const raisedIn = (outputs: readonly HelpOutput[]): Raised[] => outputs.flatMap((o) => (o.kind === 'levelRaised' ? [o] : []));

describe('help properties (Req 19.11 - 19.13)', () => {
  // help_at_most_one_axis_per_event (Req 19.11): each processed event changes at most one axis, by exactly
  // +1, and only in a round-ended event or a deferred application, which an event with neither a dwell nor
  // a playback processes; levels stay in 0..helpMaxLevel and never decrease. The oracle compares the levels
  // before and after every event, with the levelRaised outputs, and counts the round ends that earn a
  // change: no change is made unless one has not been paid for yet. Also (Req 19.8), an event that reports
  // neither flag applies a change that is waiting, and no other event changes a level.
  it('help_at_most_one_axis_per_event', () => {
    fc.assert(
      fc.property(genHelpSession(), (events) => {
        const problems: string[] = [];
        let state = createHelp(TUNING);
        let open: Open | null = null;
        let earned = 0;
        let changes = 0;
        events.forEach((event, i) => {
          const before = state;
          const result = stepHelp(before, event);
          state = result.state;
          const followed = follow(open, event);
          open = followed.open;
          if (followed.earns) earned += 1;

          const where = `event ${i} (${event.kind})`;
          const dMotor = state.motorLevel - before.motorLevel;
          const dCognitive = state.cognitiveLevel - before.cognitiveLevel;
          const delta = dMotor + dCognitive;
          if (dMotor < 0 || dCognitive < 0) problems.push(`${where}: a level went down`);
          else if (dMotor > 1 || dCognitive > 1 || delta > 1) problems.push(`${where}: motor +${dMotor}, cognitive +${dCognitive}`);
          if (state.motorLevel > MAX || state.cognitiveLevel > MAX) problems.push(`${where}: a level above ${MAX}`);

          if (delta === 1) {
            if (!hasNeither(event)) problems.push(`${where}: a level changed while a dwell or a playback was active`);
            if (changes >= earned) problems.push(`${where}: change number ${changes + 1} with ${earned} round ends to earn one`);
            if (event.kind !== 'roundEnded' && before.pending.length === 0) {
              problems.push(`${where}: a change that is neither in a round end nor a deferred one`);
            }
            changes += 1;
          } else if (hasNeither(event) && before.pending.length > 0) {
            problems.push(`${where}: a waiting change was not applied by an event with neither flag`);
          }

          // The outputs say what the levels say: one levelRaised for a change, naming the axis and its new level, and none otherwise.
          const axis = dMotor === 1 ? 'motor' : 'cognitive';
          const level = axis === 'motor' ? state.motorLevel : state.cognitiveLevel;
          const expected = delta === 1 ? [{ kind: 'levelRaised', axis, level }] : [];
          const said = raisedIn(result.outputs);
          if (JSON.stringify(said) !== JSON.stringify(expected)) {
            problems.push(`${where}: outputs ${JSON.stringify(said)}, expected ${JSON.stringify(expected)}`);
          }
        });
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  // help_completes_in_bounded_steps (Req 19.12): at every point of a round, whatever came before it, a round
  // with n steps of which c are completed is complete after at most n - c more "continue with help" events,
  // and no other event is needed. After each event the property sends n - c of them from there, with every
  // combination of the flags in turn, and checks that the k-th reveals step c + k and that nothing is left to
  // reveal afterwards. c is counted from the events: a completed step or a "continue with help" completes
  // one step, up to n.
  it('help_completes_in_bounded_steps', () => {
    fc.assert(
      fc.property(genHelpSession(), (events) => {
        const problems: string[] = [];
        let state = createHelp(TUNING);
        let open: Open | null = null;
        events.forEach((event, i) => {
          state = stepHelp(state, event).state;
          open = follow(open, event).open;
          if (open === null) return;
          const { steps, done } = open;
          let probe = state;
          for (let k = 0; k < steps - done; k++) {
            const result = stepHelp(probe, { kind: 'continueWithHelp', ...flagsAt(i + k) });
            probe = result.state;
            const revealed = result.outputs.flatMap((o) => (o.kind === 'revealStep' ? [o.step] : []));
            if (revealed.length !== 1 || revealed[0] !== done + k) {
              problems.push(`event ${i}: continue ${k + 1} of ${steps - done} revealed [${revealed.join(', ')}], expected [${done + k}]`);
              return;
            }
          }
          const after = stepHelp(probe, { kind: 'continueWithHelp', ...flagsAt(i) });
          if (after.outputs.some((o) => o.kind === 'revealStep')) {
            problems.push(`event ${i}: a step still to reveal after ${steps - done} continues, with ${done} of ${steps} completed`);
          }
        });
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  // help_at_most_four_changes (Req 19.13): in every session the total number of level changes is at most
  // 2 * helpMaxLevel, which is 4 for the shipped tuning, one at most per level of each axis. Changes that
  // are still waiting when the session ends count too: after the session the property sends events with
  // neither flag, one more than the cap, which apply every change that waits, and then counts. The changes
  // are counted from the levelRaised outputs, they must add up to the levels, and each axis rises one level
  // at a time.
  it('help_at_most_four_changes', () => {
    const cap = 2 * MAX;
    fc.assert(
      fc.property(genHelpSession(), (events) => {
        const problems: string[] = [];
        let state = createHelp(TUNING);
        const raised: Raised[] = [];
        const send = (event: HelpEvent): void => {
          const result = stepHelp(state, event);
          state = result.state;
          raised.push(...raisedIn(result.outputs));
        };
        events.forEach(send);
        for (let k = 0; k <= cap; k++) send({ kind: 'stepCompleted', ...NEITHER });
        if (raised.length > cap) problems.push(`${raised.length} changes, at most ${cap}`);
        const sum = (s: HelpState): number => s.motorLevel + s.cognitiveLevel;
        if (raised.length !== sum(state)) problems.push(`${raised.length} changes, levels ${state.motorLevel} and ${state.cognitiveLevel}`);
        if (state.motorLevel > MAX || state.cognitiveLevel > MAX) problems.push(`a level above ${MAX}`);
        if (state.pending.length > 0) problems.push(`${state.pending.length} changes still waiting after ${cap + 1} events with neither flag`);
        const seen = { motor: 0, cognitive: 0 };
        for (const r of raised) {
          seen[r.axis] += 1;
          if (r.level !== seen[r.axis]) problems.push(`${r.axis} raised to ${r.level} as its change number ${seen[r.axis]}`);
        }
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });
});
