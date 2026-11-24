import { describe, expect, it } from 'vitest';
import { seedRng } from './rng';
import {
  attentionWindowsFor,
  blockProblems,
  createAttentionRound,
  currentPresentation,
  orderBlocks,
  stepAttention,
  type AttentionEvent,
  type AttentionInput,
  type AttentionState,
  type Presentation,
} from './attention';

// The timing values come from the attention tuning, through attentionWindowsFor, and never as literals.
const FULL = attentionWindowsFor('full');
const MIN = FULL.presentationMinMs;
const DEMO = FULL.demonstrationMs;
const LET = FULL.letPassMs;
const SELECT_WINDOW = FULL.selectMs;

const SEL: Presentation = { stimulusId: 'drop-1', mark: 'select' };
const PASS: Presentation = { stimulusId: 'leaf-1', mark: 'pass' };
const dwell = (stimulusId: string): AttentionInput => ({ kind: 'dwellSelected', stimulusId });
const HELP: AttentionInput = { kind: 'helpRequested' };

/** A round, stepped once so the first presentation is announced. */
function started(blocks: readonly (readonly Presentation[])[]): AttentionState {
  return stepAttention(createAttentionRound(FULL, blocks), null, 0).state;
}

/** One step, returning the state and the events of the step. */
function step(state: AttentionState, input: AttentionInput | null, dtMs: number): { state: AttentionState; events: readonly AttentionEvent[] } {
  return stepAttention(state, input, dtMs);
}

const kinds = (events: readonly AttentionEvent[]): string[] => events.map((e) => e.kind);

