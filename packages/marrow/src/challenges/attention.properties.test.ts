import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { MotionLevel } from '../core';
import {
  attentionWindowsFor,
  blockProblems,
  createAttentionRound,
  currentPresentation,
  orderBlocks,
  stepAttention,
  type AttentionInput,
  type AttentionState,
  type AttentionWindows,
  type Mark,
  type Presentation,
} from './attention';
import { seedRng } from './rng';

// The properties of requirements 5.4, 5.5, 6.4, 6.7, 7.1 and 7.6 (garden-level). Each runs generated rounds
// through stepAttention and judges them from the events alone, as the caller sees them. Problems are
// collected and checked once per run, because an expect call for every step is too slow (as in
// help.properties.test.ts). Timing values come from the attention tuning, never as literals.
const RUNS = 300;
/** How many problems of a failing run are shown. */
const SHOWN = 5;

const FULL = attentionWindowsFor('full');
const MIN = FULL.presentationMinMs;
/** One step of the adversarial driver lasts the minimum presentation time. */
const STEP_MS = MIN;

const genMotion = fc.constantFrom<MotionLevel>('full', 'gentle', 'reduced');
const genSeed = fc.integer({ min: 0, max: 0xffffffff });
const genMark = fc.constantFrom<Mark>('select', 'pass');
/** Marks for one block: at least one select and one let-pass. */
const genMarks = (min: number, max: number): fc.Arbitrary<Mark[]> =>
  fc
    .array(genMark, { minLength: min, maxLength: max })
    .filter((marks) => marks.includes('select') && marks.includes('pass'));

/** Blocks of presentations with unique ids. Block b, presentation i has the id `b<b>-<i>`. */
function toBlocks(markLists: readonly (readonly Mark[])[]): Presentation[][] {
  return markLists.map((marks, b) => marks.map((mark, i) => ({ stimulusId: `b${b}-${i}`, mark })));
}

/** One to three blocks of two to six presentations each. */
const genBlocks = fc.array(genMarks(2, 6), { minLength: 1, maxLength: 3 }).map(toBlocks);

/** What the simulated person does on one step. */
interface Choice {
  readonly input: 'none' | 'dwellCurrent' | 'dwellOther' | 'help';
  readonly dtMs: number;
}
const IDLE: Choice = { input: 'none', dtMs: 0 };
const genChoice: fc.Arbitrary<Choice> = fc.record({
  input: fc.constantFrom<Choice['input']>('none', 'dwellCurrent', 'dwellOther', 'help'),
  dtMs: fc.integer({ min: 0, max: 6000 }),
});
const genScript = fc.array(genChoice, { minLength: 1, maxLength: 400 });

function inputFor(state: AttentionState, choice: Choice): AttentionInput | null {
  switch (choice.input) {
    case 'none':
      return null;
    case 'dwellCurrent': {
      const current = currentPresentation(state);
      return current === null ? null : { kind: 'dwellSelected', stimulusId: current.stimulusId };
    }
    case 'dwellOther':
      return { kind: 'dwellSelected', stimulusId: 'not-on-screen' };
    case 'help':
      return { kind: 'helpRequested' };
  }
}

/** The adversarial driver of requirement 7.6: a select gets no dwell, so its window ends; a let-pass gets a dwell. */
const ADVERSARIAL = (state: AttentionState): Choice => ({
  input: currentPresentation(state)?.mark === 'pass' ? 'dwellCurrent' : 'none',
  dtMs: STEP_MS,
});

interface Outcome {
  /** Completions that came sooner than presentationMinMs after the attempt's start or last mistake. */
  readonly timingProblems: string[];
  /** Steps where completed fell, or a mistake changed it. */
  readonly monotonicProblems: string[];
  readonly reasons: string[];
  readonly startedMarks: { readonly block: number; readonly mark: Mark }[];
  readonly finished: boolean;
  readonly completed: number;
  /** Attempts: each presentation start, plus each mistake that is repeated (a forced one is not repeated). */
  readonly attempts: number;
}

/**
 * Runs one round. `chooser` gives the input and the time of each step. The attempt clock is the time since
 * the presentation started or since its last mistake, and a completion must come after presentationMinMs
 * on that clock.
 */
function play(
  windows: AttentionWindows,
  blocks: readonly (readonly Presentation[])[],
  chooser: (state: AttentionState, step: number) => Choice,
  maxSteps: number,
): Outcome {
  let state = createAttentionRound(windows, blocks);
  const timingProblems: string[] = [];
  const monotonicProblems: string[] = [];
  const reasons: string[] = [];
  const startedMarks: { block: number; mark: Mark }[] = [];
  let starts = 0;
  let repeats = 0;
  let attempt = 0;
  for (let step = 0; step < maxSteps && state.phase !== 'finished'; step++) {
    const choice = chooser(state, step);
    const before = state;
    const result = stepAttention(state, inputFor(state, choice), choice.dtMs);
    const after = result.state;
    const completions = result.events.filter((e) => e.kind === 'presentationCompleted');
    const mistakes = result.events.filter((e) => e.kind === 'mistake');
    for (const e of result.events) {
      if (e.kind === 'presentationStarted') {
        starts++;
        startedMarks.push({ block: e.block, mark: e.mark });
      }
      if (e.kind === 'mistake') {
        reasons.push(e.reason);
        if (!e.forced) repeats++;
      }
    }
    if (after.completed < before.completed) {
      monotonicProblems.push(`step ${step}: completed fell from ${before.completed} to ${after.completed}`);
    }
    if (mistakes.length > 0 && after.completed !== before.completed) {
      monotonicProblems.push(`step ${step}: a mistake changed completed`);
    }
    // The step's time belongs to the attempt that is running when the step ends. A completion ends the
    // attempt with this step's time included. A mistake or a new presentation starts the clock again at 0.
    if (completions.length > 0) {
      const measured = attempt + choice.dtMs;
      if (measured < windows.presentationMinMs) {
        timingProblems.push(`step ${step}: a presentation completed after ${measured} ms, below presentationMinMs`);
      }
      attempt = 0;
    } else if (mistakes.length > 0 || result.events.some((e) => e.kind === 'presentationStarted')) {
      attempt = 0;
    } else if (after.phase === 'presenting') {
      attempt += choice.dtMs;
    }
    state = after;
  }
  return {
    timingProblems,
    monotonicProblems,
    reasons,
    startedMarks,
    finished: state.phase === 'finished',
    completed: state.completed,
    attempts: starts + repeats,
  };
}

