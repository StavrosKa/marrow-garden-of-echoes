// The Lantern Glade rule (requirements 4.1, 4.2, 4.4, 4.5). The rule runs on the slots of the shipped content, placed
// as placeRound gives them, and every lantern is chosen by its target id.
import { describe, expect, it } from 'vitest';
import { loadLanternGlade } from './content';
import shipped from './content.json';
import { activeLanternIds, createLanternGlade, lineKey, stepLanternGlade, targetIdOf, type LanternState } from './rules';
import { placedFor } from './testPlaced';

const content = loadLanternGlade(shipped);

function fresh(): LanternState {
  return createLanternGlade(content, placedFor(content), 'full');
}

/** Selects the lantern with this index in one step, with no time. */
function select(state: LanternState, index: number) {
  return stepLanternGlade(state, [targetIdOf(index)], 0);
}

describe('lantern-glade rule', () => {
  it('4.1: the first lantern is the active one, and its line is the tutorial line', () => {
    const state = fresh();
    expect(activeLanternIds(state)).toEqual(['lantern-0']);
    expect(lineKey(state)).toBe('lantern.first');
  });

  it('4.1: after a selection the next lantern is active, and its line is the next line', () => {
    const state = select(fresh(), 0).state;
    expect(activeLanternIds(state)).toEqual(['lantern-1']);
    expect(lineKey(state)).toBe('lantern.next');
  });

  it('4.1: the lanterns are active one after another, and no other lantern is', () => {
    let state = fresh();
    for (let i = 0; i < content.lanterns; i++) {
      expect(activeLanternIds(state)).toEqual([targetIdOf(i)]);
      state = select(state, i).state;
    }
  });

  it('4.2: each selection plays the note of its lantern, in order, and reveals one colour patch', () => {
    let state = fresh();
    for (let i = 0; i < content.lanterns; i++) {
      const step = select(state, i);
      expect(step.note).toBe(content.notes[i]);
      expect(step.patch).toBe(i);
      state = step.state;
    }
  });

  it('4.2: a selection of a lantern that is not the active one does nothing', () => {
    const state = fresh();
    const step = stepLanternGlade(state, [targetIdOf(2)], 0);
    expect(step.note).toBeNull();
    expect(step.patch).toBeNull();
    expect(step.completed).toBe(false);
    expect(step.state.next).toBe(0);
  });

  it('4.2: a step with no selection changes no lantern', () => {
    const state = fresh();
    const step = stepLanternGlade(state, [], 100);
    expect(step.note).toBeNull();
    expect(step.state.next).toBe(state.next);
    expect(step.state.completed).toBe(false);
  });

  it('4.4: the fourth selection lights the path and completes the stage once', () => {
    let state = fresh();
    const completed: boolean[] = [];
    for (let i = 0; i < content.lanterns; i++) {
      const step = select(state, i);
      completed.push(step.completed);
      state = step.state;
    }
    expect(completed).toEqual([false, false, false, true]);
    expect(state.completed).toBe(true);
  });

  it('4.4: a selection after the path is lit completes nothing again', () => {
    let state = fresh();
    for (let i = 0; i < content.lanterns; i++) state = select(state, i).state;
    const again = stepLanternGlade(state, ['lantern-0', 'lantern-1', 'lantern-2', 'lantern-3'], 0);
    expect(again.completed).toBe(false);
    expect(again.note).toBeNull();
    expect(again.state.completed).toBe(true);
  });

  it('4.4: once the path is lit no lantern is active and there is no line', () => {
    let state = fresh();
    for (let i = 0; i < content.lanterns; i++) state = select(state, i).state;
    expect(activeLanternIds(state)).toEqual([]);
    expect(lineKey(state)).toBeNull();
  });

  it('4.5: each lantern is placed at the slot that placeRound gives it', () => {
    const state = fresh();
    for (let i = 0; i < content.lanterns; i++) {
      const slot = content.slots[i];
      expect(slot).toBeDefined();
      expect(state.points[i]).toMatchObject({ x: slot?.x, y: slot?.y });
    }
  });

  it('4.5: a placed round with fewer slots than lanterns is refused', () => {
    const placed = placedFor(content);
    expect(() => createLanternGlade(content, { ...placed, points: placed.points.slice(0, 3) }, 'full')).toThrow(/needs 4 slots/);
  });

  it('4.3: time moves the light on, and a time that is not finite or is 0 or less adds none', () => {
    const state = select(fresh(), 0).state;
    expect(stepLanternGlade(state, [], 100).state.sinceLitMs).toBe(100);
    expect(stepLanternGlade(state, [], 0).state.sinceLitMs).toBe(state.sinceLitMs);
    expect(stepLanternGlade(state, [], -5).state.sinceLitMs).toBe(state.sinceLitMs);
    expect(stepLanternGlade(state, [], Number.NaN).state.sinceLitMs).toBe(state.sinceLitMs);
  });
});
