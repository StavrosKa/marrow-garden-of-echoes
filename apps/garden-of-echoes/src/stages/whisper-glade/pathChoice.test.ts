// The path choice of Whisper Glade (requirements 8.1 to 8.5). The tests run the real attention round on the shipped
// content, then the path targets. The time step is the presentation minimum of the attention tuning.
import { ATTENTION_TUNING, seedRng } from 'marrow/challenges';
import { describe, expect, it } from 'vitest';
import { journeyTravel, loadSegments } from '../../journeys/journeys';
import segmentsJson from '../../journeys/segments.json';
import { loadWhisperGlade } from './content';
import shipped from './content.json';
import { initialPath, PATH_TARGET_IDS, pathChoice, pathOptionSelected } from './pathChoice';
import { spiritTargetId, startWhisperGlade, stepWhisperGlade, type WhisperState } from './rules';

const content = loadWhisperGlade(shipped);
const STEP_MS = ATTENTION_TUNING.presentationMinMs;
const STEP_CAP = 500;
const segments = loadSegments(segmentsJson);

/** The round at the moment its attention rounds are over and the path is open. */
function openPath(): WhisperState {
  let state = startWhisperGlade(content, seedRng(42), 'full').state;
  for (let step = 0; step < STEP_CAP && state.attention.phase !== 'finished'; step++) {
    const current = state.attention.blocks[state.attention.block]?.[state.attention.index];
    const dwell = state.attention.phase === 'presenting' && current?.mark === 'select';
    const selected = dwell && current !== undefined ? [spiritTargetId(current.stimulusId)] : [];
    state = stepWhisperGlade(state, selected, STEP_MS).state;
  }
  if (state.path.phase !== 'open') throw new Error('the path did not open after the round');
  return state;
}

describe('whisper-glade path choice (requirements 8.1, 8.2)', () => {
  it('8.1: the path targets are on the left for the fireflies and on the right for the candles', () => {
    expect(PATH_TARGET_IDS.fireflies).toBe('path-fireflies');
    expect(PATH_TARGET_IDS.candles).toBe('path-candles');
    expect(content.pathSlots.fireflies.x).toBeLessThan(content.pathSlots.candles.x);
  });

  it('8.1: selecting the fireflies completes the stage with the fireflies dressing', () => {
    const step = stepWhisperGlade(openPath(), [PATH_TARGET_IDS.fireflies], STEP_MS);
    expect(step.completed).toBe(true);
    expect(step.state.path).toEqual({ phase: 'chosen', dressing: 'fireflies' });
  });

  it('8.1: selecting the candles completes the stage with the candles dressing', () => {
    const step = stepWhisperGlade(openPath(), [PATH_TARGET_IDS.candles], STEP_MS);
    expect(step.completed).toBe(true);
    expect(step.state.path).toEqual({ phase: 'chosen', dressing: 'candles' });
  });

  it('8.2: the targets name the options, not a wrist, and either id works wherever it is in the list of selections', () => {
    for (const id of Object.values(PATH_TARGET_IDS)) expect(id).not.toMatch(/left|right|hand|wrist/);
    expect(pathOptionSelected(['some-other', PATH_TARGET_IDS.candles])).toBe('candles');
    expect(pathOptionSelected([PATH_TARGET_IDS.fireflies, 'some-other'])).toBe('fireflies');
    expect(stepWhisperGlade(openPath(), ['some-other', PATH_TARGET_IDS.candles], STEP_MS).completed).toBe(true);
  });

  it('8.1: a path target selected before the round has finished names no option and completes nothing', () => {
    const during = startWhisperGlade(content, seedRng(42), 'full').state;
    const step = stepWhisperGlade(during, [PATH_TARGET_IDS.candles], STEP_MS);
    expect(step.completed).toBe(false);
    expect(step.state.path.phase).toBe('waiting');
    expect(step.state.path.dressing).toBeNull();
  });

  it('8.1: after the choice, a second selection changes nothing and completes nothing again', () => {
    const chosen = stepWhisperGlade(openPath(), [PATH_TARGET_IDS.fireflies], STEP_MS).state;
    const again = stepWhisperGlade(chosen, [PATH_TARGET_IDS.candles], STEP_MS);
    expect(again.completed).toBe(false);
    expect(again.state.path).toEqual({ phase: 'chosen', dressing: 'fireflies' });
  });

  it('8.1: a spirit selected while the path is open does not complete the stage', () => {
    const step = stepWhisperGlade(openPath(), [spiritTargetId('blueDrop')], STEP_MS);
    expect(step.completed).toBe(false);
    expect(step.state.path.phase).toBe('open');
  });

  it('8.1: a choice offered before the path is open is ignored by pathChoice', () => {
    expect(pathChoice(initialPath(), 'candles')).toEqual(initialPath());
  });
});

describe('whisper-glade path choice dressing (requirements 8.3, 8.4)', () => {
  it('8.3: journey B is the same segment for both options, and the travel is built from the same segment', () => {
    const before = journeyTravel(segments, 'journeyB');
    const fireflies = stepWhisperGlade(openPath(), [PATH_TARGET_IDS.fireflies], STEP_MS).state;
    const candles = stepWhisperGlade(openPath(), [PATH_TARGET_IDS.candles], STEP_MS).state;
    expect(journeyTravel(segments, 'journeyB')).toEqual(before);
    expect(Object.keys(fireflies).sort()).toEqual(Object.keys(candles).sort());
  });

  it('8.4: the choice changes only the dressing: the rest of the state is the same for both options', () => {
    const fireflies = stepWhisperGlade(openPath(), [PATH_TARGET_IDS.fireflies], STEP_MS).state;
    const candles = stepWhisperGlade(openPath(), [PATH_TARGET_IDS.candles], STEP_MS).state;
    expect({ ...fireflies, path: { ...fireflies.path, dressing: null } }).toEqual({
      ...candles,
      path: { ...candles.path, dressing: null },
    });
  });

  it('8.4: the dressing differs between the two options', () => {
    const fireflies = stepWhisperGlade(openPath(), [PATH_TARGET_IDS.fireflies], STEP_MS).state;
    const candles = stepWhisperGlade(openPath(), [PATH_TARGET_IDS.candles], STEP_MS).state;
    expect(fireflies.path.dressing).not.toBe(candles.path.dressing);
  });
});
