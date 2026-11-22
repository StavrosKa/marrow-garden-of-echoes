// The round controller (design sections 14.2, 14.3; Req 14.5, 26.4, 26.9, 26.10). The slots and the grids here are
// fixtures. The hit radius, the grid and the cell threshold come from TUNING.
import { addSample, createGrid, makeMapping, markAllValid, TUNING, type Mapping, type Vec2 } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { INITIAL_SETUP, stepSetup, type SetupEvent } from './setupFlow';
import {
  calibrationDemand,
  filterSlots,
  openTargets,
  roundComplete,
  startRound,
  stepRound,
  type Grids,
  type RoundEnvironment,
  type RoundState,
} from './roundController';
import { readPlaygroundContent, type PlaygroundContent } from './playgroundContent';
import shipped from './playground-content.json';

const RADIUS = TUNING.hitRadius;
/** Camera-space distance a cell may lie from a slot and still count as valid in the region grids (a fixture). */
const REGION_RADIUS = 0.2;

function everyCellValid(): Grids {
  const grid = markAllValid(createGrid(TUNING));
  return { right: grid, left: grid };
}

function noCellValid(): Grids {
  const grid = createGrid(TUNING);
  return { right: grid, left: grid };
}

/** Grids valid only in cells near the given screen points, so that only those slots are usable. */
function gridsNear(points: readonly Vec2[], mapping: Mapping): Grids {
  const centres = points.map((point) => mapping.toCamera(point));
  let grid = createGrid(TUNING);
  for (let col = 0; col < TUNING.gridCols; col++) {
    for (let row = 0; row < TUNING.gridRows; row++) {
      const centre = { x: (col + 0.5) / TUNING.gridCols, y: (row + 0.5) / TUNING.gridRows };
      const near = centres.some((c) => Math.hypot(c.x - centre.x, c.y - centre.y) < REGION_RADIUS);
      if (!near) continue;
      for (let sample = 0; sample < TUNING.cellValidSamples; sample++) grid = addSample(grid, centre);
    }
  }
  return { right: grid, left: grid };
}

function mappingFor(aspect: number): Mapping {
  return makeMapping({ playAspect: aspect, frameAspect: aspect, gain: 1, centre: { x: aspect / 2, y: 0.5 } });
}

function contentOf(slots: readonly Vec2[], targetCount = 3): PlaygroundContent {
  return { targetCount, slots };
}

function environment(content: PlaygroundContent, aspect: number, grids: Grids): RoundEnvironment {
  return { content, playAspect: aspect, frameAspect: aspect, grids, mapping: mappingFor(aspect) };
}

/** Completes every open target of a round, one after another, and returns the state that follows. */
function completeAll(state: RoundState, env: RoundEnvironment): RoundState {
  let current: RoundState | null = state;
  for (const target of openTargets(state)) {
    current = stepRound(current, { kind: 'targetCompleted', targetId: target.id }, env);
    if (current === null) throw new Error('the round controller lost its state');
    if (current.round !== state.round) return current;
  }
  return current ?? state;
}

const shippedContent = readPlaygroundContent(shipped);
if (!shippedContent.ok) throw new Error(shippedContent.message);
const SHIPPED = shippedContent.content;

describe('the play-area slot filter', () => {
  it('drops a slot whose circle crosses or passes an edge, and keeps one that only touches it', () => {
    const slots: Vec2[] = [
      { x: RADIUS, y: 0.5 },
      { x: RADIUS - 0.01, y: 0.5 },
      { x: 0.95, y: 0.5 },
      { x: 0.5, y: 0.95 },
      { x: 0.5, y: 1 - RADIUS },
    ];
    const kept = filterSlots(slots, 1).map((entry) => entry.slot);
    expect(kept).toEqual([{ x: RADIUS, y: 0.5 }, { x: 0.5, y: 1 - RADIUS }]);
  });

  it('keeps a slot near the right edge when the play area is wider', () => {
    expect(filterSlots([{ x: 0.95, y: 0.5 }], 2)).toHaveLength(1);
  });

  it('keeps all 15 shipped slots at aspect 1, and the positions are in order', () => {
    const kept = filterSlots(SHIPPED.slots, 1);
    expect(kept).toHaveLength(15);
    expect(kept.map((entry) => entry.position)).toEqual([...kept.keys()]);
  });

  it('the calibration demand has N from the content, r from TUNING and m of zero', () => {
    const demand = calibrationDemand(SHIPPED, 1);
    expect(demand.n).toBe(SHIPPED.targetCount);
    expect(demand.r).toBe(RADIUS);
    expect(demand.m).toBe(0);
    expect(demand.slots).toHaveLength(15);
  });
});

