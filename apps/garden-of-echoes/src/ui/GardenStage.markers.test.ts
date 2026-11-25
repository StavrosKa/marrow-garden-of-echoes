// The DOM markers of the stage (requirement 5.6, 8.1). A whisper marker is a visible shape, so the drop and the leaf
// differ in shape and not only in colour, and the path options differ too. A lantern marker stays transparent.
import { describe, expect, it } from 'vitest';
import { markerStyleOf } from './GardenStage';

describe('stage markers (requirements 5.6, 8.1)', () => {
  it('5.6: a blue drop and a gold leaf differ in shape, not only in colour', () => {
    const drop = markerStyleOf('drop');
    const leaf = markerStyleOf('leaf');
    expect(drop.borderRadius).not.toBe(leaf.borderRadius);
    expect(drop.background).not.toBe(leaf.background);
  });

  it('8.1: the fireflies and the candles differ in shape as well', () => {
    expect(markerStyleOf('fireflies').borderRadius).not.toBe(markerStyleOf('candles').borderRadius);
  });

  it('5.6: every whisper marker is visible, and the lantern marker stays transparent as before', () => {
    for (const shape of ['drop', 'leaf', 'fireflies', 'candles'] as const) {
      expect(markerStyleOf(shape).opacity).toBeUndefined();
      expect(markerStyleOf(shape).background).toBeDefined();
    }
    expect(markerStyleOf('lantern')).toEqual({ opacity: 0 });
  });
});
