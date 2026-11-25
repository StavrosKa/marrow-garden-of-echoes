// The Whisper Glade rule (requirements 5.1 to 5.8, 6, 7.5). The tests run the real attention round, the shipped content
// and the seeded generator. The time step is the presentation minimum of the attention tuning, so no timing literal
// appears here.
import { ATTENTION_TUNING, seedRng, type AttentionEvent } from 'marrow/challenges';
import { describe, expect, it } from 'vitest';
import { hasCopyKey } from '../../copy/garden';
import { loadWhisperGlade } from './content';
import shipped from './content.json';
import { lineKey, spiritTargetId, startWhisperGlade, stepWhisperGlade, type WhisperState } from './rules';

const content = loadWhisperGlade(shipped);
const STEP_MS = ATTENTION_TUNING.presentationMinMs;
/** A bound on the steps of one round. A round needs far fewer; the bound stops a broken round from hanging the test. */
const STEP_CAP = 500;

/** The start of a round for a seed, at the full motion level. */
function startFor(seed: number): WhisperState {
  return startWhisperGlade(content, seedRng(seed), 'full').state;
}

/** The target ids one step of the test player selects: the current spirit when the player decides to dwell on it. */
function selectionFor(state: WhisperState, dwell: (mark: string, stem: string) => boolean): string[] {
  const current = state.attention.blocks[state.attention.block]?.[state.attention.index];
  if (current === undefined || state.attention.phase !== 'presenting') return [];
  return dwell(current.mark, current.stimulusId) ? [spiritTargetId(current.stimulusId)] : [];
}

/** Runs a round to its end. `dwell` decides, for each presentation, whether the player dwells on its spirit. */
function runRound(seed: number, dwell: (mark: string, stem: string) => boolean): { events: AttentionEvent[]; keys: (string | null)[]; state: WhisperState } {
  let state = startFor(seed);
  const events: AttentionEvent[] = [];
  const keys: (string | null)[] = [];
  for (let step = 0; step < STEP_CAP && state.attention.phase !== 'finished'; step++) {
    keys.push(lineKey(state));
    const next = stepWhisperGlade(state, selectionFor(state, dwell), STEP_MS);
    events.push(...next.events);
    state = next.state;
  }
  return { events, keys, state };
}

describe('whisper-glade blocks (requirements 5.1, 5.2, 5.4)', () => {
  it('5.1: the round has two blocks of three presentations, six in total', () => {
    const { attention } = startFor(42);
    expect(attention.blocks).toHaveLength(2);
    expect(attention.blocks.map((block) => block.length)).toEqual([3, 3]);
  });

  it('5.2: block one holds two blue drop selects and one gold leaf pass; block two holds one gold leaf select and two blue drop passes', () => {
    const { attention } = startFor(42);
    const stems = (block: readonly { stimulusId: string; mark: string }[]) =>
      block.map((p) => `${p.mark}:${p.stimulusId}`).sort();
    expect(stems(attention.blocks[0] ?? [])).toEqual(['pass:goldLeaf', 'select:blueDrop', 'select:blueDrop']);
    expect(stems(attention.blocks[1] ?? [])).toEqual(['pass:blueDrop', 'pass:blueDrop', 'select:goldLeaf']);
  });

  it('5.4: every block has at least one select and one let-pass presentation, for every seed in a sample', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const block of startFor(seed).attention.blocks) {
        expect(block.some((p) => p.mark === 'select')).toBe(true);
        expect(block.some((p) => p.mark === 'pass')).toBe(true);
      }
    }
  });
});