describe('the targets of a round', () => {
  it('are pairwise disjoint in every round of a simultaneous run', () => {
    const env = environment(SHIPPED, 1, everyCellValid());
    let state = startRound(null, env);
    for (let round = 0; round < 10; round++) {
      expect(state.mode).toBe('simultaneous');
      for (let i = 0; i < state.targets.length; i++) {
        for (let j = i + 1; j < state.targets.length; j++) {
          const a = state.targets[i]?.slot ?? { x: 0, y: 0 };
          const b = state.targets[j]?.slot ?? { x: 0, y: 0 };
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * RADIUS);
        }
      }
      state = completeAll(state, env);
    }
  });

  it('a new round avoids the last round\'s slots when at least 6 slots are usable', () => {
    const env = environment(SHIPPED, 1, everyCellValid());
    let state = startRound(null, env);
    for (let round = 0; round < 10; round++) {
      const next = completeAll(state, env);
      const before = new Set(state.usedPositions);
      expect(next.usedPositions.some((position) => before.has(position))).toBe(false);
      state = next;
    }
  });

  it('keeps the full list when avoiding the last round\'s slots gives fewer simultaneous targets', () => {
    // Round 1 takes a1, a2, a3. Round 2 starts at b1: avoiding a's leaves b1, b2, b3, which overlap, so the
    // full list gives three simultaneous targets (b1, a1, a2) and is used.
    const slots: Vec2[] = [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.2, y: 0.8 },
      { x: 1.2, y: 0.5 },
      { x: 1.22, y: 0.5 },
      { x: 1.24, y: 0.5 },
    ];
    const env = environment(contentOf(slots), 2, everyCellValid());
    const first = startRound(null, env);
    expect(first.mode).toBe('simultaneous');
    const second = startRound(first, env);
    expect(second.mode).toBe('simultaneous');
    expect(second.targets.map((target) => target.slot)).toContain(slots[0]);
  });

  it('a sequential round shows target i alone in usable slot i mod k, one target at a time', () => {
    const slots: Vec2[] = [
      { x: 0.3, y: 0.5 },
      { x: 1.5, y: 0.5 },
    ];
    const mapping = mappingFor(2);
    const env: RoundEnvironment = {
      content: contentOf(slots),
      playAspect: 2,
      frameAspect: 2,
      grids: gridsNear(slots, mapping),
      mapping,
    };
    const round = startRound(null, env);
    expect(round.mode).toBe('sequential');
    expect(round.targets.map((target) => target.slot)).toEqual([slots[0], slots[1], slots[0]]);
    expect(openTargets(round).map((target) => target.slot)).toEqual([slots[0]]);

    const second = stepRound(round, { kind: 'targetCompleted', targetId: round.targets[0]?.id ?? '' }, env);
    expect(second && openTargets(second).map((target) => target.slot)).toEqual([slots[1]]);
  });

  it('gives none when no slot is usable, with no targets', () => {
    const env = environment(SHIPPED, 1, noCellValid());
    const round = startRound(null, env);
    expect(round.mode).toBe('none');
    expect(round.targets).toEqual([]);
    expect(openTargets(round)).toEqual([]);
    expect(roundComplete(round)).toBe(false);
  });
});

describe('the round controller events', () => {
  it('a completed target is no longer supplied', () => {
    const env = environment(SHIPPED, 1, everyCellValid());
    const round = startRound(null, env);
    const first = round.targets[0]?.id ?? '';
    const after = stepRound(round, { kind: 'targetCompleted', targetId: first }, env);
    expect(after && openTargets(after).map((target) => target.id)).not.toContain(first);
    expect(after && openTargets(after)).toHaveLength(2);
  });

  it('when every target is completed, a new round starts with new activation ids', () => {
    const env = environment(SHIPPED, 1, everyCellValid());
    const first = startRound(null, env);
    const second = completeAll(first, env);
    expect(second.round).toBe(first.round + 1);
    const firstIds = new Set(first.targets.map((target) => target.activationId));
    for (const target of second.targets) expect(firstIds.has(target.activationId)).toBe(false);
  });

  it('a start event begins a round and an unknown target leaves the state as it is', () => {
    const env = environment(SHIPPED, 1, everyCellValid());
    const round = stepRound(null, { kind: 'start' }, env);
    expect(round?.round).toBe(1);
    expect(round && stepRound(round, { kind: 'targetCompleted', targetId: 'no-such-target' }, env)).toBe(round);
  });

  it('pause and hold flags leave the round unchanged', () => {
    const env = environment(SHIPPED, 1, everyCellValid());
    const round = startRound(null, env);
    const before = JSON.stringify(round);
    const flags: SetupEvent[] = [{ kind: 'escape' }, { kind: 'overlayShown' }, { kind: 'holdEnded' }, { kind: 'resume' }];
    let setup = INITIAL_SETUP;
    setup = { ...setup, screen: 'play', mode: 'camera' };
    for (const event of flags) setup = stepSetup(setup, event).state;
    expect(JSON.stringify(round)).toBe(before);
  });
});
