// Contract test for whisper-glade content (design 4.3, built on stages/shared/contract.ts), plus the block rules of
// design 4.2 (requirements 5.2, 5.4, 5.8) and the copy keys of the eight per-rule lines.
import { describe, expect, it } from 'vitest';
import { hasCopyKey } from '../../copy/garden';
import { registerContract, type ContractMutation } from '../shared/contract';
import shipped from './content.json';
import { ATTENTION_TUNING, seedRng } from 'marrow/challenges';
import { copyKeysOf, loadWhisperGlade, validateWhisperGlade, type WhisperGladeContent } from './content';
import { TUNING, createHelp } from 'marrow/core';
import { targetScreen, TUNING as WORLD_TUNING, type WorldPoint } from 'world-view';
import { loadSegments } from '../../journeys/journeys';
import segmentsJson from '../../journeys/segments.json';
import { INTERACTION_LAYER } from '../../scene/forestLayers';
import { wholeFrameReach, SIMULATED_WRISTS } from '../../session/wholeFrame';
import { placeRound } from '../shared/placeRound';
import { PATH_TARGET_IDS } from './pathChoice';
import { spiritTargetId, startWhisperGlade, stepWhisperGlade } from './rules';

type Json = Record<string, unknown>;
interface BlockJson {
  select: string;
  pass: string;
  marks: string[];
}
interface SlotJson {
  x: number;
  y: number;
  depth: number;
  anchor: number;
}

const blocksOf = (json: Json): BlockJson[] => json.blocks as BlockJson[];
const spiritsOf = (json: Json): { stem: string }[] => json.spirits as { stem: string }[];
const spiritSlotsOf = (json: Json): SlotJson[] => json.spiritSlots as SlotJson[];
const pathSlotsOf = (json: Json): { fireflies: SlotJson; candles: SlotJson } => json.pathSlots as { fireflies: SlotJson; candles: SlotJson };

/** The block at an index of the content. A missing block is a bad test fixture, so it throws. */
function blockAt(json: Json, index: number): BlockJson {
  const block = blocksOf(json)[index];
  if (block === undefined) throw new Error(`no block ${index} in the fixture`);
  return block;
}

/** The spirit slot at an index of the content. A missing slot is a bad test fixture, so it throws. */
function spiritSlotAt(json: Json, index: number): SlotJson {
  const slot = spiritSlotsOf(json)[index];
  if (slot === undefined) throw new Error(`no spirit slot ${index} in the fixture`);
  return slot;
}

/** The seven mutations of design 4.3, case 2. Each one must be rejected at the path it names. */
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
    name: 'a block with no pass',
    path: 'blocks[0].marks',
    mutate: (json) => {
      blockAt(json, 0).marks = ['select', 'select', 'select'];
    },
  },
  {
    name: 'an unknown spirit stem',
    path: 'blocks[0].select',
    mutate: (json) => {
      blockAt(json, 0).select = 'redFlame';
    },
  },
  {
    name: 'a copy key that is not in GARDEN_COPY',
    path: 'spirits[0].stem',
    mutate: (json) => {
      spiritsOf(json)[0] = { stem: 'blueDropX' };
      blockAt(json, 0).select = 'blueDropX';
    },
  },
  {
    name: 'a non-finite coordinate',
    path: 'spiritSlots[0].x',
    mutate: (json) => {
      spiritSlotsOf(json)[0] = { ...spiritSlotAt(json, 0), x: Number.NaN };
    },
  },
  {
    name: 'too few spirit slots',
    path: 'spiritSlots',
    mutate: (json) => {
      json.spiritSlots = spiritSlotsOf(json).slice(0, 1);
    },
  },
];

/** A bound on the steps of one run. A round needs far fewer; the bound stops a broken round from hanging the test. */
const STEP_CAP = 500;
const STEP_MS = ATTENTION_TUNING.presentationMinMs;

/**
 * Case 4 of design 4.3: the rule, run from this content with seed 42, reaches completed. The player dwells on each
 * select spirit, lets the pass spirits go, and then chooses the fireflies.
 */
function reachesCompleted(content: WhisperGladeContent): boolean {
  let state = startWhisperGlade(content, seedRng(42), 'full').state;
  for (let step = 0; step < STEP_CAP; step++) {
    if (state.attention.phase === 'finished') {
      return stepWhisperGlade(state, [PATH_TARGET_IDS.fireflies], STEP_MS).completed;
    }
    const current = state.attention.blocks[state.attention.block]?.[state.attention.index];
    const dwell = state.attention.phase === 'presenting' && current?.mark === 'select';
    const selected = dwell && current !== undefined ? [spiritTargetId(current.stimulusId)] : [];
    state = stepWhisperGlade(state, selected, STEP_MS).state;
  }
  return false;
}

registerContract({
  stage: 'whisper-glade',
  validate: validateWhisperGlade,
  load: loadWhisperGlade,
  shipped: shipped as Json,
  mutations,
  copyKeys: (content: WhisperGladeContent) => copyKeysOf(content),
  rule: reachesCompleted,
});

