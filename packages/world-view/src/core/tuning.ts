// One typed, frozen object with every number the world-view core uses (design
// section 5.1; requirements Appendix A and B, the rows marked as package values),
// and the validation that checks it (Requirement 1). App values (scene parallax
// scales, reward delay, slice segments, layer depths) live in the app. Core logic reads
// these numbers from here and writes no other literal for them (Requirement 1.6).
//
// Each key carries one of two labels (Requirement 1.2):
//   tune: a starting value, adjusted with a real camera
//         (marked *(tune)* in steering, or new in Appendix B).
//   rule: change only with the user's approval
//         (every other value from steering).
// In the interface the label follows the starting value and comes before its
// source. In TUNING the same label follows the current value.
import { TUNING as MARROW_TUNING } from 'marrow/core';
import type { ValidationIssue } from './issues';

export interface Tuning {
  // --- Parallax and projection (Req 2, 3) ---
  limitX: number;                       // 0.03 rule: change only with the user's approval (invariants 8; Appendix B)
  limitY: number;                       // 0.02 rule: change only with the user's approval (invariants 8; Appendix B)
  interactionFactor: number;            // 0.2 tune (invariants 8)
  nearPlane: number;                    // 0.5 tune (Appendix B)
  vanishingPointY: number;              // 0.45 tune (Appendix B)
  maxAspect: number;                    // 2.4 tune (Req 2.8, widest aspect of the check; added key, design section 11)
  // --- Layer table and depth scaling (Req 1.4, 2.8) ---
  layersMin: number;                    // 5 rule: change only with the user's approval (art-and-motion "5-6 depth layers"; Appendix A)
  layersMax: number;                    // 6 rule: change only with the user's approval (art-and-motion "5-6 depth layers"; Appendix A)
  horizonDepth: number;                 // 500 tune (Appendix B)
  foregroundDepth: number;              // 15 tune (Appendix B)
  journeyHorizonMaxMove: number;        // 0.03 tune (Appendix B, journey segment)
  journeyForegroundMinGrowth: number;   // 3 tune (Appendix B, journey segment)
  doorHorizonMaxMove: number;           // 0.01 tune (Appendix B, door segment)
  doorForegroundMinGrowth: number;      // 1.3 tune (Appendix B, door segment)
  // --- Glide and lock (Req 5, 6) ---
  glideTauMs: number;                   // 150 tune (Appendix B, user)
  glideCapPerS: number;                 // 4.0 tune (Appendix B, user)
  glideEpsilon: number;                 // 0.001 tune (Appendix B)
  lockEaseMs: number;                   // 400 tune (Appendix B)
  // --- Travel (Req 7, 8) ---
  journeyMinMs: number;                 // 5000 tune (invariants 7)
  journeyMaxMs: number;                 // 7000 tune (invariants 7)
  doorMs: number;                       // 3000 tune (invariants 7; a door segment's durationMs equals it, design 5.3)
  arrivalToleranceMs: number;           // 1e-6 tune (Appendix B)
  crossFadeMs: number;                  // 1500 tune (invariants 8)
  minFadeMs: number;                    // 600 rule: change only with the user's approval (accessibility-and-copy, 2 x 300 ms)
  // --- Motion profile (Req 8) ---
  gentleHeadMultiplier: number;         // 0.5 tune (invariants 8)
  gentleTravelMultiplier: number;       // 1.3 tune (invariants 8)
  gentleAmbientAmplitude: number;       // 0.5 tune (invariants 8)
  gentleAmbientSpeed: number;           // 0.5 tune (invariants 8)
  reducedAmbientAmplitude: number;      // 0.25 tune (invariants 8)
  reducedAmbientSpeed: number;          // 1 tune (design Appendix D decision 5)
  // --- Scene Manager (Req 10) ---
  maxPixelRatio: number;                // 2 tune (performance-budget, "Canvas resolution")
}

/** The shipped values. Frozen, so a value changes here and never at runtime. */
export const TUNING: Readonly<Tuning> = Object.freeze<Tuning>({
  // --- Parallax and projection ---
  limitX: 0.03,                         // rule: change only with the user's approval
  limitY: 0.02,                         // rule: change only with the user's approval
  interactionFactor: 0.2,               // tune
  nearPlane: 0.5,                       // tune
  vanishingPointY: 0.45,                // tune
  maxAspect: 2.4,                       // tune
  // --- Layer table and depth scaling ---
  layersMin: 5,                         // rule: change only with the user's approval
  layersMax: 6,                         // rule: change only with the user's approval
  horizonDepth: 500,                    // tune
  foregroundDepth: 15,                  // tune
  journeyHorizonMaxMove: 0.03,          // tune
  journeyForegroundMinGrowth: 3,        // tune
  doorHorizonMaxMove: 0.01,             // tune
  doorForegroundMinGrowth: 1.3,         // tune
  // --- Glide and lock ---
  glideTauMs: 150,                      // tune
  glideCapPerS: 4.0,                    // tune
  glideEpsilon: 0.001,                  // tune
  lockEaseMs: 400,                      // tune
  // --- Travel ---
  journeyMinMs: 5000,                   // tune
  journeyMaxMs: 7000,                   // tune
  doorMs: 3000,                         // tune
  arrivalToleranceMs: 1e-6,             // tune
  crossFadeMs: 1500,                    // tune
  minFadeMs: 600,                       // rule: change only with the user's approval
  // --- Motion profile ---
  gentleHeadMultiplier: 0.5,            // tune
  gentleTravelMultiplier: 1.3,          // tune
  gentleAmbientAmplitude: 0.5,          // tune
  gentleAmbientSpeed: 0.5,              // tune
  reducedAmbientAmplitude: 0.25,        // tune
  reducedAmbientSpeed: 1,               // tune
  // --- Scene Manager ---
  maxPixelRatio: 2,                     // tune
});

