// One typed, frozen object with every number the marrow core uses from steering
// (requirements Appendix A) and every new engine number (Appendix B), and the
// validation that checks it (Requirement 1). The app values of Appendix B live in
// the app, beside the code that uses them. Core logic reads these numbers from
// here and writes no other literal for them (Requirement 1.6).
//
// Each key carries one of two labels (Requirement 1.2):
//   tune: a starting value, adjusted with a real camera
//         (marked *(tune)* in steering, or new in Appendix B).
//   rule: change only with the user's approval
//         (every other value from steering).
// In the interface the label follows the starting value and comes before its
// source. In TUNING the same label follows the current value.

export interface Tuning {
  // --- Landmark validity & One Euro filter (Req 2, 8) ---
  minVisibility: number;           // 0.5   tune   (Appendix A, invariants 1)
  oneEuroMinCutoffHz: number;      // 1.2   tune   (invariants 2)
  oneEuroBeta: number;             // 0.02  tune   (invariants 2)
  oneEuroDCutoffHz: number;        // 1.0   tune   (invariants 2)

  // --- Mapping & reach gain (Req 6, 10, 13) ---
  reachGainMin: number;            // 1.0   tune   (invariants 2; range floor)
  reachGainMax: number;            // 1.6   tune   (invariants 2; range ceil)
  reachGainSpanTarget: number;     // 0.6   tune   (Appendix B, Req 13.3)
  simulatedHeadStrength: number;   // 0.3   tune   (invariants 2, Req 6.7)

  // --- Head view (Req 9) ---
  headDeadZone: number;            // 0.05  tune   (invariants 8)
  headClamp: number;               // 0.25  tune   (Appendix B, Req 9.3)
  headSmoothingTauMs: number;      // 120   tune   (Appendix B, Req 9.4)
  headEaseToCentreMs: number;      // 500   rule: change only with the user's approval (invariants 6; 0.5 s)

  // --- Calibration (Req 11, 12) ---
  calibNominalMs: number;          // 20000 tune   (invariants 3)
  calibEarliestMs: number;         // 12000 tune   (invariants 3)
  calibCapMs: number;              // 30000 tune   (invariants 3)
  calibEarlyQuietMs: number;       // 2000  tune   (Appendix B, Req 11.7)
  calmHoldMs: number;              // 2000  rule: change only with the user's approval (invariants 3)
  skipHeadViewAfterMs: number;     // 5000  rule: change only with the user's approval (invariants 3)
  calibHandHintMs: number;         // 1000  tune   (Appendix B, Req 11.12)
  gridCols: number;                // 16    tune   (invariants 3; 16 x 12 for a low-cost camera at about 7 inferences a second)
  gridRows: number;                // 12    tune   (invariants 3)
  cellValidSamples: number;        // 4     tune   (invariants 3)

  // --- Dwell & tracking (Req 17, 18) ---
  hitRadius: number;               // 0.09  tune   (invariants 4; range [0.07,0.13])
  hitRadiusMin: number;            // 0.07  tune   (invariants 4; range floor)
  hitRadiusMax: number;            // 0.13  tune   (invariants 4; range ceil)
  dwellMs: number;                 // 1500  tune   (invariants 5)
  outsideWindowMs: number;         // 150   rule: change only with the user's approval (invariants 5)
  invalidWindowMs: number;         // 300   rule: change only with the user's approval (invariants 5)
  maxClockStepMs: number;          // 100   rule: change only with the user's approval (invariants 6)
  oneWristHintMs: number;          // 1000  rule: change only with the user's approval (invariants 6; 1 s)
  trackingHoldAfterMs: number;     // 300   rule: change only with the user's approval (invariants 6)
  trackingOverlayAfterMs: number;  // 1000  rule: change only with the user's approval (invariants 6; 1 s)
  trackingResumeMs: number;        // 1000  tune   (invariants 6; 1 s)

  // --- Help policy (Req 19) ---
  difficultiesBeforeHelp: number;  // 2     rule: change only with the user's approval (invariants 9)
  motorRadii: readonly number[];   // [0.09,0.11,0.13] tune (Appendix B, Req 19.7)
  helpMaxLevel: number;            // 2     tune   (Appendix B, Req 19.6)

