// The flicker of lantern and candle light (garden-level design 2.7; requirements 17.2, 17.3; art-and-motion.md).
// Brightness varies by at most maxAmplitude either way, in cycles of at least minCycleMs. Reduced motion has no
// flicker, so its light is steady. Each value carries one label, as the tuning files do: rule values come from
// the requirements and change only with the owner's approval, and tune values are starting values.
import type { MotionLevel } from 'marrow/core';

export const FLICKER = Object.freeze({
  maxAmplitude: 0.15, // rule: change only with the user's approval (requirements 17.2: at most 15% either way)
  minCycleMs: 1500, // rule: change only with the user's approval (requirements 17.2: cycles of 1.5 s or longer)
  amplitude: 0.1, // tune (a starting value inside maxAmplitude)
  cycleMs: 2400, // tune (a starting value at or above minCycleMs)
});

/**
 * The brightness factor of the flame at a time, in ms. It is 1 in Reduced motion, and in the other levels a sine
 * within 1 - amplitude to 1 + amplitude with the cycle of cycleMs (Req 17.2, 17.3).
 */
export function flickerFactor(motion: MotionLevel, timeMs: number): number {
  if (motion === 'reduced') return 1;
  return 1 + FLICKER.amplitude * Math.sin((2 * Math.PI * timeMs) / FLICKER.cycleMs);
}
