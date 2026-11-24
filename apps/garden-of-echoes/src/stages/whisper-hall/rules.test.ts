// The placeholder rule of Whisper Hall (design 6; Req 9.1). The stage has one target. Selecting it
// completes the stage, and nothing else does.
import { describe, expect, it } from 'vitest';
import { loadWhisperHall } from './content';
import shipped from './content.json';
import { createPlaceholder, stepPlaceholder, targetIdOf } from './rules';

const content = loadWhisperHall(shipped);

describe('whisper-hall placeholder rule (rules.test.ts)', () => {
  it('the shipped target completes the stage when it is selected (Req 9.1)', () => {
    const state = createPlaceholder(content);
    const r = stepPlaceholder(state, [targetIdOf(content)]);
    expect(r.completed).toBe(true);
    expect(r.state.done).toBe(true);
  });

  it('selecting nothing, or another id, does not complete the stage (Req 9.1)', () => {
    const state = createPlaceholder(content);
    expect(stepPlaceholder(state, []).completed).toBe(false);
    expect(stepPlaceholder(state, ['some-other-target']).completed).toBe(false);
    expect(stepPlaceholder(state, []).state).toEqual(state);
  });

  it('a completed stage stays completed on later steps (Req 9.1)', () => {
    const done = stepPlaceholder(createPlaceholder(content), [targetIdOf(content)]).state;
    const later = stepPlaceholder(done, []);
    expect(later.completed).toBe(true);
    expect(later.state).toEqual(done);
  });

  it('the state holds the one target of the content (Req 9.1)', () => {
    expect(createPlaceholder(content).targetId).toBe(targetIdOf(content));
    expect(content.target.slots).toHaveLength(1);
  });
});