  // --- Camera & infra (Req 4, 5, 20, 25) ---
  modelLoadTimeoutMs: number;      // 20000 tune   (Appendix B, Req 5.5)
  maxInferenceHz: number;          // 20    tune   (Appendix B, Req 4.3)
  staleFrameMs: number;            // 500   tune   (Appendix B, Req 4.8)
  cameraWidth: number;             // 640   rule: change only with the user's approval (Appendix A, tech.md; not marked (tune))
  cameraHeight: number;            // 480   rule: change only with the user's approval (Appendix A, tech.md; not marked (tune))
  defaultVolume: number;           // 0.6   tune   (Appendix B, Req 20.6)
  debugRateWindowMs: number;       // 1000  tune   (Appendix B, Req 25.2)

  // --- Shared-UI minimums (Req 24) ---
  uiMinTextPx: number;             // 16    rule: change only with the user's approval (accessibility-and-copy.md)
  uiMinButtonTextPx: number;       // 18    rule: change only with the user's approval (art-and-motion.md)
  uiMinLightEaseMs: number;        // 300   rule: change only with the user's approval (accessibility-and-copy.md)
}

/** The shipped values. Frozen, so a value changes here and never at runtime. */
export const TUNING: Readonly<Tuning> = Object.freeze<Tuning>({
  // --- Landmark validity & One Euro filter ---
  minVisibility: 0.5,              // tune
  oneEuroMinCutoffHz: 1.2,         // tune
  oneEuroBeta: 0.02,               // tune
  oneEuroDCutoffHz: 1.0,           // tune

  // --- Mapping & reach gain ---
  reachGainMin: 1.0,               // tune
  reachGainMax: 1.6,               // tune
  reachGainSpanTarget: 0.6,        // tune
  simulatedHeadStrength: 0.3,      // tune

  // --- Head view ---
  headDeadZone: 0.05,              // tune
  headClamp: 0.25,                 // tune
  headSmoothingTauMs: 120,         // tune
  headEaseToCentreMs: 500,         // rule: change only with the user's approval

  // --- Calibration ---
  calibNominalMs: 20000,           // tune
  calibEarliestMs: 12000,          // tune
  calibCapMs: 30000,               // tune
  calibEarlyQuietMs: 2000,         // tune
  calmHoldMs: 2000,                // rule: change only with the user's approval
  skipHeadViewAfterMs: 5000,       // rule: change only with the user's approval
  calibHandHintMs: 1000,           // tune
  gridCols: 16,                    // tune
  gridRows: 12,                    // tune
  cellValidSamples: 4,             // tune

  // --- Dwell & tracking ---
  hitRadius: 0.09,                 // tune
  hitRadiusMin: 0.07,              // tune
  hitRadiusMax: 0.13,              // tune
  dwellMs: 1500,                   // tune
  outsideWindowMs: 150,            // rule: change only with the user's approval
  invalidWindowMs: 300,            // rule: change only with the user's approval
  maxClockStepMs: 100,             // rule: change only with the user's approval
  oneWristHintMs: 1000,            // rule: change only with the user's approval
  trackingHoldAfterMs: 300,        // rule: change only with the user's approval
  trackingOverlayAfterMs: 1000,    // rule: change only with the user's approval
  trackingResumeMs: 1000,          // tune

  // --- Help policy ---
  difficultiesBeforeHelp: 2,       // rule: change only with the user's approval
  // Object.freeze is shallow, so the array is frozen on its own.
  motorRadii: Object.freeze([0.09, 0.11, 0.13]), // tune
  helpMaxLevel: 2,                 // tune

  // --- Camera & infra ---
  modelLoadTimeoutMs: 20000,       // tune
  maxInferenceHz: 20,              // tune
  staleFrameMs: 500,               // tune
  cameraWidth: 640,                // rule: change only with the user's approval
  cameraHeight: 480,               // rule: change only with the user's approval
  defaultVolume: 0.6,              // tune
  debugRateWindowMs: 1000,         // tune

  // --- Shared-UI minimums ---
  uiMinTextPx: 16,                 // rule: change only with the user's approval
  uiMinButtonTextPx: 18,           // rule: change only with the user's approval
  uiMinLightEaseMs: 300,           // rule: change only with the user's approval
});

