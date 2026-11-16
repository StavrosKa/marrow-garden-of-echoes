# Design Document

## Introduction

This design turns `requirements.md` into a buildable shape for the input and interaction core in `packages/marrow` (`src/core`, `src/input`, `src/react`) and the neutral playground in `apps/garden-of-echoes/src/dev`.

It keeps every rule from the steering files: logic is pure and headless (`tech.md` rule 1), no wall-clock time in logic (rule 2), one input contract (rule 3), rendering decoupled from inference (rule 5), inference on the main thread behind `PoseSource` (rule 6), one typed tuning module validated at startup (rule 7), and the dependency zones in `structure.md`. Requirement numbers below refer to `requirements.md`; invariant numbers refer to `interaction-invariants.md` section 10.

Scope note: the requirement set labels Requirements 8–19 "logic". Every one of them is realised here as a pure function or a `step` reducer in `packages/marrow/src/core`, importing nothing from React, PixiJS, the DOM or MediaPipe. The input sources (Requirements 3–7) and the React UI (Requirements 21–24) wrap that core; they hold the IO and the pixels.

---

## 1. Core logic modules (`packages/marrow/src/core`)

One line per module and its public functions. Every function here is pure: same inputs give same outputs, no IO, no clock, no allocation of shared state. Reducers have the shape `step(state, input, dtMs) -> { state, events }`; `dtMs` is always a clock delta supplied by the caller (Requirement 16.7, 16.8), and for the event-driven help policy `dtMs` is absent.

| Module | Public surface | Requirement | Kind |
|---|---|---|---|
| `tuning.ts` | `TUNING: Tuning`; `validateTuning(t): TuningError[]`; `formatTuningErrors(errs): string`; types `Tuning`, `TuningError` | 1 | data + pure fn |
| `geometry.ts` | types `Vec2`; `dist(a,b)`, `clamp(v,lo,hi)`, `sub/add/scale`, `lerp` | — | pure fns (internal) |
| `frame.ts` | types `Landmark`, `PoseLandmarks`, `PoseFrame`; const `LANDMARK_INDEX`; `isLandmarkValid(visibility, pos, tuning): boolean` | 2 | types + pure fn |
| `oneEuro.ts` | type `OneEuroState`; `createOneEuro(cfg)`, `oneEuroStep(state, value, dtMs)`, `oneEuroReset(state)` | 8 | pure reducer (internal) |
| `pointerFilter.ts` | types `PointerFilterState`, `PointerSample`; `createPointerFilter(tuning)`, `stepPointerFilter(state, sample, dtMs)`, `resetPointerFilter(state)` | 8 | pure reducer |
| `headView.ts` | types `HeadViewState`, `HeadViewInput`; `createHeadView()`, `stepHeadView(state, input, dtMs) -> { state, offset }` | 9 | pure reducer |
| `mapping.ts` | types `MappingParams`, `Mapping`; `makeMapping(params): Mapping` with `toScreen(cam)`, `toCamera(screen)` | 10 | pure factory |
| `comfortGrid.ts` | type `ComfortGrid`; `createGrid(tuning)`, `addSample(grid, camPos)`, `isCellValid(grid, col, row, tuning)`, `markAllValid(grid)`, `cellRectCamera(col, row, tuning)`, `validCells(grid, tuning)` | 11, 13 | pure fns |
| `calibration.ts` | types `CalibrationState`, `CalibrationConfig`, `CalibrationInput`, `CalibrationEvent`; `createCalibration(cfg)`, `stepCalibration(state, input, dtMs) -> { state, events }`, `retryCalibration(state)`, `chooseWholeScreen(state)`, `skipHeadView(state)` | 11, 12 | pure reducer |
| `reachGain.ts` | `computeComfortTransform(grids, frameAspect, playAspect, tuning) -> { centre, gain }` | 13 | pure fn |
| `placement.ts` | types `Demand`, `PlacementResult`; `placeTargets(demand, grids, mapping, tuning): PlacementResult`; `isSlotUsable(slot, grids, mapping, r, m): WristId \| null` | 14 | pure fn |
| `aura.ts` | `auraIntensity(screenPt, grids, mapping, tuning): number` | 15 | pure fn |
| `clocks.ts` | `presenceDelta(rawDtMs, { paused, hidden }, tuning): number`; `sessionDelta(presenceDt, holdActive): number`; `stepClocks(rawDtMs, { paused, hidden, holdActive }, tuning) -> { presenceDt, sessionDt }` (composes the two; tested by 16.6) | 16 | pure fns (stateless) |
| `dwell.ts` | types `DwellState`, `DwellEvent`, `HitArea`, `PointerInput`; `createDwell()`, `stepDwell(state, input) -> { state, events }`, `dwellView(state, targetId)` | 17 | pure reducer |
| `tracking.ts` | types `TrackingState`, `TrackingConfig`, `TrackingInput`, `TrackingEvent`; `createTracking(cfg)`, `stepTracking(state, input, dtMs) -> { state, events, holdActive, overlayVisible, oneWristHint }` | 18 | pure reducer |
| `help.ts` | types `HelpState`, `HelpEvent`, `HelpOutput`; `createHelp()`, `stepHelp(state, event) -> { state, outputs }`, `helpRadiusForMotorLevel(level, tuning)` | 19 | pure reducer (event) |
| `settings.ts` | types `Settings`, `MotionLevel`; `DEFAULT_SETTINGS`, `SETTINGS_VERSION`, `parseSettings(raw, env): Settings`, `serializeSettings(s): string` | 20 | pure fns |
| `index.ts` | the `marrow/core` barrel (section 6) | — | re-export |

Notes:

- `stepDwell` input is `{ dt: number; pointers: PointerInput[]; hitAreas: HitArea[] }`; `dt` is the presence delta (Requirement 17.1). It takes no `dtMs` second argument because the delta travels inside `input`.
- `stepHelp` takes an event, not a delta: the help policy has no timers (Requirement 19.1); "time" for it is the sequence of caller events.
- `oneEuro.ts` and `geometry.ts` are implementation details reached by tests through relative imports; they are not on the `marrow/core` barrel (section 6).

---

## 2. The input contract

### 2.1 `PoseFrame` (full)

Defined in `core/frame.ts` because the pure logic consumes it; the input sources produce it.

```ts
/** A point in a normalized coordinate space. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** The player's side. MediaPipe "left" landmarks belong to the player's left side, so they map to `left` (Req 2.3). */
export type WristId = 'left' | 'right';

/** One landmark in camera space (0..1, origin top-left, not mirrored: Req 2.4). */
export interface Landmark {
  /** Camera-space position; meaningful only when `valid` is true. */
  readonly pos: Vec2;
  /**
   * Whether the landmark can be used. The camera source computes it with
   * `isLandmarkValid`; the pointer and trace sources set it directly (Req 2.2, 2.5, 2.6).
   */
  readonly valid: boolean;
}

/** The five landmarks this engine uses; hips are never required (Req 2.1, 2.3). */
export interface PoseLandmarks {
  readonly leftWrist: Landmark;
  readonly rightWrist: Landmark;
  readonly nose: Landmark;
  readonly leftShoulder: Landmark;
  readonly rightShoulder: Landmark;
}

/** One frame from any source. Nothing downstream can tell which source made it (Req 3.4). */
export interface PoseFrame {
  /**
   * Source monotonic time in milliseconds. Used ONLY inside `marrow/input` and the
   * Debug Overlay (new-frame detection, inference rate, latency). No pure logic reads
   * it as a clock (Req 2.7). The pure pipeline receives time only as clock deltas.
   */
  readonly t: number;
  /** Camera frame aspect a = width / height, carried in every frame; always > 0 (Req 2.1). */
  readonly aspect: number;
  readonly landmarks: PoseLandmarks;
}

/** MediaPipe Pose Landmarker indices (Req 2.3). */
export const LANDMARK_INDEX = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
} as const;
```

`visibility` is not stored on the frame; the camera source reads it from MediaPipe, calls `isLandmarkValid(visibility, pos, TUNING)`, and keeps only the boolean (Req 2.2, 2.6). Pointer and trace sources set `valid` directly.

### 2.2 `PoseSource` (full)

Defined in `input/poseSource.ts` because it is IO, not pure logic.

```ts
/** The one outcome a start attempt reports (Req 5.2). */
export type StartOutcome = 'ready' | 'denied' | 'no-camera' | 'model-failed';

/**
 * The single input contract. Camera, pointer and trace all implement it, and game
 * code uses only these members, so it cannot tell the sources apart (Req 3.1, 3.4).
 */
export interface PoseSource {
  /** Begin producing frames. Resolves with exactly one outcome (Req 5.2). */
  start(): Promise<StartOutcome>;
  /**
   * The newest frame, or null before the first one. Never a queue: a slow consumer
   * sees only the latest frame, older frames are dropped (Req 3.2, 4.2).
   */
  latest(): PoseFrame | null;
  /** Release every resource. Safe to call more than once; later calls do nothing (Req 3.3). */
  dispose(): void;
}
```

