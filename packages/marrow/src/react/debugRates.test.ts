import { describe, expect, it } from 'vitest';
import { TUNING } from '../core';
import { ratePerSecond } from './debugRates';
// Requirement 25.2: the render and inference rates are the events over the last debugRateWindowMs.
// The window edges are checked exactly: a time one window old is outside, and so is a time after now.
const WINDOW = TUNING.debugRateWindowMs;
const NOW = 10 * WINDOW;
describe('ratePerSecond', () => {
  it('counts the events of the last window, scaled to one second', () => {
    expect(ratePerSecond([NOW - 100, NOW - 500, NOW], NOW, WINDOW)).toBe(3 * (1000 / WINDOW));
  });
  it('gives the count itself when the window is one second', () => {
    const times = [NOW - 900, NOW - 300, NOW - 10];
    expect(ratePerSecond(times, NOW, 1000)).toBe(3);
  });
  it('does not count a time exactly one window old, and counts one just inside it', () => {
    const exactlyOld = NOW - WINDOW;
    const justInside = NOW - WINDOW + 1;
    expect(ratePerSecond([exactlyOld], NOW, WINDOW)).toBe(0);
    expect(ratePerSecond([justInside], NOW, WINDOW)).toBe(1000 / WINDOW);
  });
  it('counts a time exactly at now, and not a time after now', () => {
    expect(ratePerSecond([NOW], NOW, WINDOW)).toBe(1000 / WINDOW);
    expect(ratePerSecond([NOW + 1], NOW, WINDOW)).toBe(0);
  });
  it('gives 0 for no events, and for a window of zero or less', () => {
    expect(ratePerSecond([], NOW, WINDOW)).toBe(0);
    expect(ratePerSecond([NOW], NOW, 0)).toBe(0);
    expect(ratePerSecond([NOW], NOW, -WINDOW)).toBe(0);
  });
  it('reads the window from the tuning value, not a literal', () => {
    const times = Array.from({ length: 4 }, (_, i) => NOW - i * (WINDOW / 8));
    expect(ratePerSecond(times, NOW, WINDOW)).toBe(4 * (1000 / WINDOW));
  });
});