const ZERO = 0;
const ONE = 1;
const TWO = ONE + ONE;

/** The allowed range of one key. A bound is open (excluded) or closed (included); the default upper bound is Infinity. */
interface Range {
  readonly lo: number;
  readonly hi: number;
  readonly loOpen: boolean;
  readonly hiOpen: boolean;
  readonly int: boolean;
}

const closed = (lo: number, hi: number = Infinity): Range => ({ lo, hi, loOpen: false, hiOpen: hi === Infinity, int: false });
const open = (lo: number, hi: number = Infinity): Range => ({ lo, hi, loOpen: true, hiOpen: true, int: false });
const openClosed = (lo: number, hi: number): Range => ({ lo, hi, loOpen: true, hiOpen: false, int: false });
const whole = (range: Range): Range => ({ ...range, int: true });

// One range per key, in key order. Where a rule of Req 1.4 gives the bound, the range
// is exactly that. The other bounds are the rules design 5.2 adds so that every
// function stays defined; a bound that depends on another key reads that key.
const RANGES: { readonly [K in keyof Tuning]: (t: Tuning) => Range } = {
  limitX: () => openClosed(ZERO, ONE),
  limitY: () => openClosed(ZERO, ONE),
  interactionFactor: () => closed(ZERO, ONE),
  nearPlane: () => open(ZERO),
  vanishingPointY: () => open(ZERO, ONE),
  maxAspect: () => closed(ONE),
  layersMin: (t) => whole(closed(ONE, t.layersMax)),
  layersMax: (t) => whole(closed(t.layersMin)),
  horizonDepth: (t) => open(t.foregroundDepth),
  foregroundDepth: (t) => open(t.nearPlane, t.horizonDepth),
  journeyHorizonMaxMove: () => open(ZERO),
  journeyForegroundMinGrowth: () => closed(ONE),
  doorHorizonMaxMove: () => open(ZERO),
  doorForegroundMinGrowth: () => closed(ONE),
  glideTauMs: () => open(ZERO),
  glideCapPerS: () => open(ZERO),
  glideEpsilon: () => open(ZERO),
  lockEaseMs: () => open(ZERO),
  journeyMinMs: (t) => openClosed(ZERO, t.journeyMaxMs),
  journeyMaxMs: (t) => closed(t.journeyMinMs),
  doorMs: () => open(ZERO),
  arrivalToleranceMs: () => closed(ZERO),
  crossFadeMs: () => open(ZERO),
  minFadeMs: (t) => closed(TWO * MARROW_TUNING.uiMinLightEaseMs, t.crossFadeMs),
  gentleHeadMultiplier: () => closed(ZERO, ONE),
  gentleTravelMultiplier: () => open(ZERO),
  gentleAmbientAmplitude: () => closed(ZERO),
  gentleAmbientSpeed: () => closed(ZERO),
  reducedAmbientAmplitude: () => closed(ZERO, ONE),
  reducedAmbientSpeed: () => closed(ZERO),
  maxPixelRatio: () => closed(ONE),
};

const KEYS = Object.keys(RANGES) as (keyof Tuning)[];

/** The range as text, in interval notation: (0, Infinity), [0, 1]. */
function formatRange(range: Range): string {
  const left = range.loOpen ? '(' : '[';
  const right = range.hiOpen ? ')' : ']';
  return `${left}${range.lo}, ${range.hi}${right}${range.int ? ' (integers only)' : ''}`;
}

/** NaN and infinite values are never in range. */
function inRange(value: number, range: Range): boolean {
  if (!Number.isFinite(value)) return false;
  if (range.int && !Number.isInteger(value)) return false;
  const aboveLo = range.loOpen ? value > range.lo : value >= range.lo;
  const belowHi = range.hiOpen ? value < range.hi : value <= range.hi;
  return aboveLo && belowHi;
}

/**
 * Checks every key against its range (Req 1.3, 1.4; design 5.2) and returns one issue
 * per failing key, in key order, with a message such as
 * `glideCapPerS = -1 is out of range (0, Infinity)`. An empty array means valid.
 * The layer-table rules of Req 1.4 belong to `validateLayerTable`.
 */
export function validateTuning(t: Tuning): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const key of KEYS) {
    const range = RANGES[key](t);
    const value = t[key];
    if (inRange(value, range)) continue;
    issues.push({ path: key, value, message: `${key} = ${value} is out of range ${formatRange(range)}` });
  }
  return issues;
}
