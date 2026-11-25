// The colour of the lit lanterns (requirements 17.1, 17.2, 17.3; garden-level 11.6). The flicker bound is measured on the
// unclipped channels, so the check does not depend on the clamp. The light colour is the lanternWarm token of ui/theme.ts
// (#F0A840), given here as a number, because a stage module does not import the UI.
import { TUNING } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { flickerFactor, FLICKER } from '../../scene/flicker';
import { loadLanternGlade } from './content';
import shipped from './content.json';
import { clampedColour, lanternColoursOf, unclippedLight } from './scene';
import { createLanternGlade, stepLanternGlade, targetIdOf, type LanternState } from './rules';
import { placedFor } from './testPlaced';

const LIGHT = 0xf0a840;
const CHANNELS = [(LIGHT >> 16) & 0xff, (LIGHT >> 8) & 0xff, LIGHT & 0xff] as const;
const BOUND = FLICKER.maxAmplitude;
const SAMPLE_STEP_MS = 37;
const SAMPLE_CYCLES = 5;
const MIN_SAMPLES = 300;
const content = loadLanternGlade(shipped);

/** The state with the first `lit` lanterns lit, each settled (its light at 1) before the next is lit. */
function settledWith(lit: number, motion: 'full' | 'gentle' | 'reduced' = 'full'): LanternState {
  let state = createLanternGlade(content, placedFor(content), motion);
  for (let index = 0; index < lit; index++) {
    state = stepLanternGlade(state, [targetIdOf(index)], 0).state;
    state = stepLanternGlade(state, [], TUNING.uiMinLightEaseMs).state;
  }
  return state;
}

/** Times across several cycles, in steps of SAMPLE_STEP_MS. */
function samples(): number[] {
  const out: number[] = [];
  for (let t = 0; t <= FLICKER.cycleMs * SAMPLE_CYCLES; t += SAMPLE_STEP_MS) out.push(t);
  return out;
}

describe('the colour of the lit lanterns (requirements 17.1, 17.2, 17.3)', () => {
  it('17.2: every lit colour stays within 15% either way of the light colour, measured before clipping', () => {
    const state = settledWith(3);
    const times = samples();
    expect(times.length).toBeGreaterThanOrEqual(MIN_SAMPLES);
    for (const t of times) {
      const factor = flickerFactor('full', t);
      const unclipped = unclippedLight(LIGHT, 1, factor);
      // The colour the stage gives must be the clamp of these unclipped channels, for every lit lantern.
      const expected = clampedColour(unclipped);
      const lit = lanternColoursOf(state, t, 'full', LIGHT);
      expect(lit.map((entry) => entry.id)).toEqual([targetIdOf(0), targetIdOf(1), targetIdOf(2)]);
      for (const entry of lit) {
        expect(entry.colour, `${entry.id} at ${t} ms`).toBe(expected);
      }
      for (let channel = 0; channel < 3; channel++) {
        const ratio = (unclipped[channel] ?? 0) / (CHANNELS[channel] ?? 1);
        expect(ratio, `channel ${channel} at ${t} ms`).toBeGreaterThanOrEqual(1 - BOUND - 1e-9);
        expect(ratio, `channel ${channel} at ${t} ms`).toBeLessThanOrEqual(1 + BOUND + 1e-9);
      }
    }
  });

  it('17.2: the flicker reaches the full bound on the red channel, so the bound test is not vacuous', () => {
    const red = CHANNELS[0] ?? 1;
    const ratios = samples().map((t) => (unclippedLight(LIGHT, 1, flickerFactor('full', t))[0] ?? 0) / red);
    expect(Math.max(...ratios)).toBeCloseTo(1 + FLICKER.amplitude, 3);
    expect(Math.min(...ratios)).toBeCloseTo(1 - FLICKER.amplitude, 3);
  });

  it('17.2: the colour of a lit lantern repeats each cycle, and a cycle is at least 1.5 s', () => {
    expect(FLICKER.cycleMs).toBeGreaterThanOrEqual(FLICKER.minCycleMs);
    const state = settledWith(2);
    for (const t of samples()) {
      expect(lanternColoursOf(state, t + FLICKER.cycleMs, 'full', LIGHT)).toEqual(lanternColoursOf(state, t, 'full', LIGHT));
    }
  });

  it('17.3: in Reduced motion the colour of a lit lantern is the same at every time', () => {
    const state = settledWith(2, 'reduced');
    const first = lanternColoursOf(state, 0, 'reduced', LIGHT);
    expect(first).toHaveLength(2);
    for (const t of samples()) {
      expect(lanternColoursOf(state, t, 'reduced', LIGHT)).toEqual(first);
    }
  });

  it('17.2: unlit lanterns are not listed, so they keep their steady colour', () => {
    expect(lanternColoursOf(settledWith(1), 1000, 'full', LIGHT).map((lit) => lit.id)).toEqual([targetIdOf(0)]);
    expect(lanternColoursOf(createLanternGlade(content, placedFor(content), 'full'), 1000, 'full', LIGHT)).toEqual([]);
  });

  it('17.1: only the most recently lit lantern eases in; an older lit lantern is at full light', () => {
    // Light the second lantern at once: the first is settled and the second is at light level 0 (black).
    const state = stepLanternGlade(settledWith(1), [targetIdOf(1)], 0).state;
    const at = lanternColoursOf(state, 0, 'full', LIGHT);
    expect(at.find((lit) => lit.id === targetIdOf(1))?.colour).toBe(0);
    expect(at.find((lit) => lit.id === targetIdOf(0))?.colour).toBe(clampedColour(unclippedLight(LIGHT, 1, flickerFactor('full', 0))));
  });

  it('17.2: each channel is clamped to 0..255 after rounding', () => {
    expect(clampedColour([300, -5, 128.4])).toBe((0xff << 16) | 128);
    expect(clampedColour([254.6, 0.4, 255])).toBe((0xff << 16) | 0xff);
  });
});