describe('attention round properties (attention.properties.test.ts)', () => {
  it('every block has a select and a let-pass presentation', () => {
    fc.assert(
      fc.property(genBlocks, genSeed, genMotion, (blocks, seed, motion) => {
        const ordered = orderBlocks(blocks, seedRng(seed)).blocks;
        const problems: string[] = [];
        ordered.forEach((block, b) => {
          for (const problem of blockProblems(block)) problems.push(`block ${b}: ${problem}`);
        });
        const out = play(attentionWindowsFor(motion), ordered, ADVERSARIAL, 1000);
        ordered.forEach((_block, b) => {
          const marks = new Set(out.startedMarks.filter((s) => s.block === b).map((s) => s.mark));
          if (!marks.has('select') || !marks.has('pass')) problems.push(`block ${b} started without both marks`);
        });
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('each presentation lasts at least 2.5 s', () => {
    fc.assert(
      fc.property(genScript, genBlocks, genMotion, (script, blocks, motion) => {
        const out = play(attentionWindowsFor(motion), blocks, (_s, step) => script[step] ?? IDLE, script.length);
        expect(out.timingProblems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('a mistake never lowers completed', () => {
    fc.assert(
      fc.property(genScript, genBlocks, genMotion, (script, blocks, motion) => {
        const out = play(attentionWindowsFor(motion), blocks, (_s, step) => script[step] ?? IDLE, script.length);
        expect(out.monotonicProblems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('there are exactly two mistake kinds', () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(genScript, genBlocks, genMotion, (script, blocks, motion) => {
        const out = play(attentionWindowsFor(motion), blocks, (_s, step) => script[step] ?? IDLE, script.length);
        for (const reason of out.reasons) seen.add(reason);
        const other = out.reasons.filter((r) => r !== 'windowEnded' && r !== 'dwellOnPass');
        expect(other.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
    expect([...seen].sort()).toEqual(['dwellOnPass', 'windowEnded']);
  });

  it('with a wrong-answer rate of 1.0, every round completes within 18 presentations', () => {
    const SIX_PRESENTATIONS: Mark[][] = [
      ['select', 'select', 'pass'],
      ['select', 'pass', 'pass'],
    ];
    const total = SIX_PRESENTATIONS.reduce((n, block) => n + block.length, 0);
    // At most forceAfter attempts per presentation, so 18 for six presentations with the shipped tuning.
    const bound = FULL.forceAfter * total;
    fc.assert(
      fc.property(genSeed, genMotion, (seed, motion) => {
        const blocks = orderBlocks(toBlocks(SIX_PRESENTATIONS), seedRng(seed)).blocks;
        const out = play(attentionWindowsFor(motion), blocks, ADVERSARIAL, 1000);
        const problems: string[] = [];
        if (!out.finished) problems.push('the round did not finish');
        if (out.completed !== total) problems.push(`completed ${out.completed} of ${total} presentations`);
        if (out.attempts > bound) problems.push(`${out.attempts} attempts, above the bound of ${bound}`);
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('the order depends only on the seed', () => {
    // A fixed block of four presentations, so that different seeds can be compared on the same input.
    const FIXED = toBlocks([['select', 'pass', 'select', 'pass']])[0] ?? [];
    const fixedOrders = new Set<string>();
    fc.assert(
      fc.property(genBlocks, genSeed, (blocks, seed) => {
        const first = orderBlocks(blocks, seedRng(seed));
        const copy = blocks.map((block) => block.map((p) => ({ ...p })));
        const again = orderBlocks(copy, seedRng(seed));
        expect(again.blocks).toEqual(first.blocks);
        const problems: string[] = [];
        blocks.forEach((block, b) => {
          const key = (xs: readonly Presentation[]) => xs.map((p) => `${p.stimulusId}:${p.mark}`).sort().join('|');
          if (key(first.blocks[b] ?? []) !== key(block)) problems.push(`block ${b} is not a permutation of its input`);
        });
        expect(problems.slice(0, SHOWN)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
    fc.assert(
      fc.property(genSeed, (seed) => {
        const ordered = orderBlocks([FIXED], seedRng(seed)).blocks[0] ?? [];
        fixedOrders.add(ordered.map((p) => p.stimulusId).join(','));
      }),
      { numRuns: RUNS },
    );
    // A fixed order would pass the check above, so across the seeds the fixed block must take more than one order.
    expect(fixedOrders.size).toBeGreaterThanOrEqual(2);
  });
});
