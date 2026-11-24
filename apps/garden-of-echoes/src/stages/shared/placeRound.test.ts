import { describe, expect, it } from 'vitest';
import {
  addSample,
  createGrid,
  createHelp,
  helpRadiusForMotorLevel,
  makeMapping,
  markAllValid,
  TUNING as CORE,
  type ComfortGrid,
  type HelpState,
} from 'marrow/core';
import { parallaxMargin, TUNING as WORLD, type LayerRef, type View, type WorldPoint } from 'world-view';
import { snapshotRound } from '../../session/roundSnapshot';
import { placeRound, type PlaceRoundInput } from './placeRound';

// At this view and layer, the screen position of a world point equals its (x, y): the layer is at its
// anchor (depth scale 1) and the head is at rest. The camera mapping is the identity with aspect 1,
// so camera y equals screen y, and camera x is 1 - x.

const frame = { aspect: 1, sceneScale: 1 };
const identity = makeMapping({ playAspect: 1, frameAspect: 1, gain: 1, centre: { x: 0.5, y: 0.5 } });
const layer: LayerRef = { depth: 10, anchor: 0, factor: WORLD.interactionFactor };
const view: View = { travel: 0, head: { x: 0, y: 0 } };
const BAND_LOW = 0.75;
const BAND_OFF = 0.95;
/** The first row of camera space that is valid in the row-based grids: row 7 of 12. */
const ROW7 = 7 / 12;

type WristGrids = PlaceRoundInput['grids'];

const point = (x: number, y: number, depth = 10): WorldPoint => ({ x, y, depth, anchor: 0, factor: layer.factor });

const empty = (): ComfortGrid => createGrid(CORE);
const everywhere = (): ComfortGrid => markAllValid(createGrid(CORE));

/** A grid with every cell at row `minRow` or below valid (camera y from minRow / rows up to 1). */
function fromRow(minRow: number): ComfortGrid {
  let grid = createGrid(CORE);
  for (let row = minRow; row < CORE.gridRows; row++) {
    for (let col = 0; col < CORE.gridCols; col++) {
      const centre = { x: (col + 0.5) / CORE.gridCols, y: (row + 0.5) / CORE.gridRows };
      for (let i = 0; i < CORE.cellValidSamples; i++) grid = addSample(grid, centre);
    }
  }
  return grid;
}

function input(overrides: Partial<PlaceRoundInput>): PlaceRoundInput {
  return {
    worldSlots: [],
    n: 1,
    help: createHelp(CORE),
    grids: { right: everywhere() },
    activeWrists: ['right'],
    mapping: identity,
    view,
    frame,
    layer,
    bandY: BAND_OFF,
    core: CORE,
    ...overrides,
  };
}