The three implementations in `marrow/input`:

- `createCameraSource(opts): PoseSource` — MediaPipe Pose Landmarker, lite model, one pose, `VIDEO` running mode, main thread (Req 4.1). Keeps at most one frame in inference; drops video frames while one is running (Req 4.2). Starts an inference no more often than `TUNING.maxInferenceHz` (Req 4.3). Loads WASM and model from the app's own base path only (Req 4.4). Maps outcomes per Requirement 5.2–5.5; stops every track on `dispose` and closes the landmarker (Req 5.6).
- `createPointerSource(opts): PoseSource` — one primary pointer drives the right wrist; left wrist always invalid (Req 6.1). Valid only while a mouse or pen is over the play area or a touch is in contact (Req 6.2). Sets the wrist position as the inverse base mapping of the pointer so the base mapping returns it exactly (Req 6.3). Nose and both shoulders are valid at fixed synthetic positions (Req 6.4). At most one frame per animation frame (Req 6.5).
- `createTraceSource(trace): PoseSource & { advanceTo(tMs): void }` — plays an ordered list of frames; advanced only by elapsed milliseconds from the caller (Req 7.1–7.3); runs in Node with no DOM (Req 7.4); rejects a malformed trace with a readable message naming the first bad frame (Req 7.5). `advanceTo` is the only member outside `PoseSource`; it is called by tests only, so game consumers stay source-agnostic (keeps Req 3.4). `validateTrace(trace)` is exported for the loader.

The mode differences the consumer must honour (reach gain 1.0, no One Euro filter, synthetic head signal, no tracking hold) are not read from the source. They are settings the input setup passes into the pipeline (Req 3.4, 6.6–6.10), carried in the driver config below.

---

## 3. Data flow

