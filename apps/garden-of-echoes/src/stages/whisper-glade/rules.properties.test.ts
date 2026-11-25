// Properties of the Whisper Glade rule (requirements 5.2, 5.4, 5.5, 5.8). Each run plays a seeded round with a seeded
// player, who sometimes dwells on the let-pass spirit (a mistake) and sometimes misses the select spirit (a mistake).
// Each presentation's line must use the keys of its block's rule, and across the runs every one of the eight per-rule
// keys must appear. The run count is 300, and the test asserts minimum counts of the interesting cases, so it cannot
// pass with no mistakes or no second block.
import fc from 'fast-check';
import { ATTENTION_TUNING, currentPresentation, nextUnit, seedRng } from 'marrow/challenges';
import { describe, expect, it } from 'vitest';
import { hasCopyKey } from '../../copy/garden';
import { loadWhisperGlade, spiritCopyKeys } from './content';
import shipped from './content.json';
import { lineKey, spiritTargetId, startWhisperGlade, stepWhisperGlade, type WhisperState } from './rules';

const RUNS = 300;
/** How many problems of a failing run are shown. */
const SHOWN = 5;
/** A bound on the steps of one round. */
const STEP_CAP = 500;
const STEP_MS = ATTENTION_TUNING.presentationMinMs;
/** The player's chance of a dwell on the select spirit, and on the let-pass spirit (a mistake). */
const SELECT_DWELL = 0.6;
const PASS_DWELL = 0.2;
/** Minimum counts of the interesting cases over the runs (design 6: a property asserts its cases are not vacuous). */
const MIN_RUNS_WITH_MISTAKE = 100;
const MIN_RUNS_WITH_PASS_MISTAKE = 50;

const content = loadWhisperGlade(shipped);
const genSeed = fc.integer({ min: 0, max: 0xffffffff });

/** The eight per-rule keys of the two spirits, which every run must use. */
const EIGHT_KEYS = content.spirits.flatMap((spirit) => spiritCopyKeys(spirit.stem));

interface RunReport {
  readonly problems: string[];
  readonly keys: string[];
  readonly sawMistake: boolean;
  readonly sawPassMistake: boolean;
  readonly sawDemonstration: boolean;
  readonly finished: boolean;
}

/** Plays one seeded round and reports each line against the rule of its block. */
function playRun(seed: number): RunReport {
  let state: WhisperState = startWhisperGlade(content, seedRng(seed), 'full').state;
  let decide = seedRng(seed + 1);
  const problems: string[] = [];
  const keys: string[] = [];
  let sawMistake = false;
  let sawPassMistake = false;
  let sawDemonstration = false;
  for (let step = 0; step < STEP_CAP && state.attention.phase !== 'finished'; step++) {
    const presentation = currentPresentation(state.attention);
    const key = lineKey(state);
    let dwell = false;
    if (state.attention.phase === 'demonstration') {
      sawDemonstration = true;
      if (key !== 'whisper.demo') problems.push(`step ${step}: the demonstration line is ${key}`);
    } else if (presentation !== null) {
      const rule = state.rules[state.attention.block];
      const stem = presentation.mark === 'select' ? rule?.select : rule?.pass;
      if (rule === undefined || presentation.stimulusId !== stem) {
        problems.push(`step ${step}: presentation ${presentation.stimulusId} is not the spirit of its block's rule`);
      }
      const prefix = state.attention.hint ? 'mistake' : 'whisper';
      const expected = `${prefix}.${presentation.mark}.${stem ?? ''}`;
      if (key !== expected) problems.push(`step ${step}: the line is ${key}, expected ${expected}`);
      if (key !== null) keys.push(key);
      if (state.attention.hint) sawMistake = true;
      // The draw decides whether this step dwells on the presented spirit.
      const draw = nextUnit(decide);
      decide = draw.rng;
      const chance = presentation.mark === 'select' ? SELECT_DWELL : PASS_DWELL;
      dwell = draw.value < chance;
      if (dwell && presentation.mark === 'pass') sawPassMistake = true;
    }
    const selected = dwell && presentation !== null ? [spiritTargetId(presentation.stimulusId)] : [];
    state = stepWhisperGlade(state, selected, STEP_MS).state;
  }
  if (state.attention.phase !== 'finished') problems.push('the round did not finish');
  if (state.attention.completed !== 6) problems.push(`the round completed ${state.attention.completed} presentations, not 6`);
  return {
    problems,
    keys,
    sawMistake,
    sawPassMistake,
    sawDemonstration,
    finished: state.attention.phase === 'finished',
  };
}

describe('whisper-glade rule properties (requirements 5.2, 5.5, 5.8)', () => {
  it('5.8: over seeded rounds, each presentation uses the keys of its block rule, and every per-rule key is used', () => {
    const used = new Set<string>();
    let withMistake = 0;
    let withPassMistake = 0;
    let withDemonstration = 0;
    fc.assert(
      fc.property(genSeed, (seed) => {
        const report = playRun(seed);
        expect(report.problems.slice(0, SHOWN)).toEqual([]);
        for (const key of report.keys) used.add(key);
        if (report.sawMistake) withMistake++;
        if (report.sawPassMistake) withPassMistake++;
        if (report.sawDemonstration) withDemonstration++;
        return report.finished;
      }),
      { numRuns: RUNS, seed: 42 },
    );
    expect(withMistake).toBeGreaterThanOrEqual(MIN_RUNS_WITH_MISTAKE);
    expect(withPassMistake).toBeGreaterThanOrEqual(MIN_RUNS_WITH_PASS_MISTAKE);
    expect(withDemonstration).toBeGreaterThanOrEqual(RUNS);
    for (const key of EIGHT_KEYS) {
      expect(hasCopyKey(key), `${key} exists in GARDEN_COPY`).toBe(true);
      expect(used.has(key), `${key} is used by a line`).toBe(true);
    }
  });

  it('5.5: the order of each block depends only on the seed', () => {
    fc.assert(
      fc.property(genSeed, (seed) => {
        const a = startWhisperGlade(content, seedRng(seed), 'full').state.attention.blocks;
        const b = startWhisperGlade(content, seedRng(seed), 'full').state.attention.blocks;
        expect(a).toEqual(b);
      }),
      { numRuns: RUNS, seed: 43 },
    );
  });
});