describe('placeRound', () => {
  it('returns the authored world points, the same objects, for a simultaneous round', () => {
    const slots = [point(0.3, 0.3), point(0.6, 0.3), point(0.3, 0.6)];
    const placed = placeRound(input({ worldSlots: slots, n: 2 }));
    expect(placed.kind).toBe('simultaneous');
    expect(placed.points).toHaveLength(2);
    for (const shown of placed.points) expect(slots.includes(shown)).toBe(true);
    expect(placed.points[0]).toBe(slots[0]);
    expect(placed.points[1]).toBe(slots[1]);
  });

  it('applies the resting band: a band slot is used only when the other slots cannot give n', () => {
    const out = point(0.5, 0.3); // hit circle bottom at about 0.39, out of the band
    const band = point(0.5, 0.85); // hit circle bottom at about 0.94, in the band (bandY 0.75)

    // The out-of-band slot is usable, so the band slot is not used.
    const usable = placeRound(input({ worldSlots: [band, out], n: 1, bandY: BAND_LOW, grids: { right: everywhere() } }));
    expect(usable.kind).toBe('simultaneous');
    expect(usable.points[0]).toBe(out);
    expect(usable.bandSlotsUsed).toBe(0);

    // The out-of-band slot is not usable (the grid is valid only from camera y 0.5), so the band slot is used.
    const bandOnly = placeRound(
      input({ worldSlots: [out, band], n: 1, bandY: BAND_LOW, grids: { right: fromRow(6) } }),
    );
    expect(bandOnly.kind).toBe('simultaneous');
    expect(bandOnly.points[0]).toBe(band);
    expect(bandOnly.bandSlotsUsed).toBe(1);
  });

  it('applies the snapshot: the radius of the help level at placement decides which slot is usable', () => {
    // A slot whose hit circle of radius r + m fits above the valid rows at level 0, and not at level 2.
    const m = parallaxMargin(frame.sceneScale, frame.aspect, WORLD);
    const radius0 = helpRadiusForMotorLevel(0, CORE);
    const radius2 = helpRadiusForMotorLevel(2, CORE);
    const y = ROW7 + radius0 + m + 0.001;
    const slot = point(0.5, y);
    const grids: WristGrids = { right: fromRow(7) };

    const atLevel0 = placeRound(input({ worldSlots: [slot], grids }));
    expect(atLevel0.kind).toBe('simultaneous');
    expect(atLevel0.points[0]).toBe(slot);
    expect(atLevel0.snapshot.radius).toBe(radius0);
    expect(atLevel0.snapshot).toEqual(snapshotRound(createHelp(CORE), CORE));

    const raised: HelpState = { ...createHelp(CORE), motorLevel: 2 };
    const atLevel2 = placeRound(input({ worldSlots: [slot], grids, help: raised }));
    expect(atLevel2.kind).toBe('none');
    expect(atLevel2.points).toEqual([]);
    expect(atLevel2.snapshot.radius).toBe(radius2);
    expect(atLevel2.snapshot).toEqual(snapshotRound(raised, CORE));
  });

  it('keeps two authored points at the same screen position apart by identity', () => {
    // Both objects project to (0.3, 0.3). Identity mapping must return each one, not a copy of the first.
    const first = point(0.3, 0.3);
    const second = point(0.3, 0.3);
    const single = placeRound(input({ worldSlots: [first, second], n: 1 }));
    expect(single.kind).toBe('simultaneous');
    expect(single.points).toHaveLength(1);
    expect(single.points[0]).toBe(first);

    const pair = placeRound(input({ worldSlots: [first, second], n: 2 }));
    expect(pair.kind).toBe('sequential');
    expect(pair.points).toHaveLength(2);
    expect(pair.points[0]).toBe(first);
    expect(pair.points[1]).toBe(second);
  });

  it('returns none, with no points and the snapshot, when no slot is usable', () => {
    const placed = placeRound(input({ worldSlots: [point(0.5, 0.5)], grids: { right: empty() } }));
    expect(placed.kind).toBe('none');
    expect(placed.points).toEqual([]);
    expect(placed.snapshot).toEqual(snapshotRound(createHelp(CORE), CORE));
  });

  it('uses only the active wrist: a slot covered only by the other wrist is not usable', () => {
    const slot = point(0.5, 0.5);
    const grids: WristGrids = { right: empty(), left: everywhere() };
    expect(placeRound(input({ worldSlots: [slot], grids, activeWrists: ['right'] })).kind).toBe('none');
    const left = placeRound(input({ worldSlots: [slot], grids, activeWrists: ['left'] }));
    expect(left.kind).toBe('simultaneous');
    expect(left.points[0]).toBe(slot);
  });

  it('drops a culled world point, which has no screen position', () => {
    const culled = point(0.3, 0.3, 0); // depth 0 at travel 0: inside the near plane
    const visible = point(0.6, 0.3);
    const placed = placeRound(input({ worldSlots: [culled, visible], n: 1 }));
    expect(placed.points).toEqual([visible]);
    expect(placed.points[0]).toBe(visible);
  });

  it('refuses a layer that is not the interaction layer', () => {
    expect(() => placeRound(input({ worldSlots: [point(0.5, 0.5)], layer: { ...layer, factor: 0.5 } }))).toThrow(
      /interaction layer/,
    );
  });
});