/** One problem found by `validateTuning`. */
export interface TuningError {
  /** The Tuning key the problem belongs to. */
  key: string;
  /** The value at fault. For a motorRadii entry, the entry; for the motorRadii length, the length. */
  value: number;
  /** One readable line naming the key, the value and the allowed range or relation. */
  message: string; // e.g. "reachGainMax = 1.8 is out of range [1, 1.6]"
}

/** An inclusive range. `int` marks values that must be whole numbers. */
interface DeclaredRange {
  readonly min: number;
  readonly max: number;
  readonly int?: boolean;
}

type NumberKey = { [K in keyof Tuning]: Tuning[K] extends number ? K : never }[keyof Tuning];

// One declared range per key, inclusive at both ends; for motorRadii it applies to
// each entry. Where steering gives a range (hit radius 0.07-0.13, reach gain
// 1.0-1.6; Req 1.5) or a minimum (16 px text, 18 px button text, 300 ms light
// easing), the range is exactly that. Elsewhere the bounds are sanity limits: times
// are at least 1 ms, values the logic divides by are above 0, and the upper bounds
// leave room for tuning.
const RANGES: { readonly [K in keyof Tuning]: DeclaredRange } = {
  minVisibility: { min: 0, max: 1 },
  oneEuroMinCutoffHz: { min: 0.0001, max: 10 },
  oneEuroBeta: { min: 0, max: 1 },
  oneEuroDCutoffHz: { min: 0.0001, max: 10 },

  reachGainMin: { min: 1.0, max: 1.6 }, // steering range
  reachGainMax: { min: 1.0, max: 1.6 }, // steering range
  reachGainSpanTarget: { min: 0.0001, max: 2 },
  simulatedHeadStrength: { min: 0, max: 1 },

  headDeadZone: { min: 0, max: 2 },
  headClamp: { min: 0.0001, max: 2 },
  headSmoothingTauMs: { min: 1, max: 2000 },
  headEaseToCentreMs: { min: 1, max: 5000 },

  calibNominalMs: { min: 1, max: 120000 },
  calibEarliestMs: { min: 1, max: 120000 },
  calibCapMs: { min: 1, max: 120000 },
  calibEarlyQuietMs: { min: 1, max: 30000 },
  calmHoldMs: { min: 1, max: 10000 },
  skipHeadViewAfterMs: { min: 1, max: 30000 },
  calibHandHintMs: { min: 1, max: 10000 },
  gridCols: { min: 1, max: 256, int: true },
  gridRows: { min: 1, max: 256, int: true },
  cellValidSamples: { min: 1, max: 1000, int: true },

  hitRadius: { min: 0.07, max: 0.13 }, // steering range
  hitRadiusMin: { min: 0.07, max: 0.13 }, // steering range
  hitRadiusMax: { min: 0.07, max: 0.13 }, // steering range
  dwellMs: { min: 1, max: 10000 },
  outsideWindowMs: { min: 1, max: 2000 },
  invalidWindowMs: { min: 1, max: 2000 },
  maxClockStepMs: { min: 1, max: 1000 },
  oneWristHintMs: { min: 1, max: 10000 },
  trackingHoldAfterMs: { min: 1, max: 10000 },
  trackingOverlayAfterMs: { min: 1, max: 10000 },
  trackingResumeMs: { min: 1, max: 10000 },

  difficultiesBeforeHelp: { min: 1, max: 20, int: true },
  motorRadii: { min: 0.07, max: 0.13 }, // each entry is a hit radius: steering range
  helpMaxLevel: { min: 1, max: 10, int: true },

  modelLoadTimeoutMs: { min: 1, max: 120000 },
  maxInferenceHz: { min: 1, max: 60 },
  staleFrameMs: { min: 1, max: 5000 },
  cameraWidth: { min: 1, max: 4096, int: true },
  cameraHeight: { min: 1, max: 4096, int: true },
  defaultVolume: { min: 0, max: 1 },
  debugRateWindowMs: { min: 1, max: 10000 },

  uiMinTextPx: { min: 16, max: 64 }, // steering minimum
  uiMinButtonTextPx: { min: 18, max: 64 }, // steering minimum
  uiMinLightEaseMs: { min: 300, max: 5000 }, // steering minimum
};