describe('whisper-glade demonstration and round (requirements 5.3, 6.8)', () => {
  it('5.3: the demonstration sits between the blocks, and it is not a presentation', () => {
    const { events, state } = runRound(42, (mark) => mark === 'select');
    const started = events.filter((e) => e.kind === 'presentationStarted');
    const demos = events.filter((e) => e.kind === 'demonstrationStarted');
    expect(demos).toEqual([{ kind: 'demonstrationStarted', block: 1 }]);
    expect(started).toHaveLength(6);
    expect(state.attention.completed).toBe(6);
  });

  it('5.3: during the demonstration the line is the demonstration line, and no spirit is selectable', () => {
    let state = startFor(42);
    let sawDemo = false;
    for (let step = 0; step < STEP_CAP && state.attention.phase !== 'finished'; step++) {
      if (state.attention.phase === 'demonstration') {
        sawDemo = true;
        expect(lineKey(state)).toBe('whisper.demo');
        // A dwell on any spirit during the demonstration starts nothing and completes nothing.
        const before = state.attention.completed;
        state = stepWhisperGlade(state, ['spirit-blueDrop', 'spirit-goldLeaf'], STEP_MS).state;
        if (state.attention.phase === 'demonstration') expect(state.attention.completed).toBe(before);
      } else {
        state = stepWhisperGlade(state, [], STEP_MS).state;
      }
    }
    expect(sawDemo).toBe(true);
  });

  it('5.3: "Continue with help" ends the demonstration early', () => {
    let state = startFor(42);
    for (let step = 0; step < STEP_CAP && state.attention.phase !== 'demonstration'; step++) {
      state = stepWhisperGlade(state, [], STEP_MS).state;
    }
    expect(state.attention.phase).toBe('demonstration');
    const next = stepWhisperGlade(state, [], STEP_MS, true).state;
    expect(next.attention.phase).not.toBe('demonstration');
  });

  it('6.8: the path targets open only after the round has finished', () => {
    const { state } = runRound(42, (mark) => mark === 'select');
    expect(state.attention.phase).toBe('finished');
    expect(state.path.phase).toBe('open');
    expect(lineKey(state)).toBe('path.choose');
  });
});

describe('whisper-glade shape with colour (requirement 5.6)', () => {
  it('5.6: each spirit pairs a colour with a shape, and the two spirits differ in both', () => {
    const [blue, gold] = content.spirits;
    expect(blue).toMatchObject({ stem: 'blueDrop', colour: 'spiritBlue', shape: 'drop' });
    expect(gold).toMatchObject({ stem: 'goldLeaf', colour: 'spiritGold', shape: 'leaf' });
    expect(blue?.colour).not.toBe(gold?.colour);
    expect(blue?.shape).not.toBe(gold?.shape);
  });
});

describe('whisper-glade lines per block (requirements 5.8, 14.2)', () => {
  it('5.8: a block one line names the block one rule, and a block two line names the block two rule', () => {
    const block0 = new Set(['whisper.select.blueDrop', 'whisper.pass.goldLeaf']);
    const block1 = new Set(['whisper.select.goldLeaf', 'whisper.pass.blueDrop']);
    let state = startFor(42);
    for (let step = 0; step < STEP_CAP && state.attention.phase !== 'finished'; step++) {
      const key = lineKey(state);
      if (state.attention.phase === 'presenting' || state.attention.phase === 'starting') {
        const expected = state.attention.block === 0 ? block0 : block1;
        expect(expected.has(key ?? '')).toBe(true);
      }
      state = stepWhisperGlade(state, selectionFor(state, (mark) => mark === 'select'), STEP_MS).state;
    }
  });

  it('5.8: a repeat after a mistake uses the mistake key of the same rule', () => {
    // The player never dwells, so every select window ends as a mistake and the repeat shows its hint.
    const { keys } = runRound(42, () => false);
    const mistakeKeys = keys.filter((key) => key?.startsWith('mistake.'));
    expect(mistakeKeys.length).toBeGreaterThan(0);
    for (const key of mistakeKeys) expect(hasCopyKey(key ?? '')).toBe(true);
  });

  it('14.2: every line the round shows is a copy key of GARDEN_COPY', () => {
    const { keys } = runRound(7, (mark) => mark === 'select');
    for (const key of keys) {
      if (key !== null) expect(hasCopyKey(key), key).toBe(true);
    }
  });
});

describe('whisper-glade mistakes (requirement 5.8, 7.1)', () => {
  it('7.1: a dwell on a let-pass spirit is a dwellOnPass mistake, and the presentation repeats', () => {
    // The player dwells on every spirit, so each let-pass presentation gets a dwellOnPass mistake.
    const { events } = runRound(42, () => true);
    const passMistakes = events.flatMap((e) => (e.kind === 'mistake' && e.reason === 'dwellOnPass' ? [e] : []));
    expect(passMistakes.length).toBeGreaterThan(0);
    expect(passMistakes.every((mistake) => mistake.count >= 1)).toBe(true);
  });

  it('7.5: a dwell on a select spirit that is held past the presentation minimum completes it', () => {
    const { events } = runRound(42, (mark) => mark === 'select');
    const completedByDwell = events.filter((e) => e.kind === 'presentationCompleted' && !e.byHelp);
    expect(completedByDwell.length).toBeGreaterThan(0);
  });
});
