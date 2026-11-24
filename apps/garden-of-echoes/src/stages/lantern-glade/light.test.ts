// The light of a newly lit lantern (requirements 4.3, 17.1, 17.3). The ease comes from marrow's TUNING, and the
// flicker from scene/flicker.ts. In Reduced motion the flicker is off, so the light is steady.
import { TUNING } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { flickerFactor } from '../../scene/flicker';
import { loadLanternGlade } from './content';
import shipped from './content.json';
import { createLanternGlade, lightLevel, stepLanternGlade, targetIdOf, type LanternState } from './rules';
import { placedFor } from './testPlaced';

const content = loadLanternGlade(shipped);
const EASE_MS = TUNING.uiMinLightEaseMs;

/** The state just after the first lantern is lit, at the given motion level. */
function lit(motion: 'full' | 'gentle' | 'reduced'): LanternState {
  const state = createLanternGlade(content, placedFor(content), motion);
  return stepLanternGlade(state, [targetIdOf(0)], 0).state;
}

describe('the light of a lantern', () => {
  it('17.1 4.3: a new light starts at 0 and rises to 1 over at least the light ease', () => {
    const start = lit('full');
    expect(lightLevel(start)).toBe(0);
    const half = stepLanternGlade(start, [], EASE_MS / 2).state;
    expect(lightLevel(half)).toBeGreaterThan(0);
    expect(lightLevel(half)).toBeLessThan(1);
    const done = stepLanternGlade(half, [], EASE_MS / 2).state;
    expect(lightLevel(done)).toBe(1);
  });

  it('17.1: the light is not yet full at one millisecond before the ease ends', () => {
    const almost = stepLanternGlade(lit('full'), [], EASE_MS - 1).state;
    expect(lightLevel(almost)).toBeLessThan(1);
  });

  it('17.1: the light rises without a jump, and never falls while it rises', () => {
    let state = lit('full');
    let previous = lightLevel(state);
    const tenth = EASE_MS / 10;
    for (let step = 0; step < 10; step++) {
      state = stepLanternGlade(state, [], tenth).state;
      const now = lightLevel(state);
      expect(now).toBeGreaterThanOrEqual(previous);
      expect(now - previous).toBeLessThanOrEqual(0.25);
      previous = now;
    }
    expect(previous).toBe(1);
  });

  it('17.3 4.3: in Reduced motion the light rises the same way, and it does not flicker', () => {
    const full = stepLanternGlade(lit('full'), [], EASE_MS / 3).state;
    const reduced = stepLanternGlade(lit('reduced'), [], EASE_MS / 3).state;
    expect(lightLevel(reduced)).toBeCloseTo(lightLevel(full), 12);
    for (let t = 0; t <= EASE_MS * 10; t += EASE_MS / 4) {
      expect(flickerFactor('reduced', t)).toBe(1);
    }
  });

  it('17.3: the light is steady in Reduced motion once it has risen, with no flicker over time', () => {
    const settled = stepLanternGlade(lit('reduced'), [], EASE_MS).state;
    expect(lightLevel(settled)).toBe(1);
    expect(flickerFactor(settled.motion, 0)).toBe(flickerFactor(settled.motion, 1000));
  });
});