describe('attention round (attention.ts)', () => {
  it('reduced motion uses the Gentle windows', () => {
    expect(attentionWindowsFor('reduced')).toEqual(attentionWindowsFor('gentle'));
  });

  it('full and gentle motion use their own windows', () => {
    const gentle = attentionWindowsFor('gentle');
    expect(FULL.selectMs).toBeLessThan(gentle.selectMs);
    expect(FULL.letPassMs).toBeLessThan(gentle.letPassMs);
    expect(FULL.presentationMinMs).toBe(gentle.presentationMinMs);
  });

  it('the demonstration does not count as a presentation', () => {
    let s = started([[SEL, PASS], [SEL, PASS]]);
    s = step(s, dwell(SEL.stimulusId), MIN).state;
    const finished = step(s, null, LET);
    expect(kinds(finished.events)).toEqual(['presentationCompleted', 'demonstrationStarted']);
    expect(finished.state.phase).toBe('demonstration');
    expect(finished.state.completed).toBe(2);
    const during = step(finished.state, null, DEMO - 1);
    expect(during.events).toEqual([]);
    expect(during.state.completed).toBe(2);
    const next = step(during.state, null, 1);
    expect(kinds(next.events)).toEqual(['presentationStarted']);
    expect(next.state.completed).toBe(2);
  });

  it('a select dwell before presentationMinMs is kept and completes at the minimum', () => {
    const half = Math.floor(MIN / 2);
    const early = step(started([[SEL, PASS]]), dwell(SEL.stimulusId), half);
    expect(early.events).toEqual([]);
    expect(early.state.selectedEarly).toBe(true);
    const still = step(early.state, null, MIN - half - 1);
    expect(still.events).toEqual([]);
    const done = step(still.state, null, 1);
    expect(done.events).toEqual([
      { kind: 'presentationCompleted', stimulusId: SEL.stimulusId, byHelp: false },
      { kind: 'presentationStarted', block: 0, index: 1, stimulusId: PASS.stimulusId, mark: 'pass' },
    ]);
  });

  it('a select dwell after the minimum completes the presentation', () => {
    const r = step(started([[SEL, PASS]]), dwell(SEL.stimulusId), MIN);
    expect(r.events[0]).toEqual({ kind: 'presentationCompleted', stimulusId: SEL.stimulusId, byHelp: false });
  });

  it('a select window that ends without a dwell is a windowEnded mistake', () => {
    const r = step(started([[SEL, PASS]]), null, SELECT_WINDOW);
    expect(r.events).toEqual([
      { kind: 'mistake', stimulusId: SEL.stimulusId, count: 1, reason: 'windowEnded', offerHelp: false, forced: false },
    ]);
    expect(r.state.completed).toBe(0);
  });

  it('a dwell on a let-pass presentation inside its window is a dwellOnPass mistake', () => {
    const r = step(started([[PASS, SEL]]), dwell(PASS.stimulusId), LET - 1);
    expect(r.events).toEqual([
      { kind: 'mistake', stimulusId: PASS.stimulusId, count: 1, reason: 'dwellOnPass', offerHelp: false, forced: false },
    ]);
  });

  it('a let-pass presentation completes at its window end with no mistake', () => {
    const r = step(started([[PASS, SEL]]), null, LET);
    expect(r.events[0]).toEqual({ kind: 'presentationCompleted', stimulusId: PASS.stimulusId, byHelp: false });
    expect(r.events.some((e) => e.kind === 'mistake')).toBe(false);
  });

  it('a dwell exactly at a let-pass window end is ignored', () => {
    const r = step(started([[PASS, SEL]]), dwell(PASS.stimulusId), LET);
    expect(r.events[0]).toEqual({ kind: 'presentationCompleted', stimulusId: PASS.stimulusId, byHelp: false });
    expect(r.events.some((e) => e.kind === 'mistake')).toBe(false);
  });

  it('a mistake repeats the presentation with the hint and keeps completed', () => {
    const r = step(started([[PASS, SEL]]), dwell(PASS.stimulusId), 1);
    expect(r.state.hint).toBe(true);
    expect(r.state.completed).toBe(0);
    expect(r.state.elapsedMs).toBe(0);
    expect(currentPresentation(r.state)).toEqual(PASS);
  });

  it('a repeat after a mistake emits no presentationStarted', () => {
    const announced = stepAttention(createAttentionRound(FULL, [[PASS, SEL]]), null, 0);
    expect(announced.events).toEqual([
      { kind: 'presentationStarted', block: 0, index: 0, stimulusId: PASS.stimulusId, mark: 'pass' },
    ]);
    const repeat = step(announced.state, dwell(PASS.stimulusId), 1);
    expect(repeat.events.map((e) => e.kind)).toEqual(['mistake']);
  });

  it('the second mistake on one presentation offers help', () => {
    const first = step(started([[PASS, SEL]]), dwell(PASS.stimulusId), 1);
    const second = step(first.state, dwell(PASS.stimulusId), 1);
    expect(first.events[0]).toMatchObject({ count: 1, offerHelp: false, forced: false });
    expect(second.events[0]).toMatchObject({ count: 2, offerHelp: true, forced: false });
  });

  it('a forced completion waits for presentationMinMs', () => {
    let s = started([[PASS, SEL]]);
    for (let i = 0; i < FULL.forceAfter; i++) s = step(s, dwell(PASS.stimulusId), 1).state;
    expect(s.pending).toBe('forced');
    const wait = step(s, null, MIN - 1);
    expect(wait.events).toEqual([]);
    const done = step(wait.state, null, 1);
    expect(done.events[0]).toEqual({ kind: 'presentationCompleted', stimulusId: PASS.stimulusId, byHelp: true });
  });

  it('inputs during the wait add no mistakes', () => {
    let s = started([[PASS, SEL]]);
    for (let i = 0; i < FULL.forceAfter; i++) s = step(s, dwell(PASS.stimulusId), 1).state;
    const mistakesBefore = s.mistakes;
    const during = step(s, dwell(PASS.stimulusId), 1);
    const helpDuring = step(during.state, HELP, 1);
    expect(during.events).toEqual([]);
    expect(helpDuring.events).toEqual([]);
    expect(helpDuring.state.mistakes).toBe(mistakesBefore);
  });

  it('the third mistake completes the presentation with help and the round continues', () => {
    let s = started([[PASS, SEL]]);
    let last: readonly AttentionEvent[] = [];
    for (let i = 0; i < FULL.forceAfter; i++) {
      const r = step(s, dwell(PASS.stimulusId), 1);
      s = r.state;
      last = r.events;
    }
    expect(last[0]).toEqual({
      kind: 'mistake',
      stimulusId: PASS.stimulusId,
      count: FULL.forceAfter,
      reason: 'dwellOnPass',
      offerHelp: true,
      forced: true,
    });
    const done = step(s, null, MIN);
    expect(done.events).toEqual([
      { kind: 'presentationCompleted', stimulusId: PASS.stimulusId, byHelp: true },
      { kind: 'presentationStarted', block: 0, index: 1, stimulusId: SEL.stimulusId, mark: 'select' },
    ]);
    expect(done.state.completed).toBe(1);
  });

  it('helpRequested before presentationMinMs completes at the minimum', () => {
    const half = Math.floor(MIN / 2);
    const asked = step(started([[SEL, PASS]]), HELP, half);
    expect(asked.events).toEqual([]);
    expect(asked.state.pending).toBe('help');
    const done = step(asked.state, null, MIN - half);
    expect(done.events[0]).toEqual({ kind: 'presentationCompleted', stimulusId: SEL.stimulusId, byHelp: true });
  });

  it('helpRequested completes the current presentation with byHelp', () => {
    const late = step(started([[SEL, PASS]]), null, MIN);
    expect(late.events).toEqual([]);
    const r = step(late.state, HELP, 0);
    expect(r.events[0]).toEqual({ kind: 'presentationCompleted', stimulusId: SEL.stimulusId, byHelp: true });
  });

  it('helpRequested during a demonstration ends it without a completion', () => {
    let s = started([[SEL, PASS], [SEL, PASS]]);
    s = step(s, dwell(SEL.stimulusId), MIN).state;
    s = step(s, null, LET).state;
    expect(s.phase).toBe('demonstration');
    const before = s.completed;
    const r = step(s, HELP, 0);
    expect(kinds(r.events)).toEqual(['presentationStarted']);
    expect(r.state.completed).toBe(before);
    expect(r.state.phase).toBe('presenting');
  });

  it('a step longer than a window ends one presentation and drops the leftover time', () => {
    const r = step(started([[PASS, SEL]]), null, LET + SELECT_WINDOW);
    expect(kinds(r.events)).toEqual(['presentationCompleted', 'presentationStarted']);
    expect(r.state.elapsedMs).toBe(0);
    expect(r.state.completed).toBe(1);

    const m = step(started([[SEL, PASS]]), null, SELECT_WINDOW * 2);
    expect(kinds(m.events)).toEqual(['mistake']);
    expect(m.state.mistakes).toBe(1);
    expect(m.state.elapsedMs).toBe(0);
  });

  it('a dwell for another stimulus changes nothing', () => {
    const s = started([[SEL, PASS]]);
    const r = step(s, dwell('not-on-screen'), 1);
    expect(r.events).toEqual([]);
    expect(r.state).toEqual(step(s, null, 1).state);
  });

  it('stepAttention with null input and dt 0 changes nothing', () => {
    const s = started([[SEL, PASS]]);
    const r = step(s, null, 0);
    expect(r.state).toEqual(s);
    expect(r.events).toEqual([]);
  });

  it('blockProblems reports a block with no select or no pass', () => {
    expect(blockProblems([PASS, PASS]).join('\n')).toContain('select');
    expect(blockProblems([SEL, SEL]).join('\n')).toContain('let-pass');
    expect(blockProblems([SEL, PASS])).toEqual([]);
  });

  it('orderBlocks keeps each block\'s marks and is the same for the same seed', () => {
    const blocks = [
      [SEL, PASS, { stimulusId: 'drop-2', mark: 'pass' as const }],
      [PASS, { stimulusId: 'drop-3', mark: 'select' as const }, SEL],
    ];
    const first = orderBlocks(blocks, seedRng(5));
    const again = orderBlocks(blocks, seedRng(5));
    expect(first.blocks).toEqual(again.blocks);
    blocks.forEach((block, i) => {
      const sortIds = (xs: readonly Presentation[]) => [...xs].map((p) => p.stimulusId).sort();
      expect(sortIds(first.blocks[i] ?? [])).toEqual(sortIds(block));
    });
  });

  it('the round emits roundFinished after its last presentation', () => {
    let s = started([[SEL, PASS]]);
    s = step(s, dwell(SEL.stimulusId), MIN).state;
    const last = step(s, null, LET);
    expect(kinds(last.events)).toEqual(['presentationCompleted', 'roundFinished']);
    expect(last.state.phase).toBe('finished');
    expect(currentPresentation(last.state)).toBeNull();
  });
});