describe('whisper-glade block rules (design 4.2, requirements 5.2, 5.4, 5.8)', () => {
  it('5.2: the shipped blocks are blue drop select with gold leaf pass, then gold leaf select with blue drop pass', () => {
    const content = loadWhisperGlade(shipped);
    expect(content.blocks.map((block) => [block.select, block.pass])).toEqual([
      ['blueDrop', 'goldLeaf'],
      ['goldLeaf', 'blueDrop'],
    ]);
  });

  it('5.4: each block has three marks, with at least one select and one let-pass', () => {
    const content = loadWhisperGlade(shipped);
    for (const block of content.blocks) {
      expect(block.marks).toHaveLength(3);
      expect(block.marks).toContain('select');
      expect(block.marks).toContain('pass');
    }
  });

  it('design 4.2: the validator rejects a block whose select equals its pass', () => {
    const json = structuredClone(shipped) as Json;
    blockAt(json, 0).pass = 'blueDrop';
    const result = validateWhisperGlade(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain('blocks[0].pass');
  });

  it('design 4.2: the validator rejects two blocks that use the same rule', () => {
    const json = structuredClone(shipped) as Json;
    blockAt(json, 1).select = 'blueDrop';
    blockAt(json, 1).pass = 'goldLeaf';
    const result = validateWhisperGlade(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain('blocks[1].select');
  });

  it('design 4.2: the validator rejects a block with no select and reports the path', () => {
    const json = structuredClone(shipped) as Json;
    blockAt(json, 1).marks = ['pass', 'pass', 'pass'];
    const result = validateWhisperGlade(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain('blocks[1].marks');
  });

  it('design 4.2: the validator rejects a path slot that is not finite', () => {
    const json = structuredClone(shipped) as Json;
    pathSlotsOf(json).candles.y = Number.POSITIVE_INFINITY;
    const result = validateWhisperGlade(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain('pathSlots.candles.y');
  });
});

describe('whisper-glade copy keys (requirement 5.8)', () => {
  it('5.8: the eight per-rule keys exist in GARDEN_COPY, and so do the demonstration and path keys', () => {
    const keys = copyKeysOf(loadWhisperGlade(shipped));
    expect(keys).toHaveLength(10);
    expect(keys.filter((key) => !hasCopyKey(key))).toEqual([]);
    expect(keys).toEqual(
      expect.arrayContaining([
        'whisper.select.blueDrop',
        'whisper.pass.goldLeaf',
        'mistake.select.blueDrop',
        'mistake.pass.goldLeaf',
        'whisper.select.goldLeaf',
        'whisper.pass.blueDrop',
        'mistake.select.goldLeaf',
        'mistake.pass.blueDrop',
        'whisper.demo',
        'path.choose',
      ]),
    );
  });
});

describe('whisper-glade target separation (the spirits and the path options do not overlap)', () => {
  // The play area of the stage, and its whole-frame reach (as ui/GardenStage.tsx and the session tests use).
  const aspect = 16 / 9;
  const frame = { aspect, sceneScale: 1 };
  const reach = wholeFrameReach(aspect);
  const layer = { depth: INTERACTION_LAYER.depth, anchor: INTERACTION_LAYER.anchor, factor: WORLD_TUNING.interactionFactor };
  const journeyA = loadSegments(segmentsJson).journeyA;
  // The travel distances of Whisper Glade: its start, the middle of journey A, and the end of journey A.
  const travels = [journeyA.from, (journeyA.from + journeyA.to) / 2, journeyA.to];
  const pointOf = (slot: { x: number; y: number }): WorldPoint => ({ ...slot, depth: layer.depth, anchor: layer.anchor, factor: layer.factor });

  it('8.1 8.4: at each travel, both groups place simultaneously, and no centre lies inside a circle of the other group', () => {
    const loaded = loadWhisperGlade(shipped);
    const spirits = loaded.spiritSlots.map(pointOf);
    const paths = [loaded.pathSlots.fireflies, loaded.pathSlots.candles].map(pointOf);
    for (const travel of travels) {
      const view = { travel, head: { x: 0, y: 0 } };
      const place = (slots: WorldPoint[]) =>
        placeRound({
          worldSlots: slots,
          n: slots.length,
          help: createHelp(TUNING),
          grids: reach.grids,
          activeWrists: SIMULATED_WRISTS,
          mapping: reach.mapping,
          view,
          frame,
          layer,
          bandY: ATTENTION_TUNING.restingBandY,
          core: TUNING,
        });
      const spiritRound = place(spirits);
      const pathRound = place(paths);
      expect(spiritRound.kind, `spirits at travel ${travel}`).toBe('simultaneous');
      expect(pathRound.kind, `paths at travel ${travel}`).toBe('simultaneous');
      const screen = (point: WorldPoint, radius: number) => targetScreen(point, radius, view, frame, WORLD_TUNING);
      const spiritScreens = spiritRound.points.map((point) => screen(point, spiritRound.snapshot.radius));
      const pathScreens = pathRound.points.map((point) => screen(point, pathRound.snapshot.radius));
      for (const s of spiritScreens) {
        for (const p of pathScreens) {
          if (s === null || p === null) throw new Error(`a target is culled at travel ${travel}`);
          const gap = Math.hypot(s.position.x - p.position.x, s.position.y - p.position.y);
          expect(gap > p.radius, `a spirit centre is inside a path circle at travel ${travel}`).toBe(true);
          expect(gap > s.radius, `a path centre is inside a spirit circle at travel ${travel}`).toBe(true);
          expect(gap > s.radius + p.radius, `the spirit and path circles overlap at travel ${travel}`).toBe(true);
        }
      }
    }
  });
});
