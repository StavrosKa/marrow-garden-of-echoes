// Contract test for lantern-glade content (design 4.3), built on stages/shared/contract.ts, plus the checks of this
// stage's own shape: four lanterns and four notes (requirements 4.1, 4.2), and slots on the interaction layer (4.5).
import { describe, expect, it } from 'vitest';
import { INTERACTION_LAYER } from '../../scene/forestLayers';
import { registerContract, type ContractMutation } from '../shared/contract';
import shipped from './content.json';
import { LANTERN_COUNT, loadLanternGlade, validateLanternGlade } from './content';
import { createLanternGlade, stepLanternGlade, targetIdOf } from './rules';
import { placedFor } from './testPlaced';

type Json = Record<string, unknown>;

const slotsOf = (json: Json): Record<string, unknown>[] => json.slots as Record<string, unknown>[];

const mutations: ContractMutation[] = [
  {
    name: 'a missing id',
    path: 'id',
    mutate: (json) => {
      delete json.id;
    },
  },
  {
    name: 'a wrong version',
    path: 'version',
    mutate: (json) => {
      json.version = 2;
    },
  },
  {
    name: 'a non-finite coordinate',
    path: 'slots[0].x',
    mutate: (json) => {
      slotsOf(json)[0] = { ...slotsOf(json)[0], x: Number.NaN };
    },
  },
  {
    name: 'too few slots',
    path: 'slots',
    mutate: (json) => {
      json.slots = slotsOf(json).slice(0, 3);
    },
  },
  {
    name: 'a note that is not a pitch name',
    path: 'notes[0]',
    mutate: (json) => {
      (json.notes as string[])[0] = 'Q';
    },
  },
  {
    name: 'three notes for four lanterns',
    path: 'notes',
    mutate: (json) => {
      json.notes = (json.notes as string[]).slice(0, 3);
    },
  },
  {
    name: 'a lantern count other than four',
    path: 'lanterns',
    mutate: (json) => {
      json.lanterns = 5;
    },
  },
  {
    name: 'a copy key that is not in GARDEN_COPY',
    path: 'copy.first',
    mutate: (json) => {
      (json.copy as Json).first = 'nothing.here';
    },
  },
];

registerContract({
  stage: 'lantern-glade',
  validate: validateLanternGlade,
  load: loadLanternGlade,
  shipped: shipped as Json,
  mutations,
  copyKeys: (content) => [content.copy.first, content.copy.next],
  // Case 4: the rule, run from the content, selects the four lanterns in order and reaches completed.
  rule: (content) => {
    let state = createLanternGlade(content, placedFor(content), 'full');
    let completed = false;
    for (let index = 0; index < LANTERN_COUNT; index++) {
      const step = stepLanternGlade(state, [targetIdOf(index)], 0);
      state = step.state;
      completed = step.completed;
    }
    return completed && state.completed;
  },
});

describe('lantern-glade content shape', () => {
  it('4.1 4.2: the shipped content has four lanterns, one note each, and the first and next lines', () => {
    const content = loadLanternGlade(shipped);
    expect(content.lanterns).toBe(4);
    expect(content.notes).toHaveLength(4);
    expect(content.copy).toEqual({ first: 'lantern.first', next: 'lantern.next' });
  });

  it('4.5: every slot is on the interaction layer of the forest', () => {
    const content = loadLanternGlade(shipped);
    for (const slot of content.slots) {
      expect(slot.depth).toBe(INTERACTION_LAYER.depth);
      expect(slot.anchor).toBe(INTERACTION_LAYER.anchor);
    }
  });

  it('4.2: the validator names every issue, not only the first', () => {
    const json = structuredClone(shipped) as Json;
    json.id = 'bloom';
    json.lanterns = 3;
    const result = validateLanternGlade(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['id', 'lanterns']));
  });
});