const KEYS = Object.keys(RANGES) as (keyof Tuning)[];

/** NaN and infinite values are never in range. */
function inRange(value: number, range: DeclaredRange): boolean {
  return (
    Number.isFinite(value) &&
    value >= range.min &&
    value <= range.max &&
    (range.int !== true || Number.isInteger(value))
  );
}

/**
 * Checks every key against its declared range, then the relations between keys
 * (design section 4). Returns one TuningError per problem; an empty array means
 * valid. A relation is checked only when its values passed their own range check,
 * so a NaN or out-of-range value is reported once, as out of range.
 */
export function validateTuning(t: Tuning): TuningError[] {
  const errors: TuningError[] = [];
  const failed = new Set<string>();

  const checkRange = (key: keyof Tuning, name: string, value: number): void => {
    const range = RANGES[key];
    if (inRange(value, range)) return;
    failed.add(name);
    const integers = range.int === true ? ' (integers only)' : '';
    errors.push({
      key,
      value,
      message: `${name} = ${value} is out of range [${range.min}, ${range.max}]${integers}`,
    });
  };

  for (const key of KEYS) {
    const value = t[key];
    if (typeof value === 'number') checkRange(key, key, value);
    else value.forEach((entry, i) => checkRange(key, `${key}[${i}]`, entry));
  }

  const passed = (...names: string[]): boolean => names.every((name) => !failed.has(name));
  const atMost = (a: NumberKey, b: NumberKey): void => {
    if (passed(a, b) && t[a] > t[b]) {
      errors.push({ key: a, value: t[a], message: `${a} = ${t[a]} must be at most ${b} = ${t[b]}` });
    }
  };

  atMost('calibEarliestMs', 'calibNominalMs');
  atMost('calibNominalMs', 'calibCapMs');
  atMost('reachGainMin', 'reachGainMax');
  atMost('hitRadiusMin', 'hitRadius');
  atMost('hitRadius', 'hitRadiusMax');

  const radii = t.motorRadii;
  if (passed('hitRadiusMin', 'hitRadiusMax')) {
    radii.forEach((radius, i) => {
      if (passed(`motorRadii[${i}]`) && (radius < t.hitRadiusMin || radius > t.hitRadiusMax)) {
        errors.push({
          key: 'motorRadii',
          value: radius,
          message:
            `motorRadii[${i}] = ${radius} must be within [hitRadiusMin, hitRadiusMax]` +
            ` = [${t.hitRadiusMin}, ${t.hitRadiusMax}]`,
        });
      }
    });
  }
  if (passed('helpMaxLevel') && radii.length !== t.helpMaxLevel + 1) {
    errors.push({
      key: 'motorRadii',
      value: radii.length,
      message: `motorRadii has ${radii.length} entries; it needs helpMaxLevel + 1 = ${t.helpMaxLevel + 1}`,
    });
  }
  const first = radii[0];
  if (first !== undefined && passed('motorRadii[0]', 'hitRadius') && first !== t.hitRadius) {
    errors.push({
      key: 'motorRadii',
      value: first,
      message: `motorRadii[0] = ${first} must equal hitRadius = ${t.hitRadius}`,
    });
  }

  if (passed('headDeadZone', 'headClamp') && t.headDeadZone >= t.headClamp) {
    errors.push({
      key: 'headDeadZone',
      value: t.headDeadZone,
      message: `headDeadZone = ${t.headDeadZone} must be less than headClamp = ${t.headClamp}`,
    });
  }
  atMost('trackingHoldAfterMs', 'trackingOverlayAfterMs');

  return errors;
}

/** Joins the problems into one readable block, one line each. Empty when there are none. */
export function formatTuningErrors(errors: readonly TuningError[]): string {
  if (errors.length === 0) return '';
  return ['Tuning is invalid:', ...errors.map((error) => `- ${error.message}`)].join('\n');
}
