import { describe, expect, it } from 'vitest';
import { createGrid, makeMapping, markAllValid, TUNING, type Mapping } from '../core';
import { inRestingBand, planPlacement } from './placementBand';

// Fixed cases for the resting band. The mapping has gain 1 and both aspects 1, so camera y equals
// screen y and the numbers below are exact in binary (0.25, 0.5, 0.75).
const identity: Mapping = makeMapping({
  playAspect: 1,
  frameAspect: 1,
  gain: 1,
  centre: { x: 0.5, y: 0.5 },
});

describe('inRestingBand', () => {
  it('counts a hit circle whose lowest point is exactly at the band edge', () => {
    expect(inRestingBand({ x: 0.5, y: 0.5 }, 0.25, identity, 0.75)).toBe(true);
  });

  it('does not count a hit circle whose lowest point is just above the band edge', () => {
    expect(inRestingBand({ x: 0.5, y: 0.5 }, 0.25, identity, 0.7501)).toBe(false);
  });
});

describe('planPlacement without band slots', () => {
  it('returns the out-of-band result unchanged when it is simultaneous', () => {
    // One slot out of the band (bottom at 0.25) with a usable grid: n = 1 is reached without the band.
    const slot = { x: 0.5, y: 0.2 };
    const grids = { right: markAllValid(createGrid(TUNING)) };
    const placed = planPlacement({ slots: [slot], n: 1, r: 0.05, m: 0 }, grids, identity, TUNING, 0.75);
    expect(placed.result.kind).toBe('simultaneous');
    if (placed.result.kind !== 'simultaneous') return;
    expect(placed.result.slots[0]).toBe(slot);
    expect(placed.bandSlotsUsed).toBe(0);
  });
});

describe('planPlacement band order', () => {
  it('uses the band slot nearest the upper edge, whatever the caller order', () => {
    // Both slots are in the band (lowest points at 0.95 and 0.85). The top point of the slot at
    // y 0.8 is at 0.75, the upper edge, and the other is at 0.85. Only one target is needed.
    const lower = { x: 0.2, y: 0.9 };
    const upper = { x: 0.6, y: 0.8 };
    const grids = { right: markAllValid(createGrid(TUNING)) };
    const placed = planPlacement(
      { slots: [lower, upper], n: 1, r: 0.05, m: 0 },
      grids,
      identity,
      TUNING,
      0.75,
    );
    expect(placed.result.kind).toBe('simultaneous');
    if (placed.result.kind !== 'simultaneous') return;
    expect(placed.result.slots[0]).toBe(upper);
    expect(placed.bandSlotsUsed).toBe(1);
  });
});
