// The scene spec: content and theme to the Scene Manager's input (design 8.3, 8.4).
import { TUNING as MARROW_TUNING } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { TUNING, type ProjectionFrame } from 'world-view';
import { colourNumber, theme } from '../../ui/theme';
import { DEFAULT_ASPECT, TARGET_TOKEN } from './constants';
import { sceneLayers, sceneTargets } from './sceneSpec';
import { mouseComfort, placeStops } from './placementSetup';
import { loadWorldContent } from './worldContent';

const ONE = 1;
const FRAME: ProjectionFrame = { aspect: DEFAULT_ASPECT, sceneScale: ONE };

describe('scene spec', () => {
  it('scene layers take their colours from the theme and keep the table order', () => {
    const loaded = loadWorldContent(FRAME);
    if (!loaded.ok) throw new Error('the forest content is invalid');
    const layers = sceneLayers(loaded.content, TUNING);
    expect(layers.map((layer) => layer.id)).toEqual(['layer-0', 'layer-1', 'layer-2', 'layer-3', 'layer-4', 'layer-5']);
    expect(layers.map((layer) => layer.depth)).toEqual(loaded.content.layers.map((layer) => layer.depth));
    expect(layers[ONE]?.fill).toBe(colourNumber('grey2'));
    expect(layers[ZERO_INDEX]?.fill).toBe(colourNumber('grey1'));
    expect(layers.filter((layer) => layer.interaction === true).map((layer) => layer.id)).toEqual(['layer-3']);
    const accents = layers[3]?.shapes.filter((shape) => shape.accent === true) ?? [];
    expect(accents.every((shape) => shape.colour === colourNumber('lanternWarm'))).toBe(true);
    expect(theme.lanternWarm).toBe('#F0A840');
  });

  it('scene targets are drawn in the target colour with the hit radius of marrow', () => {
    const loaded = loadWorldContent(FRAME);
    if (!loaded.ok) throw new Error('the forest content is invalid');
    const segment = loaded.content.segments[ZERO_INDEX];
    if (segment === undefined) throw new Error('no segment');
    const comfort = mouseComfort(FRAME.aspect, MARROW_TUNING.hitRadius);
    const placed = placeStops(loaded.content, segment, FRAME, comfort.grids, comfort.mapping, MARROW_TUNING.hitRadius, TUNING);
    if (!placed.ok) throw new Error('placement did not start');
    const targets = sceneTargets(placed.stops);
    expect(targets).toHaveLength(placed.stops.reduce((sum, stop) => sum + stop.targets.length, ZERO_INDEX));
    for (const target of targets) {
      expect(target.colour).toBe(colourNumber(TARGET_TOKEN));
      expect(target.r).toBe(MARROW_TUNING.hitRadius);
    }
  });
});

const ZERO_INDEX = 0;