The driver (the playground's frame loop, in the app) runs once per `requestAnimationFrame`. It reads the latest frame, advances the clocks, and threads pure state through the core reducers. Nothing in the core touches the DOM or a wall clock.

```
                 app frame driver (rAF)   rawDt from rAF timestamps; {paused, hidden} from UI
                           │
                           ▼
      ┌────────────────────────────────────────────┐
      │ STAGE 1  clocks.presenceDelta(rawDt,          │  clamp rawDt to 0..100 ms; 0 while
      │          { paused, hidden })   → presenceDt    │  paused or hidden (Req 16.2–16.4)
      └─────────────────────┬──────────────────────────┘
               presenceDt ───┤  the only time any pure logic sees; drives every reducer below
                             │
   source.latest() ─► PoseFrame ─► new-frame check (reference identity, not `t`; Req 2.7)
        │ (Req 3.2)         │
        │   HEAD VIEW       │  headView.stepHeadView(…, presenceDt) → offset ∈ [-1,1]²
        │                   │  (smoothed while nose valid, else linear ease to 0; Req 9, §9.6)
        │                   │  feeds world-view later; never touches pointers/dwell
        │                   │
        │   TRACKING        │  tracking.stepTracking(…, presenceDt) → holdActive (THIS step),
        │                   │  overlayVisible, oneWristHint (Req 18)
        │                   │        │
        │                   │        ▼
        │                   │  ┌──────────────────────────────────────────┐
        │                   │  │ STAGE 2  clocks.sessionDelta(presenceDt,    │  = 0 while holdActive,
        │                   │  │          holdActive)    → sessionDt          │  else presenceDt (Req 16.5)
        │                   │  └───────────────────┬──────────────────────────┘
        │                   │         sessionDt ───┘  no consumer in this spec; threaded on (Req 16.7)
        ▼                   ▼
   wrist landmarks   validity flags (frame.isLandmarkValid already applied by source)
        │
        ▼  on a NEW frame only, dt = presence time since last consumed frame (Req 8.2)
   pointerFilter.stepPointerFilter  (One Euro per wrist; reset after a gap: Req 8.3–8.5)
        │ camera-space filtered wrist position
        ▼
   mapping.toScreen  (base mirror once + reach gain; Req 10)
        │
        ▼
   screen-space pointer (pos + validity)
        │
        ├─► CALIBRATION (setup only)  calibration.stepCalibration(…, presenceDt)  (Req 11, 12)
        │       painting: comfortGrid.addSample on new valid-wrist frames
        │       demand check: placeTargets(...) == simultaneous ?  (only when a cell's validity changes; Req 11.11)
        │       calm hold: mean neutral nose + shoulder width
        │       on complete → reachGain.computeComfortTransform ─► {centre, gain} feeds Mapping
        │       aura.auraIntensity(...) drives the glow the player paints (Req 15)
        │
        ▼  during play, every rAF, dt = presenceDt
   dwell.stepDwell({ dt, pointers, hitAreas })  (Req 17) ─► selection events ─► playground completes a target
```

Clock usage, stated plainly (Requirement 16.7):

- The clocks run in **two stages per frame** so the session delta can see this step's hold. **Stage 1, `presenceDelta`**, depends only on `rawDt`, `paused` and `hidden`: it clamps to 0..100 ms and returns 0 while paused or hidden (Req 16.2–16.4). The presence clock drives the pointer filter, the head-view smoothing and ease-to-centre, the calibration timers and sampling, the dwell timers, and the tracking-lifecycle timers.
- Between the stages the driver runs `stepTracking` on `presenceDt`, which produces **this step's** `holdActive`. **Stage 2, `sessionDelta(presenceDt, holdActive)`**, returns 0 while `holdActive` and `presenceDt` otherwise (Req 16.5). So the session clock stops in the very step the hold begins — the step that detects >300 ms of lost tracking (Req 18.3) — which is what test 18.13 requires (`sessionDt = 0` in that step), not one frame late.
- When a hold ends (Req 18.6: continuous valid time reaches 1000 ms), `stepTracking` clears `holdActive` in that same step, so `sessionDelta` returns `presenceDt` and the session clock resumes in the step the hold ends.
- This spec has no session-timed behaviour, so no core reducer consumes `sessionDt`; the driver still computes it and threads it on so later specs (playback, travel, celebration, help timers) attach to a clock that is already correct and tested. `stepClocks` composes the two stages for a given `holdActive` and is the pure function the 16.6 property test exercises.

Per-frame ordering rules the driver follows:

- Compute `presenceDelta` first; then step the head-view and tracking branches on it; then compute `sessionDelta` from this step's `holdActive`. Dwell, tracking and head-view smoothing step every rAF on `presenceDt`, using the held pointer/validity, because render runs faster than inference (`tech.md` rule 5).
- New-frame detection uses object-reference inequality of `source.latest()`, never the timestamp, so the timestamp stays confined to `marrow/input` and the Debug Overlay (Req 2.7).
- The pointer filter and calibration sampling act only on a new consumed frame; the filter's `dtMs` is the presence time accumulated since the previous consumed frame (Req 8.2). Between inferences the last filtered pointer position and validity are held — until the stale-frame guard (§9.7) marks them invalid.

---

## 4. `tuning.ts`

One typed, frozen object holds every number this spec uses from steering (Appendix A) and every new engine number (Appendix B), except the values Appendix B marks as app values. Each key carries its own comment with one of two labels (Requirement 1.2): `tune` for values marked *(tune)* in steering and for new values from Appendix B, and the full text `rule: change only with the user's approval` for every other value. The camera request size 640 x 480 comes from `tech.md` without *(tune)* and is not in Appendix B, so `cameraWidth` and `cameraHeight` are rules. App values (camera-preview width, playground slots/targets, tone notes, master-gain cap, gain ramp) live beside the app code that uses them, checked by the playground content validator (§14.4) and the audio module, not here.

```ts
// packages/marrow/src/core/tuning.ts
// Each key carries one of two labels (Requirement 1.2):
//   tune: a starting value, adjusted with a real camera
//         (marked *(tune)* in steering, or new in Appendix B).
//   rule: change only with the user's approval
//         (every other value from steering).

export interface Tuning {
  // --- Landmark validity & One Euro filter (Req 2, 8) ---
  minVisibility: number;        // 0.5   tune   (Appendix A, invariants 1)
  oneEuroMinCutoffHz: number;   // 1.2   tune   (invariants 2)
  oneEuroBeta: number;          // 0.02  tune   (invariants 2)
  oneEuroDCutoffHz: number;     // 1.0   tune   (invariants 2)

  // --- Mapping & reach gain (Req 6, 10, 13) ---
  reachGainMin: number;         // 1.0   tune   (invariants 2; range floor)
  reachGainMax: number;         // 1.6   tune   (invariants 2; range ceil)
  reachGainSpanTarget: number;  // 0.6   tune   (Appendix B, Req 13.3)
  simulatedHeadStrength: number;// 0.3   tune   (invariants 2, Req 6.7)

  // --- Head view (Req 9) ---
  headDeadZone: number;         // 0.05  tune   (invariants 8)
  headClamp: number;            // 0.25  tune   (Appendix B, Req 9.3)
  headSmoothingTauMs: number;   // 120   tune   (Appendix B, Req 9.4)
  headEaseToCentreMs: number;   // 500   rule: change only with the user's approval (invariants 6; 0.5 s)

  // --- Calibration (Req 11, 12) ---
  calibNominalMs: number;       // 20000 tune   (invariants 3)
  calibEarliestMs: number;      // 12000 tune   (invariants 3)
  calibCapMs: number;           // 30000 tune   (invariants 3)
  calibEarlyQuietMs: number;    // 2000  tune   (Appendix B, Req 11.7)
  calmHoldMs: number;           // 2000  rule: change only with the user's approval (invariants 3)
  skipHeadViewAfterMs: number;  // 5000  rule: change only with the user's approval (invariants 3)
  calibHandHintMs: number;      // 1000  tune   (Appendix B, Req 11.12)
  gridCols: number;             // 32    tune   (invariants 3)
  gridRows: number;             // 24    tune   (invariants 3)
  cellValidSamples: number;     // 4     tune   (invariants 3)

  // --- Dwell & tracking (Req 17, 18) ---
  hitRadius: number;            // 0.09  tune   (invariants 4; range [0.07,0.13])
  hitRadiusMin: number;         // 0.07  tune   (invariants 4; range floor)
  hitRadiusMax: number;         // 0.13  tune   (invariants 4; range ceil)
  dwellMs: number;              // 1500  tune   (invariants 5)
  outsideWindowMs: number;      // 150   rule: change only with the user's approval (invariants 5)
  invalidWindowMs: number;      // 300   rule: change only with the user's approval (invariants 5)
  maxClockStepMs: number;       // 100   rule: change only with the user's approval (invariants 6)
  oneWristHintMs: number;       // 1000  rule: change only with the user's approval (invariants 6; 1 s)
  trackingHoldAfterMs: number;  // 300   rule: change only with the user's approval (invariants 6)
  trackingOverlayAfterMs: number;//1000  rule: change only with the user's approval (invariants 6; 1 s)
  trackingResumeMs: number;     // 1000  tune   (invariants 6; 1 s)

  // --- Help policy (Req 19) ---
  difficultiesBeforeHelp: number;// 2    rule: change only with the user's approval (invariants 9)
  motorRadii: readonly number[]; // [0.09,0.11,0.13] tune (Appendix B, Req 19.7)
  helpMaxLevel: number;          // 2    tune   (Appendix B, Req 19.6)

  // --- Camera & infra (Req 4, 5, 20, 25) ---
  modelLoadTimeoutMs: number;   // 20000 tune   (Appendix B, Req 5.5)
  maxInferenceHz: number;       // 20    tune   (Appendix B, Req 4.3)
  staleFrameMs: number;         // 500   tune   (Appendix B, Req 4.8)
  cameraWidth: number;          // 640   rule: change only with the user's approval (Appendix A, tech.md; not marked (tune))
  cameraHeight: number;         // 480   rule: change only with the user's approval (Appendix A, tech.md; not marked (tune))
  defaultVolume: number;        // 0.6   tune   (Appendix B, Req 20.6)
  debugRateWindowMs: number;    // 1000  tune   (Appendix B, Req 25.2)

  // --- Shared-UI minimums (Req 24) ---
  uiMinTextPx: number;          // 16    rule: change only with the user's approval (accessibility-and-copy.md)
  uiMinButtonTextPx: number;    // 18    rule: change only with the user's approval (art-and-motion.md)
  uiMinLightEaseMs: number;     // 300   rule: change only with the user's approval (accessibility-and-copy.md)
}

export const TUNING: Tuning = Object.freeze({
  minVisibility: 0.5,
  oneEuroMinCutoffHz: 1.2, oneEuroBeta: 0.02, oneEuroDCutoffHz: 1.0,
  reachGainMin: 1.0, reachGainMax: 1.6, reachGainSpanTarget: 0.6, simulatedHeadStrength: 0.3,
  headDeadZone: 0.05, headClamp: 0.25, headSmoothingTauMs: 120, headEaseToCentreMs: 500,
  calibNominalMs: 20000, calibEarliestMs: 12000, calibCapMs: 30000, calibEarlyQuietMs: 2000,
  calmHoldMs: 2000, skipHeadViewAfterMs: 5000, calibHandHintMs: 1000,
  gridCols: 32, gridRows: 24, cellValidSamples: 4,
  hitRadius: 0.09, hitRadiusMin: 0.07, hitRadiusMax: 0.13,
  dwellMs: 1500, outsideWindowMs: 150, invalidWindowMs: 300, maxClockStepMs: 100,
  oneWristHintMs: 1000, trackingHoldAfterMs: 300, trackingOverlayAfterMs: 1000, trackingResumeMs: 1000,
  difficultiesBeforeHelp: 2, motorRadii: Object.freeze([0.09, 0.11, 0.13]), helpMaxLevel: 2,
  modelLoadTimeoutMs: 20000, maxInferenceHz: 20, staleFrameMs: 500, cameraWidth: 640, cameraHeight: 480,
  defaultVolume: 0.6, debugRateWindowMs: 1000,
  uiMinTextPx: 16, uiMinButtonTextPx: 18, uiMinLightEaseMs: 300,
});
```

`Object.freeze` is shallow, so `motorRadii` is wrapped in its own `Object.freeze` above; without that the array elements would stay mutable even though the surrounding `TUNING` object is frozen.

### Validation

`validateTuning` checks each key against a declared range and runs a few cross-field checks, returning one `TuningError` per violation. `formatTuningErrors` joins them into a readable block. The playground validates `TUNING` on load and, if it fails, shows the message instead of running (Req 1.3, 1.4, 1.5). A test asserts the shipped object passes and that every key carries `tune` or the full `rule: change only with the user's approval` label (Req 1.7).

```ts
export interface TuningError {
  key: string;
  value: number;
  message: string; // e.g. "reachGainMax = 1.8 is out of range [1.0, 1.6]"
}

// Declared ranges (excerpt). Each pair is [min, max] inclusive; integers flagged.
const RANGES: Record<string, { min: number; max: number; int?: boolean }> = {
  minVisibility: { min: 0, max: 1 },
  oneEuroMinCutoffHz: { min: 0.0001, max: 10 },
  oneEuroBeta: { min: 0, max: 1 },
  reachGainMin: { min: 1.0, max: 1.6 },   // steering range (Req 1.5)
  reachGainMax: { min: 1.0, max: 1.6 },   // steering range (Req 1.5)
  hitRadius: { min: 0.07, max: 0.13 },    // steering range (Req 1.5)
  gridCols: { min: 1, max: 256, int: true },
  gridRows: { min: 1, max: 256, int: true },
  cellValidSamples: { min: 1, max: 1000, int: true },
  dwellMs: { min: 1, max: 10000 },
  maxClockStepMs: { min: 1, max: 1000 },
  headClamp: { min: 0.0001, max: 2 },
  // ... one entry per key ...
};

// Cross-field checks with readable messages:
//  calibEarliestMs <= calibNominalMs <= calibCapMs
//  reachGainMin <= reachGainMax
//  hitRadiusMin <= hitRadius <= hitRadiusMax
//  every motorRadii[i] within [hitRadiusMin, hitRadiusMax], length === helpMaxLevel + 1,
//    and motorRadii[0] === hitRadius
//  headDeadZone < headClamp
//  trackingHoldAfterMs <= trackingOverlayAfterMs
```

A non-finite or NaN value is reported as out of range. The message names the key, the value and the allowed range so a mis-set value is obvious (Req 1.3).

---

## 5. Settings store

The pure half lives in `core/settings.ts`; the storage half lives in `react/settingsStore.ts` because `localStorage` is a DOM API and the core may not touch it (`structure.md` pure zones).

- `Settings = { motion: MotionLevel; mute: boolean; volume: number; hands: 'right'|'left'|'both'|null }`, where `MotionLevel = 'full' | 'gentle' | 'reduced'`. The union is named `MotionLevel`, not `MotionSetting`, so the type does not clash with the `MotionSetting` control component exported from `marrow/react` (Req 20.1).
- `parseSettings(raw: string | null, env: { prefersReducedMotion: boolean }): Settings` — pure. Unknown version or non-JSON → all defaults; one bad field → only that field defaults (Req 20.3); never throws (Req 20.4). Default motion is `reduced` when `prefersReducedMotion` and nothing stored, else `full`; mute off; volume `TUNING.defaultVolume`; hands `null` (Req 20.6, 20.7).
- `serializeSettings(s): string` writes versioned JSON (Req 20.2).
- `react/settingsStore.ts` wraps these with a fixed key prefix supplied by the app, a subscriber list notified synchronously on change (Req 20.8), and an in-memory fallback when `localStorage` is unavailable or a write fails, with no message (Req 20.5). It never stores calibration, pose or video (Req 20.9).

---

## 6. Entry points and public surface

The app imports Marrow only through `marrow/core`, `marrow/input` and `marrow/react` (Req 28.2). `marrow/challenges` and `marrow/sim` exist in the package manifest but stay empty in this spec (out of scope). The public surface is deliberately small; tests reach internals by relative import inside the package, so they do not widen it.

### `marrow/core`

Exports — types: `Vec2`, `WristId`, `Landmark`, `PoseLandmarks`, `PoseFrame`, `PointerFilterState`, `PointerSample`, `HeadViewState`, `HeadViewInput`, `MappingParams`, `Mapping`, `ComfortGrid`, `Demand`, `PlacementResult`, `HitArea`, `PointerInput`, `DwellState`, `DwellEvent`, `TrackingState`, `TrackingConfig`, `TrackingInput`, `TrackingEvent`, `HelpState`, `HelpEvent`, `HelpOutput`, `CalibrationState`, `CalibrationConfig`, `CalibrationInput`, `CalibrationEvent`, `Settings`, `MotionLevel`, `Tuning`, `TuningError`. Constants/functions: `TUNING`, `validateTuning`, `formatTuningErrors`, `LANDMARK_INDEX`, `isLandmarkValid`, `createPointerFilter`, `stepPointerFilter`, `resetPointerFilter`, `createHeadView`, `stepHeadView`, `makeMapping`, `createGrid`, `addSample`, `isCellValid`, `markAllValid`, `computeComfortTransform`, `auraIntensity`, `placeTargets`, `isSlotUsable`, `createCalibration`, `stepCalibration`, `retryCalibration`, `chooseWholeScreen`, `skipHeadView`, `createDwell`, `stepDwell`, `dwellView`, `createTracking`, `stepTracking`, `createHelp`, `stepHelp`, `helpRadiusForMotorLevel`, `presenceDelta`, `sessionDelta`, `stepClocks`, `parseSettings`, `serializeSettings`, `DEFAULT_SETTINGS`, `SETTINGS_VERSION`.

Why these are on the barrel: the app's frame driver (§3, §14.5) calls `presenceDelta` and `sessionDelta` directly, because the two clock stages run on either side of `stepTracking`; the playground's controls call `retryCalibration`, `chooseWholeScreen` and `skipHeadView`; and the app builds the inputs and holds the states of the reducers it steps, so their input, config, event and state types are exported too. The app may import only through the entry points (Req 28.2), so anything it calls or names must be here.

**Naming rule.** No export of any entry point (`marrow/core`, `marrow/input`, `marrow/react`) may have a name that starts with `use` unless it is a React hook. React and its hooks lint rule treat every `use…` name as a hook, so a plain function with such a name, called from a click handler, would be flagged. This is why the calibration actions are `retryCalibration`, `chooseWholeScreen` and `skipHeadView`. The only `use…` exports in this spec are the hooks `useMarrowCopy` and `useSettings` in `marrow/react`.

Deliberately **not** exported: `oneEuro.ts` (the raw One Euro primitive), `geometry.ts` helpers, `cellRectCamera`/`validCells` grid internals, and every reducer's internal state fields beyond the opaque state type. Challenge and sim code (not built here). These are reachable only by relative import within `packages/marrow` and are used by the property tests as oracles.

### `marrow/input`

Exports: `PoseSource`, `StartOutcome` (types), `createCameraSource`, `createPointerSource`, `createTraceSource`, `validateTrace`, `Trace` (type). Re-exports `PoseFrame` from core for convenience.

Deliberately **not** exported: the MediaPipe wrapper, the `FilesetResolver` base-path logic, the frame-dropping scheduler, and the synthetic-landmark constants of the pointer source. The outside world sees only the three factories and the interface.

### `marrow/react`

Exports: `MarrowCopyProvider`, `useMarrowCopy`, `MarrowCopy` (type); the screens `StartScreen`, `CameraPermissionScreen`, `HandChoiceScreen`, `CalibrationScreen`, `CameraPreview`; the overlays `PauseOverlay`, `TrackingLostOverlay`; the controls `MotionSetting`, `AudioSettings`, `SimulatedInputLabel`; the `DebugOverlay`; and the settings store `createSettingsStore`, `SettingsProvider`, `useSettings`.

Deliberately **not** exported: the internal primitives (`Panel`, `Button`, `Radio`, `Slider`), the CSS-variable names (they live in the stylesheet, not the API), and any layout helper. The app composes screens and overlays; it does not reach inside them.

---

## 7. `MarrowCopy` and how the app supplies it

`MarrowCopy` is a typed object of every string `marrow/react` shows, including accessible names and debug labels (Req 21.1, 21.3). The package holds no player-facing string of its own (`structure.md`; enforced by `eslint.config.js` and `tests/dependency-graph.test.ts`).

```ts
// grouped so the wording test knows which strings are instructions (<= 8 words; Req 21.7)
export interface MarrowCopy {
  start: { title: string; start: string };   // start screen title + Start control (Req 22.1)
  camera: {
    explanation: string;            // one sentence; Req 21.5
    useCamera: string;              // "Use the camera"
    tryWithout: string;             // "Try without camera"
    deniedMessage: string;
    noCameraMessage: string;
    modelFailedMessage: string;
    retry: string;                  // "Retry"
    previewLabel: string;           // accessible name of the preview
  };
  hands: { question: string; right: string; left: string; both: string; continue: string };
  calibration: {
    wholeScreen: string;            // "Use the whole screen"
    handHint: string;
    noUsableSlot: string;
    retryCalibration: string;       // "Retry calibration"
  };
  headView: { keepInView: string; skip: string }; // "Keep your face and shoulders in view" / "Skip head view"
  tracking: { stepBackIn: string; recover: string; oneWristHint: string; pictureLabel: string }; // "Step back into view" / "Recover" / accessible name of the placeholder picture (Req 23.7)
  pause: { pause: string; resume: string; recalibrate: string; exit: string };
  settings: {
    motion: string; full: string; gentle: string; reduced: string;
    sound: string; mute: string; volume: string;
  };
  simulatedInputLabel: string;      // "Simulated input"
  debug: { fps: string; inferenceHz: string; pointerHz: string; validity: string; headOffset: string; latency: string };
  instructions: {
    painting: string;               // <= 8 words
    calmHold: string;               // <= 8 words
  };
}
```

The app fills it once in `apps/garden-of-echoes/src/copy` and passes it at the top of the tree:

```tsx
import { MarrowCopyProvider } from 'marrow/react';
import { copy } from '../copy';          // copy.marrow : MarrowCopy
<MarrowCopyProvider value={copy.marrow}>{children}</MarrowCopyProvider>;
```

Because `copy.marrow` is typed `MarrowCopy`, a missing entry is a compile error (Req 21.2). Components read strings through `useMarrowCopy()`; they never hard-code text. The fixed-wording strings use the exact steering texts (Req 21.4), and the banned-word / 8-word test runs over `src/copy` (Req 21.7).

---

## 8. Theming: `--marrow-*` custom properties

Components in `marrow/react` hold no palette or font values (Req 24.4). They read every colour, font, radius and spacing from CSS custom properties with neutral grey defaults; the app sets the real values in `src/ui` from its theme module, using only the grey ramp and `lanternWarm` as the single accent, with the fallback font stacks (Req 24.5; `art-and-motion.md` placeholder rule). Defaults below are taken from the `art-and-motion.md` grey ramp so the package renders legibly before any theme loads; the contrast test (Req 24.6) governs the final pairs.

| Property | Role | Neutral default |
|---|---|---|
| `--marrow-color-bg` | Screen background behind panels | `#0A0C14` |
| `--marrow-color-surface` | Panel fill | `#1D2130` |
| `--marrow-color-surface-2` | Raised control fill (secondary button) | `#2E3344` |
| `--marrow-color-border` | Panel and control border | `#474D61` |
| `--marrow-color-text` | Primary text | `#C9CDD8` |
| `--marrow-color-text-muted` | Secondary text | `#9AA0B2` |
| `--marrow-color-accent` | Primary button fill, selection (app → `lanternWarm`) | `#9AA0B2` |
| `--marrow-color-accent-text` | Text on the accent fill | `#0A0C14` |
| `--marrow-color-focus` | Focus ring (app → `#FFE2A0`) | `#C9CDD8` |
| `--marrow-color-aura` | Comfort-aura glow | `#6B7186` |
| `--marrow-color-progress` | Dwell ring (app → `lanternWarm`) | `#C9CDD8` |
| `--marrow-color-progress-track` | Dwell ring track | `#474D61` |
| `--marrow-color-scrim` | Dim over the scene for overlays/hold | `rgba(10,12,20,0.6)` |
| `--marrow-font-title` | Headings (app → Cormorant Garamond) | `Georgia, 'Times New Roman', serif` |
| `--marrow-font-ui` | Instructions, buttons, labels (app → Atkinson Hyperlegible) | `'Segoe UI', system-ui, sans-serif` |
| `--marrow-font-size-ui` | Body/label size | `16px` (`TUNING.uiMinTextPx`) |
| `--marrow-font-size-button` | Button text size | `18px` (`TUNING.uiMinButtonTextPx`) |
| `--marrow-font-size-instruction` | In-world instruction line | `28px` |
| `--marrow-radius-panel` | Panel corner radius | `16px` |
| `--marrow-radius-control` | Button/input corner radius | `8px` |
| `--marrow-space-xs` / `-sm` / `-md` / `-lg` / `-xl` | Spacing scale | `4px` / `8px` / `16px` / `24px` / `32px` |

The decorative title font is a fallback stack until the themed pass ships the woff2 files (Appendix D assumption 11); instructions and buttons never use a decorative font (`accessibility-and-copy.md`).

---

## 9. Key algorithm designs

### 9.1 Mapping (Req 10)

The mapping is affine with a diagonal Jacobian: a single x reflection, one uniform base scale `k = max(A/a, 1)`, then one uniform reach-gain scale `g` about the comfort centre `c`. Forward (camera → screen):

```
u   = 1 - x                                    // mirror once
s.x = A/2 + (u*a - a/2) * k                     // base
s.y = 1/2 + (y - 1/2) * k
s'  = c + g * (s - c)                            // reach gain
```

Because every step is affine and invertible, `makeMapping` returns an exact closed-form `toCamera` as well. `dMap/d(x,y) = diag(-g*k*a, g*k)`, so a screen circle is a camera-space circle after correcting for aspect — the fact the placement check relies on (9.2). In simulated-input mode `g = 1`, `c =` play-area centre (Req 10.5, 13.7), and the pointer source's inverse-base construction makes `toScreen(wrist) =` the pointer exactly (Req 6.3, 6.6).

### 9.2 Placement usability (Req 14.2)

A slot is usable by wrist `w` iff the closed screen disc of radius `r + m` around the slot, mapped to camera space, lies entirely inside the frame `[0,1]²` and inside `w`'s valid cells. The decision is exact at cell granularity:

1. Map the disc to camera space. With the diagonal Jacobian this is an axis-aligned ellipse; rescale to `(X, Y) = (x·g·k·a, y·g·k)` so it becomes a circle and grid cells stay axis-aligned rectangles.
2. If the region leaves `[0,1]²`, the slot is unusable (a point outside the frame is never covered: Req 14.2).
3. Enumerate the grid cells whose **half-open** rectangle `[col/32, (col+1)/32) × [row/24, (row+1)/24)` the circle overlaps. Overlap is **strict**: a cell counts iff the distance from the circle centre to the nearest point of that half-open rectangle is strictly less than the radius (`< r`, not `≤`), so a disc merely tangent to a cell boundary does not count as overlapping it. Half-open cells match the `min(floor(x·32), 31)` / `min(floor(y·24), 23)` indexing of Req 11.2, so a point exactly on a cell's upper or right edge belongs to the next cell. If any overlapped cell is not valid, the slot is unusable. The implementation and the §10.3 test oracle use this identical strict, half-open predicate, so tangent cases cannot disagree.
4. Otherwise usable.

This is exact because the valid region is literally a union of whole cells, so "disc ⊆ valid region" holds iff the disc overlaps no non-valid cell (step 3) and stays in frame (step 2). `placeTargets` then walks usable slots in caller order, choosing each whose expanded circle is disjoint from those already chosen, and returns `simultaneous`, `sequential` or `none` per Req 14.4–14.6. Two wrists are never combined to cover one slot (Req 14.3).

### 9.3 Dwell reducer (Req 17)

`stepDwell` holds, per supplied target, `{ owner, progressMs, outsideMs, invalidMs, used, latch }`. Each step: classify the owner as Inside / Outside / Invalid (Req 17.3); grow `progressMs` by `dt` only while Inside and only for the owner that held the target at both ends of the step (Req 17.6, 17.16); release on Outside>150 ms or cancel on Invalid>300 ms using independent timers (Req 17.7, 17.8); emit exactly one selection at 1500 ms and latch (Req 17.11); require the latch set to empty through valid-and-outside steps before re-acquisition (Req 17.12, 17.20). Ownership resolves by nearest centre, right wrist on a tie (Req 17.4). An activation-id change or a missing target drops the hold but keeps the latch (Req 17.14).

### 9.4 Tracking reducer (Req 18)

`stepTracking` tracks continuous lost time and continuous valid time on the presence clock. It begins a hold when lost time exceeds 300 ms (Req 18.3), shows the overlay after 1 s (Req 18.4), ends the hold after 1 s of continuous valid tracking (Req 18.6), and never holds while calibrating or in simulated input (Req 18.10). Losing only the nose with a wrist still valid never holds (Req 18.7); a one-wrist hint appears after 1 s (Req 18.9). The `holdActive` output feeds `clocks.sessionDelta` in the same step (section 3), so the session clock stops in the step a hold begins and resumes in the step it ends.

### 9.5 Help reducer (Req 19)

`stepHelp` is event-driven. It offers help on the second difficulty of a round (Req 19.3), and at a round boundary with ≥2 difficulties raises exactly one axis by one level, choosing the axis with more difficulties, breaking ties toward the axis not changed last, defaulting to motor for the first change (Req 19.4). A change applies only when no dwell or playback is active; otherwise it defers to the next such event (Req 19.8). Levels stay in 0..2 and never decrease (Req 19.6). "Continue with help" always reveals the current step and counts it complete (Req 19.9).

### 9.6 Head view when the nose is lost or returns (Req 9.6, 9.7)

While the nose is valid, `stepHeadView` smooths `raw` toward the target with the exponential filter of Req 9.4 (time constant `headSmoothingTauMs`). Exponential smoothing approaches 0 only asymptotically and never reaches it, so it cannot meet Req 9.6 ("`out` is exactly 0 from `headEaseToCentreMs` after the nose became invalid"). When the nose becomes invalid the reducer therefore switches from smoothing to a **linear ramp to zero**:

- At the first invalid step it records `out0 = out` (the output at the moment the nose was lost) and sets an ease timer `e = 0`.
- Each invalid step adds `presenceDt` to `e` and sets, per axis, `out = out0 * (1 - clamp(e / headEaseToCentreMs, 0, 1))`. Both axes are scaled by one shrinking factor, so `|out|` is non-increasing, the direction never flips, and `out` is exactly `(0, 0)` once `e ≥ headEaseToCentreMs` and stays there while the nose stays invalid (Req 9.6).
- When the nose becomes valid again, the reducer clears `out0`/`e` and resumes the Req 9.4 smoothing from the **current** `out` (whatever value the ramp reached), so the next output is `out + (raw - out) * (1 - exp(-presenceDt / headSmoothingTauMs))` — continuous, no jump (Req 9.7).

`skipHeadView` forces `out = (0, 0)` for the session (Req 9.8), and simulated-input mode reuses this same ramp when the pointer goes invalid (Req 6.8). `headview_output_bounded` (9.9) and the ease behaviour are exercised by `genHeadFrames` with validity gaps.

### 9.7 Stale-frame guard (Req 4.8)

Between inferences the driver holds the last pointer position and validity, and it detects a new frame only by **object-reference inequality** of `source.latest()` (§3). If the model stalls while the camera track stays open, `source.latest()` keeps returning the *same* frame object with its landmarks still valid, so no tracking hold begins and dwell keeps counting on a frozen position. Req 5.8 covers only a track that has **ended**; this guard covers a **stalled** track.

The Camera Source timestamps each inference result (timestamps are allowed inside `marrow/input`, Req 2.7). Once the newest result is older than `staleFrameMs` (500 ms) on its own monotonic clock, the source must **publish a new `PoseFrame` object** — a fresh reference, not the previous one — with every landmark invalid, and do so **once per stall**. Merely flipping a validity flag on the existing frame object is not enough: because the driver compares references, it would never observe the change and the held pointer would stay valid. When a real inference result arrives again, the source publishes it as the next new frame and validity returns. The decision is a small pure helper inside `marrow/input` — `(previous exposed frame, incoming result-or-none, elapsed since last result, tuning) → the frame to expose` — so it is deterministic and unit-testable without a camera (§10.2).

All-invalid landmarks make the pointer invalid (freezing dwell by the Invalid rule, Req 17.8) and let the tracking lifecycle begin a hold as usual (Req 18.3), so a stall is handled like lost tracking rather than a frozen valid pointer. The pointer and trace sources are unaffected (they emit a fresh frame per rAF / per advance). `staleFrameMs = 500` (approved), labelled `tune`.

---

## 10. Testing strategy

Every "FOR ALL" criterion in Requirements 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19 and 20 becomes one named fast-check test (Req 28.8). These are required, not optional: they are how invariants 1, 2, 5 and 6 are proven (Appendix C). A failing seed is kept as a regression test and recorded in `docs/bugs-found.md` (Req 28.8; `tech.md` testing rules). Component tests (Req 28.9) and Playwright paths (Req 28.10) are listed after the property tests.

### 10.1 Generators (fast-check arbitraries, in `packages/marrow/src/core/testgen.ts`, reached by relative import)

- `genDt` — frame delta, includes 0, negatives and non-finite for the clocks test; `genDtClamped` in 0..100 for reducers.
- `genVec2Camera` — camera point in `[0,1]²`, plus out-of-frame points.
- `genMappingParams` — `A` and `a` in 1.0..2.4, `g` in 1.0..1.6, `c` inside the play area (Req 10.3, 14.8).
- `genPointerPath` — a sequence of `{ pos, valid }` that enters, leaves, crosses and rests on a target, with independent validity gaps of 0..2000 ms (Req 17, 18).
- `genTwoPointerInterleaving` — two pointer tracks with independent validity and one tagged as entering the target first, for ownership properties (Req 17.19).
- `genHitAreas` — one or more targets, radii 0.07..0.13, allowed to overlap, with activation-id changes and removals (Req 17.14, 17.20).
- `genGrid` — a 32×24 comfort grid with random valid cells, **including grids with holes and several disjoint valid regions**; a paired `promote`/`demote` transformer that only adds samples or only removes a valid cell, holding gain and centre fixed (Req 14.8, 14.9).
- `genDemand` — slots in `[0,A]×[0,1]`, `N ≥ 1`, `r` in 0.07..0.13, `m` in 0..0.05 (Req 14).
- `genHeadFrames` — nose position and validity over time, with a variant that changes only the shoulder positions after calibration (Req 9.10), and head offsets reaching into and past the dead zone and clamp (Req 9.5).
- `genClockFlags` — per-step `{ paused, hidden, hold }` booleans with `genDt` (Req 16.6).
- `genHelpSession` — 1..8 rounds, `n` in 1..10, any interleaving of difficulties, step completions and "continue with help", random dwell/playback flags, motor-step-allowed true or false (Req 19).
- `genSettingsString` — arbitrary strings plus structurally near-valid JSON with one corrupted field and wrong versions (Req 20.4).

### 10.2 Property tests by name

| Test name | Requirement | Generators |
|---|---|---|
| `filter_gap_independence` | 8.5 | `genPointerPath` (with an invalid sample), two pre-gap prefixes |
| `filter_finite_outputs` | 8.6 | `genPointerPath`, `genDt` incl. 0 |
| `headview_deadzone_clamp_lipschitz` | 9.5 | `genHeadFrames` (offsets around 0.05 and 0.25) |
| `headview_output_bounded` | 9.9 | `genHeadFrames` |
| `headview_ignores_shoulders` | 9.10 | `genHeadFrames` shoulder-only variant |
| `mapping_mirrors_once` | 10.2 | `genMappingParams`, two camera points same `y` |
| `mapping_roundtrip` | 10.3 | `genMappingParams`, `genVec2Camera`, screen points |
| `calibration_cell_needs_own_samples` | 11.4 | `genPointerPath` into a grid |
| `reachgain_in_range_and_cells_stable` | 13.6 | `genGrid` |
| `placement_covers_every_point` | 14.8 | `genGrid` (holes, disjoint), `genMappingParams`, `genDemand` |
| `placement_monotone_in_cells` | 14.9 | `genGrid` + promote/demote, `genDemand` |
| `placement_simultaneous_disjoint` | 14.10 | `genGrid`, `genDemand` |
| `aura_positive_only_in_valid_cells` | 15.2 | `genGrid`, screen points |
| `clocks_delta_bounds` | 16.6 | `genDt` (incl. negative/NaN), `genClockFlags` |
| `dwell_progress_only_owner_inside` | 17.16 | `genPointerPath`, `genHitAreas`, `genDtClamped` |
| `dwell_select_sums_inside_time` | 17.17 | `genPointerPath`, `genHitAreas` |
| `dwell_select_requires_valid_inside` | 17.18 | `genPointerPath`, `genHitAreas` |
| `dwell_owner_isolated_from_other_pointer` | 17.19 | `genTwoPointerInterleaving` |
| `dwell_reentry_between_selections` | 17.20 | `genPointerPath`, activation changes |
| `dwell_release_timers_exact` | 17.21 | `genPointerPath` with tuned Outside/Invalid stints |
| `dwell_bounded_stints_never_release` | 17.22 | `genPointerPath` with stints ≤150 / ≤300 ms |
| `tracking_head_only_loss_harmless` | 18.12 | `genHeadFrames` (nose arbitrary, a wrist always valid) |
| `tracking_hold_timing_and_session_clock` | 18.13 | per-wrist validity gaps, `genClockFlags` |
| `tracking_resume_needs_full_second` | 18.14 | valid stretches shorter and longer than 1 s |
| `help_at_most_one_axis_per_event` | 19.11 | `genHelpSession` |
| `help_completes_in_bounded_steps` | 19.12 | `genHelpSession` |
| `help_at_most_four_changes` | 19.13 | `genHelpSession` |
| `settings_parse_never_throws` | 20.4 | `genSettingsString` |

Besides the property tests, one named example test covers the stale-frame guard (Req 4.8); it is behavioural, not a FOR-ALL property:

- `stale_frame_emits_new_invalid_frame` (Req 4.8) — drives the Camera Source's stale-guard helper (§9.7) with a scripted trace of inference results and elapsed times. Valid results arrive; then they stop and, once elapsed exceeds `staleFrameMs`, the source exposes a **new** `PoseFrame` object (a different reference) with every landmark invalid, exactly once for the stall; then a fresh result is scripted and the source exposes another new frame with validity restored. It asserts both the all-invalid landmarks and the reference change, because the driver detects new frames by reference (§3).

### 10.3 How `placement_covers_every_point` (14.8) and `placement_monotone_in_cells` (14.9) check coverage

The phrase to verify is "every screen point within `r + m` of the slot lies in a valid cell" (Req 14.2, 14.8). The test uses two layers, and only the first decides pass/fail.

**Exact, cell level (sound and complete).** The comfort region is exactly a union of whole grid cells, so coverage of the continuous disc reduces to a finite check. For each slot returned in a `simultaneous` or `sequential` result, the test re-derives usability independently of the implementation: it maps the disc of radius `r + m` to camera space (an axis-aligned ellipse; rescaled to a circle as in 9.2), then

- asserts the region lies inside `[0,1]²` (else an uncovered out-of-frame point would exist), and
- enumerates every grid cell whose rectangle overlaps the region using the **same strict, half-open** circle–rectangle predicate as the implementation (§9.2) — the distance from the centre to the nearest point of the half-open cell rectangle strictly less than the radius — and asserts each overlapped cell is valid for the owning wrist. Because the oracle and the implementation share this exact predicate (strict `<`, half-open cells matching the floor/min indexing of Req 11.2), a tangent cell can never be classified one way by the implementation and the other by the oracle.

This is enough on its own: because valid cells are whole rectangles, "disc ⊆ union of valid cells" is logically equivalent to "the disc overlaps no non-valid cell and stays in frame". There are at most 32×24 cells and the disc meets only a handful, so the finite enumeration leaves no part of the continuum unchecked. No sampling tolerance enters the verdict. The same exact predicate, run on the generated grid, also gives the test the ground-truth usable set, which it compares against what `placeTargets` chose.

**Sampled, boundary and interior (corroboration only).** As an independent oracle against a wrong overlap predicate, the test also samples many points on the circle boundary and on an interior lattice, maps each back with `toCamera`, and asserts each lands in a valid cell. Boundary points are the most informative because the disc is convex and the valid region is a union of rectangles, so the first coverage failure as the disc grows always shows on the boundary; the interior lattice guards the case where a whole invalid cell sits inside a large disc without crossing the boundary (possible when `r + m` spans more than a cell). Sampling can only ever find a counterexample, never prove coverage, which is exactly why it is the secondary layer: the cell-level enumeration is what proves the invariant, and the samples cross-check that the two formulations agree.

For `placement_monotone_in_cells` (14.9) no geometry sampling is needed. Usability is monotone in the valid-cell set: more valid cells can only cover more. The test fixes gain and centre, computes each slot's usability, then (a) applies `promote` (add samples, only ever turning cells valid) and asserts no slot flips usable→unusable, and (b) applies `demote` (remove one valid cell) and asserts no slot flips unusable→usable. Holding gain and centre fixed is essential, because recomputing them from the changed grid would move the mapping; the property is about the cell set alone.

### 10.4 Component and end-to-end tests

Component tests (Req 28.9), run under jsdom with Testing Library: each setup screen and overlay renders its `MarrowCopy` strings and real controls; the Settings Store round-trips and falls back in memory; the Debug Overlay takes no focus and changes no state; and an explicit test asserts "Use the whole screen" is never rendered in camera mode. A contrast test computes the WCAG ratio of every text/background pair the Setup UI and Playground use and asserts ≥ 4.5:1 (Req 24.6), with no extra dependency (the ratio is a small pure helper).

Playwright, simulated input only (Req 28.10): paint with the mouse to end calibration and complete a round of three targets, both through normal calibration and through "Use the whole screen"; open Pause with Escape and close with Resume; assert the camera is never requested on the simulated path; assert the page without `playground=1` is unchanged.

---

## 11. MediaPipe on the main thread, and the worker risk

This spec runs Pose Landmarker on the main thread behind `PoseSource` (Req 4.1; `tech.md` rule 6; `performance-budget.md`). A Web Worker is explicitly Stretch item 6 in `product.md`, taken only if measured render falls below budget and only after asking the user.

Known risks of moving MediaPipe into a worker, which is why it stays out of this spec:

- **GL/WASM context in a worker.** Tasks Vision uses WebGL (and optionally WebGPU) for the GPU delegate. In a worker this requires `OffscreenCanvas` and a worker-side GL context, whose support and performance vary across Chrome/Edge versions; a silent fall back to the CPU delegate is slower, which would quietly miss the 15–20 Hz target.
- **Per-frame transfer.** Video frames must cross the worker boundary as `ImageBitmap`/`VideoFrame` transfers. That adds cost and makes the "keep only the latest frame, drop the rest" rule (Req 4.2, `tech.md` rule 5) harder to hold: an async `postMessage` queue is exactly the queue the rule forbids, so correct back-pressure has to be rebuilt by hand.
- **Lifecycle and debugging.** Permission, track-ended and dispose handling (Req 5) straddle two threads; stepping through a failure is harder; and it does not remove main-thread work, since drawing still happens there.
- **Low upside at this size.** One lite model at ≤20 Hz is light; the measured render rate decides whether the move is worth it, not a guess.

Because `PoseSource` hides the source entirely (Req 3.4), a future worker implementation is a new factory in `marrow/input` with the same interface. No consumer, no pure logic and no test changes when it arrives — the decision stays measurement-driven and reversible.

---

## 12. Dependencies to approve (nothing installed)

Per Requirements 4.4, 4.5, 28.5 and 28.6 and `tech.md` ("Pin exact versions ... Do not upgrade or add a dependency without asking the user first"), these are proposed for approval in chat. Versions and licences were read from the npm registry on 2026-11-16; pin them exactly at install (`tech.md`). Licences will also be recorded in `docs/licenses.md` on install, and each vendored runtime file with its source URL, download date, licence and SHA-256 (Req 4.5, 28.11).

### 12.1 MediaPipe (runtime, `packages/marrow` dependency)

- **`@mediapipe/tasks-vision` 1.2.3** — licence **Apache-2.0**. Imported only in `packages/marrow/src/input` (`structure.md`, Req 28.3). The npm package provides the JS API, the type definitions and the WASM files (`vision_wasm_internal.{js,wasm}`, `vision_wasm_module_internal.{js,wasm}`). No peer dependencies.
- **Pose model `pose_landmarker_lite.task`** (float16) — not shipped on npm; downloaded from Google's model storage (`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`). The WASM files and this model are copied into `apps/garden-of-echoes/public/mediapipe/` and served from `BASE_PATH`, never a third-party host (Req 4.4). The model's exact licence string is read from Google's model card at download and recorded with the SHA-256 in `docs/licenses.md` before use.

### 12.2 Component-test packages (dev, root `devDependencies`)

All MIT, compatible with the installed React 19.3.1 and Node 24.17 / `.nvmrc` 24.

| Package | Version | Licence | Why / peer dependencies |
|---|---|---|---|
| `@testing-library/react` | 16.3.3 | MIT | Render and query React components (Req 28.9). Peers: `react` ^18‖^19 and `react-dom` ^18‖^19 (satisfied by 19.3.1); `@types/react`/`@types/react-dom` (optional, satisfied by 19.3.0); **requires `@testing-library/dom` ^10** as a peer, so it is added explicitly below. Bundles `@babel/runtime` (MIT). |
| `@testing-library/dom` | 10.4.2 | MIT | The required peer of the two libraries above; the core query engine. Pulls `aria-query`, `dom-accessibility-api`, `lz-string`, `pretty-format`, `@babel/*` — all MIT. |
| `@testing-library/user-event` | 14.6.12 | MIT | Realistic click/type/keyboard for the accessibility tests (Req 24.1). Peer: `@testing-library/dom` >=7.21.4 (satisfied). |
| `@testing-library/jest-dom` | 7.0.1 | MIT | DOM matchers (`toBeVisible`, `toHaveAccessibleName`) via Vitest's `expect.extend`. Peers: `vitest` >=0.32 (optional; satisfied) and `@testing-library/dom` >=10 <11. Engines: node >=22 (satisfied). |
| `jsdom` | 31.0.1 | MIT | The DOM environment for component tests, selected per file with a `// @vitest-environment jsdom` docblock so the pure Node tests keep running under `environment: 'node'`. Engines: node ^22.22.2 ‖ ^24.15.0 ‖ >=26 (Node 24.17 satisfies). Optional peer `@napi-rs/canvas` is not needed (component tests touch DOM, not canvas; canvas paths are covered by Playwright in a real browser). |

`happy-dom` 21.0.4 (MIT) is the lighter alternative; jsdom is proposed instead for its maturity and closer standards coverage. No component-test package requires a change to the dependency zones, and test files stay inside the rules of `eslint.config.js` and `tests/dependency-graph.test.ts` (Req 28.7). The Vitest config gains a setup file that registers the jest-dom matchers; the default environment stays `node`.

---

## 13. Questions I could not fully settle, and the assumption made for each

The eleven open choices already listed in Appendix D of `requirements.md` are approved and are not repeated here. These are design-level questions the requirements and the answers do not pin down; each can be revised before or during tasks.

1. **New-frame detection without the timestamp.** Requirement 2.7 confines the frame timestamp to `marrow/input` and the Debug Overlay. *Assumption:* the app frame driver detects a new frame by object-reference inequality of `source.latest()`, not by reading `t`, so pure logic still never sees a wall clock.
2. **Frame carries only the boolean `valid`, not `visibility`.** *Assumption:* the camera source computes `valid` with `isLandmarkValid` and discards the raw visibility; the Debug Overlay shows validity, which is all Requirement 25.2 asks for.
3. **`TraceSource.advanceTo` sits outside `PoseSource`.** The interface must stay uniform (Req 3.4) yet traces are advanced by elapsed ms (Req 7.1). *Assumption:* `PoseSource` stays `{ start, latest, dispose }`; `TraceSource` adds `advanceTo`, used only by tests, so game consumers remain source-agnostic.
4. **Head-x mirror convention.** Requirement 9.2 wants head-right → `d.x > 0`. *Assumption:* apply the same single mirror as the base mapping (`u = 1 - x`) to the nose before computing `d.x`; `y` grows downward with no mirror. One mirroring convention across the engine.
5. **When the comfort transform feeds the mapping.** *Assumption:* during painting, samples are indexed in raw camera space (Req 11.2), independent of gain; gain and centre are computed once at calibration completion (Req 12.8, 13) and used by the Mapping during play; the demand check (Req 11.11) recomputes the transform from the current grids on each check.
6. **Dwell tie-break metric.** *Assumption:* "nearest the centre" (Req 17.4) uses Euclidean screen-space distance; an exact tie resolves to the right wrist, as the requirement states.
7. **Session clock has no consumer in this spec.** *Assumption:* `stepClocks` still produces `sessionDt` and the driver threads it, so later specs attach timed behaviour to an already-tested clock; `clocks_delta_bounds` tests both deltas now.
8. **Aura falloff shape.** Requirement 15 fixes only that intensity is > 0 solely inside valid cells (15.2) and softens inward (15.4). *Assumption:* intensity is a per-cell value with a monotone inward falloff (zero on and outside the valid-region edge), the exact curve left as a visual tuning detail the `aura_positive_only_in_valid_cells` test constrains.
9. **Component-test DOM environment.** *Assumption:* jsdom 31, not happy-dom, for maturity; chosen per-file so the pure Node suite is untouched.
10. **Pose model variant and source.** *Assumption:* `pose_landmarker_lite.task` float16 from Google's model storage, vendored under the app's public path, with licence and SHA-256 recorded at vendor time (Req 4.5, 28.11); the exact licence string is confirmed from the model card then, not assumed here.

---

## 14. Playground and setup flow

The playground (`apps/garden-of-echoes/src/dev`, reachable only with `?playground=1`, Req 26.1) is the one consumer that wires the core and the sources together in this spec. It is a lazily loaded chunk (Req 26.2) and runs the same code after the `PoseSource` in camera and simulated-input modes (Req 26.11).

### 14.1 Setup flow state machine

A pure reducer in `src/dev/setupFlow.ts` holds the current screen; React renders it and the driver reads it. States and transitions (Req 22, 23):

```
 START ──Start──► CAMERA_PERMISSION ──"Use the camera"──► (CameraSource.start)
   │                    │                                      │ ready                 │ denied / no-camera / model-failed
   │                    │ "Try without camera"                 ▼                       ▼
   │                    └───────────────────────────►  HAND_CHOICE               CAMERA_ERROR(outcome)
   │                      (simulated: skipped; PointerSource)   │ Continue            │ Retry ──► request again
   │                                                            ▼                     │ "Try without camera"
   │                                                        CALIBRATING ◄─────────────┘   └─► CALIBRATING (pointer)
   │                                   Placement result: simultaneous / sequential │ none
   │                                                            ▼                    ▼
   │                                                           PLAY             NO_USABLE_SLOT
   │                                                                            │ "Retry calibration" ──► CALIBRATING
   │                                                                            │ "Try without camera" (camera mode)
   │                                                                            │ "Use the whole screen" (sim mode)
   └─ Exit from Pause ─────────────────────────────────────────────────────────────────────────────► START

 Suspension flags on top of the active state (they never change which state is active — Req 18.11):
   • PAUSE  — Escape from any post-START screen opens it; Escape/Resume closes. Offers Resume, Recalibrate
     (→ HAND_CHOICE in camera mode, → CALIBRATING in simulated), motion, mute, volume, Exit (Req 23.1–23.6).
   • TRACKING_LOST — shown by the tracking lifecycle during a hold (Req 18.4, 23.7). Offers Recover (dispose +
     restart CameraSource from the click, keep calibration; a non-ready outcome → CAMERA_ERROR), "Try without
     camera" (→ CALIBRATING with PointerSource), Exit (Req 23.8, 23.9). The play area is dimmed, targets held.
```

Simulated-input mode (Req 6.10, 22): START → "Try without camera" → CALIBRATING with the PointerSource — hand choice skipped, no camera request, no preview — with the "Simulated input" label on every screen and "Use the whole screen" available throughout calibration and on the no-usable-slot screen.

### 14.2 Calibration config carries the demand

`createCalibration(cfg)` takes `cfg = { activeWrists, mode, demand, frameAspect, playAspect }`, where `demand = { slots, n, r, m }` is exactly what Placement needs for the end-of-painting check (Req 11.11): the playground's slots after the play-area filter below, `n = 3`, `r = TUNING.hitRadius`, `m = 0` (Req 26.4).

**Play-area slot filter.** Placement checks only camera coverage, so a slot whose hit circle reaches past the edge of the current window could still count as usable. The app therefore keeps only slots whose circle of radius `r + m` lies inside the play area `[0, A] × [0, 1]`, with `A` the current play-area aspect. It applies this filter once per use: to the demand it passes to `createCalibration`, and again for every round (§14.3). Filtering the calibration demand the same way as the rounds means calibration cannot decide the demand is met when play would then find fewer usable slots. The filter lives in the app (`src/dev/roundController.ts`), not in the core, because the slots are app content. `stepCalibration` runs that check — `placeTargets(demand, grids, transform-from-current-grids) === 'simultaneous'` — **only in a step in which a cell's validity changed** (a cell just reached `cellValidSamples`), not every frame, because the demand result can change only when the valid-cell set changes. That keeps painting cheap and the early-finish timing (Req 11.6, 11.7) deterministic. On completion the playground re-runs Placement with the final grids to pick `simultaneous` / `sequential` / `none` (Req 26.4).

### 14.3 Round logic and slot rotation (Req 26.10)

The playground keeps a rotation cursor over the slot list. Every round, including the first after calibration, does the same three things:

1. Filter the slots to the current play area (§14.2), with the current play-area aspect.
2. Rotate the filtered list so it starts at the cursor, wrapping.
3. Call `placeTargets` with that list, `n = 3`, `r = TUNING.hitRadius`, `m = 0`, the final grids and the play Mapping.

So every round gets the one-pass overlap check of Req 14.4, and its `simultaneous` targets are pairwise disjoint (Req 14.10). Each target gets a fresh activation id. After the round the cursor moves past the slots it used, so when enough usable slots exist, consecutive rounds use different slots (Req 26.10). A `sequential` result shows target `i` alone in usable slot `i mod k` (Req 14.5). A `none` result leads to the no-usable-slot screen (Req 22.8). A completed target is shown with a changed shape as well as colour and plays its own tone, then stops being supplied to the Dwell Engine (Req 26.9, 24.8).

### 14.4 Content JSON and its validator (Req 26.3)

`src/dev/playground-content.json` holds the candidate slots (15, in order) and the target count (3). At load it is checked by a small hand-written typed validator in `src/dev/playgroundContent.ts`, which fails with a readable message that names the first bad field. There is no JSON Schema file and no validator dependency, so the format is defined in one place, the validator:

```jsonc
{
  "targetCount": 3,              // integer >= 1
  "slots": [                     // in order; screen space (x in 0..A, y in 0..1)
    { "x": 0.45, "y": 0.35 }
    // ... 14 more ...
  ]
}
```

Rules the validator checks: `targetCount` an integer ≥ 1; `slots` an array of 1..64 objects, each with numeric `x ≥ 0` and `y` in `0..1`; both required; no additional properties. Example error: `playground-content.json: slots[7].y = 1.4 is out of range [0, 1]`.

### 14.5 File layout for this spec

```
apps/garden-of-echoes/src/
  dev/     playground.tsx (lazy chunk, ?playground=1), setupFlow.ts (pure state machine),
           roundController.ts (play-area slot filter, rotation, placeTargets per round,
           activation ids), frameDriver.ts (the rAF loop of §3: clocks, source, reducers),
           playground-content.json, playgroundContent.ts (its hand-written validator),
           and the Debug Overlay wiring (Req 25)
           The playground disposes the Camera Source on Exit, on switching to simulated input,
           on unmount and on the `pagehide` event (Req 5.7). A tab switch only sets the hidden
           flag (Req 16.3); the camera stays open and play resumes as Req 8.4 describes.
  audio/   tonePlayer.ts (Web Audio: AudioContext created from the Start handler; C5/E5/G5 sine
           ~400 ms; master gain = volume × 0.5; 100 ms ramps; Req 27)
  copy/    index.ts — the app's copy, including `marrow: MarrowCopy` and the playground's own
           strings (Req 21.2, 26.12); the banned-word / 8-word test runs over this folder (Req 21.7)
  ui/      theme.css (the `--marrow-*` values of §8: grey ramp + lanternWarm accent) and a small
           provider that sets them; no logic
```

The app-side tuning values (camera-preview max width 320 px; the 15 slots and target count; the C5/E5/G5 tones; master-gain cap 0.5; gain ramp 100 ms) live beside this code, not in `marrow`'s `tuning.ts` (Appendix B app values).
