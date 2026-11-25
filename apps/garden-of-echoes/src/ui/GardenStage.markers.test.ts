// The DOM markers of the stage (requirement 5.6, 8.1). A whisper marker is a visible shape, so the drop and the leaf
// differ in shape and not only in colour, and the path options differ too. A lantern marker stays transparent.
import { describe, expect, it } from 'vitest';
import { APP_SESSION_TUNING } from '../session/tuning';
import { GARDEN_COPY } from '../copy/garden';
import { markerStyleOf, titleOpacity } from './GardenStage';
import { textOf } from './copyLookup';

describe('level titles and the help offer (requirements 7.3, 9.4)', () => {
  it('9.4: a title is hidden at its start and end, and full in the middle of its time', () => {
    const total = APP_SESSION_TUNING.entryTitleMs;
    expect(titleOpacity(total)).toBe(0);
    expect(titleOpacity(total / 2)).toBe(1);
    expect(titleOpacity(0)).toBe(0);
  });

  it('9.4: a title fades in and out, so its opacity never jumps to full at once', () => {
    const total = APP_SESSION_TUNING.entryTitleMs;
    const early = titleOpacity(total - 1);
    expect(early).toBeGreaterThanOrEqual(0);
    expect(early).toBeLessThan(1);
  });

  it('7.3: the help offer reads "Want a hint?", next to "Continue with help"', () => {
    expect(textOf('help.offer')).toBe(GARDEN_COPY.help.offer);
    expect(textOf('help.continue')).toBe(GARDEN_COPY.help.continue);
    expect(GARDEN_COPY.help.offer).toBe('Want a hint?');
  });
});

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
