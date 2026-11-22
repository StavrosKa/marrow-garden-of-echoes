// The shipped slots of the playground (Req 26.3, 14.2). The camera check showed every slot in the left half of the play
// area, so the right hand reached none. These tests check that the slots span the play area, and that a camera that
// covers only one half of the frame still leaves enough usable slots.
import { describe, expect, it } from 'vitest';
import { addSample, createGrid, isSlotUsable, makeMapping, TUNING, type ComfortGrid, type WristId } from 'marrow/core';
import { filterSlots, ROUND_MARGIN } from './roundController';
import { readPlaygroundContent } from './playgroundContent';
import shipped from './playground-content.json';

const PLAY_ASPECT = 1.6;
/** The camera frame's aspect (640 by 480). A fixture: the shipped camera size, not a tuning value. */
const FRAME_ASPECT = 4 / 3;
/** The share of the play width that the slots must span (the 80% of the check). */
const MIN_SPAN_SHARE = 0.8;

const loaded = readPlaygroundContent(shipped);
if (!loaded.ok) throw new Error(loaded.message);
const SLOTS = loaded.content.slots;

/** A grid whose cells on one half of the camera frame are valid, and the other cells are empty. */
function gridValidOnHalf(keep: (col: number) => boolean): ComfortGrid {
  let grid = createGrid(TUNING);
  for (let col = 0; col < TUNING.gridCols; col++) {
    if (!keep(col)) continue;
    for (let row = 0; row < TUNING.gridRows; row++) {
      const centre = { x: (col + 0.5) / TUNING.gridCols, y: (row + 0.5) / TUNING.gridRows };
      for (let sample = 0; sample < TUNING.cellValidSamples; sample++) grid = addSample(grid, centre);
    }
  }
  return grid;
}

function usableCount(grid: ComfortGrid): number {
  const mapping = makeMapping({
    playAspect: PLAY_ASPECT,
    frameAspect: FRAME_ASPECT,
    gain: 1,
    centre: { x: PLAY_ASPECT / 2, y: 0.5 },
  });
  const grids: { [W in WristId]?: ComfortGrid } = { right: grid };
  return filterSlots(SLOTS, PLAY_ASPECT).filter(
    (entry) => isSlotUsable(entry.slot, grids, mapping, TUNING.hitRadius, ROUND_MARGIN, TUNING) !== null,
  ).length;
}

describe('the shipped slots span the play area', () => {
  it('keeps slots over at least 80% of the play width after the play-area filter', () => {
    const kept = filterSlots(SLOTS, PLAY_ASPECT).map((entry) => entry.slot.x);
    expect(kept.length).toBe(SLOTS.length);
    const span = Math.max(...kept) - Math.min(...kept);
    expect(span).toBeGreaterThanOrEqual(MIN_SPAN_SHARE * PLAY_ASPECT);
  });

  it('keeps the target count at 3', () => {
    expect(loaded.content.targetCount).toBe(3);
  });
});

describe('a camera that covers one half of the frame still leaves usable slots', () => {
  const half = TUNING.gridCols / 2;

  it('leaves at least three usable slots when only the right half of the camera frame is valid', () => {
    expect(usableCount(gridValidOnHalf((col) => col >= half))).toBeGreaterThanOrEqual(loaded.content.targetCount);
  });

  it('leaves at least three usable slots when only the left half of the camera frame is valid', () => {
    expect(usableCount(gridValidOnHalf((col) => col < half))).toBeGreaterThanOrEqual(3);
  });
});
