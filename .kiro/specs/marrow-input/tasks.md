# Implementation Plan

## Overview

This plan builds the marrow-input spec in an order where each task starts from finished, tested work. Requirement numbers refer to `requirements.md`; section numbers refer to `design.md`.

Rules for every task:

- A task is done only when `npm run typecheck`, `npm run lint` and `npm test` pass, plus `npm run test:e2e` for tasks that change UI (Req 28.12). Each task repeats its own line.
- Every test in this plan is required, including every property test. None is optional. A failing fast-check seed is kept as a regression test and recorded in `docs/bugs-found.md` (Req 28.8).
- Tests read numbers from `TUNING`, never from literals. Property tests use the generators in `packages/marrow/src/core/testgen.ts`, reached by relative import (design §10.1).
- Each core task adds its public names to the `marrow/core` barrel (design §6). Internals stay off the barrel.
- No lint exception, no weakened rule in `eslint.config.js` or `tests/dependency-graph.test.ts` (Req 28.7), and no new dependency.

## Tasks

- [x] 1. Tuning module and validation
  - Create `packages/marrow/src/core/tuning.ts` with the `Tuning` interface and the frozen `TUNING` object of design §4: every Appendix A value and every Appendix B engine value, but not the Appendix B app values. Freeze `motorRadii` on its own.
  - Comment each key `tune` (steering *(tune)* values and Appendix B values) or `rule: change only with the user's approval` (every other value, including `cameraWidth` and `cameraHeight`; design §4).
  - Implement `validateTuning(t): TuningError[]` with one declared range per key, integer checks for grid sizes and counts, the steering ranges of Req 1.5 (hit radius 0.07-0.13, reach gain 1.0-1.6), non-finite values reported as out of range, and the cross-field checks of design §4. `formatTuningErrors` names the key, the value and the allowed range.
  - Export `TUNING`, `validateTuning`, `formatTuningErrors`, `Tuning` and `TuningError` from `marrow/core`. From this task on, core logic reads every steering and Appendix B number from the tuning object (Req 1.6).
  - Tests: `tuning_shipped_valid_and_labelled` (Req 1.7: the shipped object passes validation, and every key of the interface carries a `tune` or full `rule` comment, read from the source text); validation tests for each steering range edge, a NaN value and each cross-field check, including the message text.
  - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7_

- [x] 2. Frame types, landmark validity and geometry
  - Create `core/geometry.ts` (internal, not on the barrel): `Vec2` helpers `dist`, `clamp`, `add`, `sub`, `scale`, `lerp`.
  - Create `core/frame.ts` with the types of design §2.1 (`Vec2` defined once and shared with `geometry.ts`, `WristId`, `Landmark`, `PoseLandmarks`, `PoseFrame` with `t`, `aspect` and five camera-space landmarks that are not mirrored), `LANDMARK_INDEX`, and `isLandmarkValid(visibility, pos, tuning)`: valid if and only if visibility >= `minVisibility` and 0 <= x <= 1 and 0 <= y <= 1; NaN is invalid.
  - Export the frame types, `LANDMARK_INDEX` and `isLandmarkValid` from `marrow/core`.
  - Tests: `isLandmarkValid` at visibility exactly `minVisibility` and just below it, at x and y exactly 0 and 1 and just outside, and with NaN; the geometry helpers.
  - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
  - _Requirements: 2.1, 2.2, 2.4, 2.5_

- [x] 3. Presence and session clocks
  - Create `core/clocks.ts`: `presenceDelta(rawDtMs, { paused, hidden }, tuning)` treats a negative or non-finite delta as 0, clamps to `maxClockStepMs`, and returns 0 while paused or hidden; `sessionDelta(presenceDt, holdActive)` returns 0 during a hold and `presenceDt` otherwise; `stepClocks(rawDtMs, { paused, hidden, holdActive }, tuning)` composes the two (design §3).
  - Export all three from `marrow/core` (design §6).
  - Start `core/testgen.ts` with `genDt` (including 0, negative and non-finite values), `genDtClamped` (0..100) and `genClockFlags`.
  - Named tests (design §10.2): `clocks_delta_bounds` (16.6).
  - Other tests: one test each for 16.2, 16.3, 16.4 and 16.5; `core_no_wall_clock` in `tests/` (16.8), which scans every non-test file under `packages/marrow/src/core` and fails on `Date.now`, `performance.now`, `setTimeout`, `setInterval` or `requestAnimationFrame`.
  - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.8_

- [x] 4. Pointer filter
  - Create `core/oneEuro.ts` (internal): `createOneEuro(cfg)`, `oneEuroStep(state, value, dtMs)`, `oneEuroReset(state)`. A delta of 0 leaves the output unchanged and never divides by zero.
  - Create `core/pointerFilter.ts`: one One Euro filter per active wrist with `oneEuroMinCutoffHz`, `oneEuroBeta` and `oneEuroDCutoffHz`; `stepPointerFilter(state, sample, dtMs)` takes the per-wrist samples of one consumed frame and the presence time since the previous consumed frame, both supplied by the caller; a wrist that turns valid after being invalid resets its filter and outputs the sample unchanged; `resetPointerFilter(state)` for resume after Pause or a hidden tab. An invalid wrist yields an invalid pointer with no position, so no logic can read its last filtered position.
  - Export `createPointerFilter`, `stepPointerFilter`, `resetPointerFilter` and `PointerFilterState` from `marrow/core`.
  - Add `genPointerPath` to `testgen.ts`: positions with validity gaps of 0..2000 ms and deltas 0..100, including 0.
  - Named tests (design §10.2): `filter_gap_independence` (8.5), `filter_finite_outputs` (8.6).
  - Other tests: the first valid sample after a gap is output unchanged (8.3); reset gives the same (8.4); an invalid wrist exposes no position (8.7).
  - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [x] 5. Camera-to-screen mapping
  - Create `core/mapping.ts`: `MappingParams` (play aspect A, frame aspect a, gain g, centre c) and `makeMapping(params)` returning `toScreen` (mirror once, base scale k = max(A/a, 1), reach gain about c) and the exact closed-form inverse `toCamera` (design §9.1). This is the only conversion between camera space and screen space; the Pointer Source uses it too.
  - Export `makeMapping`, `MappingParams` and `Mapping` from `marrow/core`.
  - Add `genMappingParams` (A and a in 1.0..2.4, g in 1.0..1.6, c inside the play area), `genVec2Camera` (including out-of-frame points) and a screen-point generator to `testgen.ts`.
  - Named tests (design §10.2): `mapping_mirrors_once` (10.2), `mapping_roundtrip` (10.3).
  - Other tests: at gain 1 the camera image covers the play area for A >= a and for A < a; with a = A and gain 1, the point x = 1 - s.x / A, y = s.y maps exactly to s (the construction of Req 6.3).
  - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
  - _Requirements: 10.1, 10.2, 10.3_

- [x] 6. Comfort grid and reach gain
  - [x] 6.1 Comfort grid
    - Create `core/comfortGrid.ts`: `createGrid(tuning)` (`gridCols` x `gridRows` sample counts), `addSample(grid, camPos)` into column min(floor(x * cols), cols - 1) and row min(floor(y * rows), rows - 1), `isCellValid` (at least `cellValidSamples`), `markAllValid`, and the internal `cellRectCamera` (half-open rectangles, design §9.2) and `validCells`. Grids are never mutated; every change returns a new grid.
    - Export `createGrid`, `addSample`, `isCellValid`, `markAllValid` and `ComfortGrid` from `marrow/core`, but not `cellRectCamera` or `validCells`.
    - Tests: x = 1 and y = 1 fall in the last cell; a point on a cell's upper or right edge belongs to the next cell; 3 samples leave a cell invalid and 4 make it valid; `markAllValid`; inputs are unchanged after each call.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 11.1, 11.2, 11.3_
  - [x] 6.2 Comfort centre and reach gain
    - Create `core/reachGain.ts`: `computeComfortTransform(grids, frameAspect, playAspect, tuning)` returns the centre as the mean of the base-mapped centres of all valid cells of all active wrists, each cell counted once per wrist; span as the larger side of the gain-1 screen bounding box of the valid cells taken as whole rectangles; gain = clamp(`reachGainSpanTarget` / span, `reachGainMin`, `reachGainMax`); and, with no valid cell, gain 1 and the play-area centre. Gain 1 is the identity scale, written as a named constant and not read from `reachGainMin`. The bounding box only sizes the gain.
    - Export `computeComfortTransform` from `marrow/core`.
    - Add `genGrid` (32 x 24 grids with holes and several separate valid regions) with the `promote` and `demote` transformers to `testgen.ts`.
    - Named tests (design §10.2): `reachgain_in_range_and_cells_stable` (13.6).
    - Other tests: worked examples for one valid cell, two separate regions, an empty grid, and a span small enough to hit the gain cap.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

- [x] 7. Placement in the comfort region
  - [x] 7.1 Slot usability and placement
    - Create `core/placement.ts` with `Demand` (slots in order, n, r, m) and `PlacementResult` (`simultaneous`, `sequential`, `none`).
    - `isSlotUsable(slot, grids, mapping, r, m, tuning): WristId | null` uses the test of design §9.2: map the disc of radius r + m to camera space and rescale it to a circle; the slot is unusable if the disc leaves the closed camera frame or meets a non-valid cell (closed test: the distance to the cell's closed rectangle at most the radius). Each wrist is checked alone, never combined with the other.
    - `placeTargets(demand, grids, mapping, tuning)` makes one pass over the usable slots in caller order and chooses each slot whose expanded circle overlaps no chosen one. N chosen gives `simultaneous`; fewer gives `sequential` with all usable slots in caller order (target i alone in usable slot i mod k); no usable slot gives `none`. It never changes a grid.
    - Export `placeTargets`, `isSlotUsable`, `Demand` and `PlacementResult` from `marrow/core`.
    - Tests with hand-built grids: a slot covered only by the two wrists together is unusable; overlapping slots are skipped in the pass; `sequential` order and the i mod k rule; `none`; a disc that leaves the frame; grids are deep-equal before and after.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_
  - [x] 7.2 Placement property tests
    - Add `genDemand` to `testgen.ts`: slots in [0, A] x [0, 1], N >= 1, r in 0.07..0.13, m in 0..0.05.
    - Named tests (design §10.2): `placement_covers_every_point` (14.8), using the two layers of design §10.3: an exact cell-level oracle, written separately from `isSlotUsable` with the same closed predicate, decides the result, and boundary and interior points mapped with `toCamera` corroborate it; `placement_monotone_in_cells` (14.9), with `promote` and `demote` at a fixed gain and centre; `placement_simultaneous_disjoint` (14.10).
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 14.8, 14.9, 14.10, 28.8_

- [x] 8. Comfort aura
  - Create `core/aura.ts`: `auraIntensity(screenPt, grids, mapping, tuning)` in 0..1. It is above 0 only where `toCamera(screenPt)` lies inside the frame and in a valid cell of an active wrist; cells with 1 to 3 samples give 0; it softens only inwards, for example from the share of valid cells among a cell's neighbours (design §13 question 8). If the curve needs a new number, it goes into `tuning.ts` and Appendix B only with the user's approval.
  - Export `auraIntensity` from `marrow/core`.
  - Named tests (design §10.2): `aura_positive_only_in_valid_cells` (15.2).
  - Other tests: cells with 1 to 3 samples give 0 (15.3); every point outside the valid region gives 0, and an edge cell is never brighter than an interior cell (15.4).
  - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
  - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [x] 9. Calibration
  - [x] 9.1 Painting phase
    - Create `core/calibration.ts`: `createCalibration(cfg)` with `cfg = { activeWrists, mode, demand, frameAspect, playAspect }`, where the app has already filtered the demand's slots to the play area (design §14.2), and `stepCalibration(state, input, dtMs)`. The input holds, per active wrist, the validity and the filtered camera-space position, whether this step consumed a new frame, and the head landmarks for the calm hold.
    - Painting: one empty grid per active wrist at the start; one sample per consumed frame for each valid active wrist; painting time on the presence clock, counted only in steps with a valid active wrist; the end rules at 20 s with the demand met, from 12 s with the demand met and no new valid cell for `calibEarlyQuietMs`, and at the 30 s cap; never before 12 s except through `chooseWholeScreen`; no samples after the end.
    - Demand check: `placeTargets` with the transform from `computeComfortTransform` on the current grids, run only in steps where a cell's validity changed (design §14.2). In simulated-input mode the transform is gain 1 and the play-area centre.
    - A hand-hint flag for the UI after `calibHandHintMs` without a valid active wrist, in camera mode only.
    - `retryCalibration(state)` clears every grid, the head data and every timer and restarts painting; `chooseWholeScreen(state)` marks every cell of the pointer's grid valid and completes at once, skipping the calm hold (design §1, §6).
    - Export `createCalibration`, `stepCalibration`, `retryCalibration`, `chooseWholeScreen`, `CalibrationState` and the input and event types from `marrow/core`.
    - Named tests (design §10.2): `calibration_cell_needs_own_samples` (11.4), driven through `stepCalibration` with valid and invalid frames and compared with an independent per-cell count.
    - Other tests: scripted sequences for each end rule at its exact boundary; time counted only with a valid wrist; no samples after the end; the demand check runs only when validity changes; `retryCalibration`; `chooseWholeScreen`; the hand-hint flag.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 11.15, 13.7_
  - [x] 9.2 Calm hold, "Skip head view" and completion
    - The calm hold starts when painting ends other than through `chooseWholeScreen`. It completes after `calmHoldMs` of continuous presence time in which the nose and both shoulders are valid in every consumed frame; an invalid one restarts the timer and raises a keep-in-view flag until all three are valid again. Wrists are not required and the head need not be still.
    - On completion it records the neutral nose (mean camera-space position) and the shoulder width (mean aspect-corrected distance) over the frames of the completing window, computes gain and centre once, and emits a completion event with the grids, the transform and the head data.
    - A skip-offer flag after `skipHeadViewAfterMs` of presence time from the start of the calm hold; `skipHeadView(state)` completes without head data. In simulated-input mode the calm hold completes after `calmHoldMs`, because the synthetic landmarks are always valid.
    - Export `skipHeadView` from `marrow/core`.
    - Tests: a restart just before `calmHoldMs`; the means, including the aspect correction; the skip offer exactly at `skipHeadViewAfterMs`; completion without head data; the simulated-input case.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.10_

- [x] 10. Head view signal
  - Create `core/headView.ts`: `createHeadView()` and `stepHeadView(state, input, dtMs) -> { state, offset }`. The input carries the frame's landmarks (shoulders included but never read), the neutral head data or none, the skip flag, the mode, and in simulated-input mode the pointer's screen position and the play aspect.
  - Camera mode: per axis d = (nose - neutral nose) / shoulder width in aspect-corrected units, x mirrored once (design §13 question 4) and y growing downwards; raw with the dead zone `headDeadZone` and the clamp `headClamp`; exponential smoothing with `headSmoothingTauMs`. When the nose is invalid, a linear ramp from the output at the moment of loss reaches exactly 0 after `headEaseToCentreMs` (design §9.6); when it returns, smoothing continues from the current output. Skip, or no neutral data, gives (0, 0).
  - Simulated-input mode: x = `simulatedHeadStrength` * (s.x - A/2) / (A/2) and y = 0, with no dead zone and no smoothing; an invalid pointer uses the same ramp to 0.
  - Export `createHeadView`, `stepHeadView` and `HeadViewState` from `marrow/core`.
  - Add `genHeadFrames` to `testgen.ts`: offsets around the dead zone and the clamp, nose gaps, and a variant that changes only the shoulders after calibration.
  - Named tests (design §10.2): `headview_deadzone_clamp_lipschitz` (9.5), `headview_output_bounded` (9.9), `headview_ignores_shoulders` (9.10).
  - Other tests: during the ramp |out| never increases and is exactly 0 from `headEaseToCentreMs` on (9.6); no jump when the nose returns (9.7); skip (9.8); the simulated formula and its ramp (6.7, 6.8).
  - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
  - _Requirements: 6.7, 6.8, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

- [x] 11. Dwell selection
  - [x] 11.1 Dwell reducer
    - Create `core/dwell.ts` with `HitArea` (target id, activation id, centre, radius), `PointerInput` (wrist, validity, screen position), `DwellState` and `DwellEvent`; `createDwell()`, `stepDwell(state, { dt, pointers, hitAreas }) -> { state, events }` and `dwellView(state, targetId)` (owner, progress in ms, progress as a fraction of `dwellMs`).
    - Rules (design §9.3): only targets supplied in this step count; the owner is Inside, Outside or Invalid; a free, unlatched, unused target goes to the valid pointer inside it nearest the centre, the right wrist on an exact tie, with no progress in that step; Inside adds dt and zeroes both timers; Outside freezes progress and releases once its timer exceeds `outsideWindowMs`; Invalid freezes progress and cancels once its timer exceeds `invalidWindowMs`; a pointer that is not the owner changes nothing; after a release any active pointer can acquire from the next step; at `dwellMs` one selection event, progress 0, release, the activation marked used, and a latch on the pointers valid and inside in that step; a latched pointer leaves the latch only in a valid-and-outside step; one selection per activation; a changed activation id or a missing target drops the hold and keeps the latch.
    - Export `createDwell`, `stepDwell`, `dwellView`, `DwellState`, `DwellEvent`, `HitArea` and `PointerInput` from `marrow/core`.
    - Tests: one scripted test per rule, with Outside stints of exactly 150 ms and just over, Invalid stints of exactly 300 ms and just over, the tie-break, and latch release.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.11, 17.12, 17.13, 17.14, 17.15_
  - [x] 11.2 Dwell property tests: time and ownership
    - Extend `testgen.ts`: `genPointerPath` paths that enter, leave, cross and rest on targets; `genTwoPointerInterleaving`; `genHitAreas` (radii 0.07..0.13, overlapping targets, activation changes and removals).
    - Named tests (design §10.2): `dwell_progress_only_owner_inside` (17.16), `dwell_select_sums_inside_time` (17.17), `dwell_select_requires_valid_inside` (17.18), `dwell_owner_isolated_from_other_pointer` (17.19).
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 17.16, 17.17, 17.18, 17.19, 28.8_
  - [x] 11.3 Dwell property tests: re-entry and release timers
    - Named tests (design §10.2): `dwell_reentry_between_selections` (17.20), `dwell_release_timers_exact` (17.21), `dwell_bounded_stints_never_release` (17.22).
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 17.20, 17.21, 17.22, 28.8_

- [x] 12. Tracking lifecycle
  - [x] 12.1 Tracking reducer
    - Create `core/tracking.ts`: `createTracking(cfg)` (active wrists, mode) and `stepTracking(state, input, dtMs) -> { state, events, holdActive, overlayVisible, oneWristHint }`. The input holds the presence delta, the validity of each active wrist, the validity of the nose, and whether calibration is running.
    - Rules (design §9.4): continuous lost time, reset in any step with a valid active wrist; the hold begins in the step lost time exceeds `trackingHoldAfterMs`; the overlay shows once lost time exceeds `trackingOverlayAfterMs` during a hold and stays until the hold ends; continuous valid time during a hold, reset in any step without a valid active wrist; the hold and the overlay end in the step valid time reaches `trackingResumeMs`; losing only the nose, or one wrist while another is valid, never begins a hold; the one-wrist hint after `oneWristHintMs` outside calibration, hidden when that wrist is valid again or a hold begins; no hold during calibration or in simulated input, and no one-wrist hint in simulated input.
    - Export `createTracking`, `stepTracking`, `TrackingState` and the input type from `marrow/core`.
    - Tests: scripted sequences for each rule at its exact boundary.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 6.9, 11.17, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10_
  - [x] 12.2 Tracking property tests
    - The properties compose `presenceDelta`, then `stepTracking`, then `sessionDelta` from the same step's hold, as the driver does (design §3). 18.12 also runs `stepDwell` over the same pointer sequence.
    - Generators: per-step validity of each active wrist and of the nose with gaps of 0..2000 ms and short flickers, `genDtClamped`, and pause and hidden periods.
    - Named tests (design §10.2): `tracking_head_only_loss_harmless` (18.12), `tracking_hold_timing_and_session_clock` (18.13), `tracking_resume_needs_full_second` (18.14).
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 18.12, 18.13, 18.14, 28.8_

- [x] 13. Help policy
  - [x] 13.1 Help reducer
    - Create `core/help.ts`: `createHelp()`, `stepHelp(state, event) -> { state, outputs }` and `helpRadiusForMotorLevel(level, tuning)`. Events: round started (n >= 1), difficulty (motor or cognitive), step completed, continue with help, round ended; each carries the dwell and playback flags, and round ended carries whether a motor step is allowed. The caller decides what a difficulty is.
    - Rules (design §9.5): "offer help" once per round at difficulty number `difficultiesBeforeHelp`; at a round end with at least that many difficulties, raise at most one axis by one level (more difficulties wins, a tie goes to the axis not changed last, the first change is motor); if that axis cannot step, the other axis steps, otherwise nothing changes; levels stay in 0..`helpMaxLevel` and never go down; motor radii from `motorRadii`; a level changes only in a round-ended event without dwell or playback, otherwise the change waits for the next such event and is applied before it; "continue with help" is accepted in every state and reveals and completes the current step.
    - Export `createHelp`, `stepHelp`, `helpRadiusForMotorLevel`, `HelpState`, `HelpEvent` and `HelpOutput` from `marrow/core`.
    - Tests: scripted sessions for each rule.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9_
  - [x] 13.2 Help property tests
    - Add `genHelpSession` to `testgen.ts`: 1..8 rounds with n in 1..10, any mix of difficulties, step completions and "continue with help", random dwell and playback flags, and motor step allowed or not.
    - Named tests (design §10.2): `help_at_most_one_axis_per_event` (19.11), `help_completes_in_bounded_steps` (19.12), `help_at_most_four_changes` (19.13).
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 19.11, 19.12, 19.13, 28.8_

- [x] 14. Settings
  - [x] 14.1 Settings parsing
    - Create `core/settings.ts` (design §5): `Settings` (motion, mute, volume 0..1, hands), `MotionLevel`, `DEFAULT_SETTINGS`, `SETTINGS_VERSION`, `parseSettings(raw, env)` and `serializeSettings(s)`. Versioned JSON; non-JSON or an unknown version gives all defaults; one bad field defaults only that field; parsing never throws. Defaults: motion `reduced` when the browser prefers reduced motion and nothing is stored, otherwise `full`; mute off; volume `defaultVolume`; hands not chosen. A stored motion choice wins over the browser preference.
    - Export the settings names above from `marrow/core`.
    - Add `genSettingsString` to `testgen.ts`.
    - Named tests (design §10.2): `settings_parse_never_throws` (20.4).
    - Other tests: round trip; each default; one corrupted field.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.6, 20.7, 28.8_
  - [x] 14.2 Settings store
    - Create `react/settingsStore.ts`: `createSettingsStore({ prefix, storage, prefersReducedMotion })` with every key under the one prefix the app supplies, subscribers notified synchronously on change, and an in-memory fallback with no message when storage is missing or a write throws. It stores only the four settings: no calibration, pose or video data. Storage is passed in so the tests run in Node; the default reads `window.localStorage` inside a try/catch.
    - Export `createSettingsStore` from `marrow/react`.
    - Tests (the Settings Store tests of Req 28.9): round trip through a fake storage; a missing storage and a throwing one both fall back silently; subscribers are called synchronously; only the settings key under the prefix is written.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 12.9, 20.2, 20.5, 20.8, 20.9, 28.9_

- [x] 15. Input sources
  - [x] 15.1 PoseSource contract and Trace Source
    - Create `input/poseSource.ts` with `PoseSource` and `StartOutcome` (design §2.2), and `input/traceSource.ts` with `createTraceSource(trace)` plus `advanceTo(tMs)`, `validateTrace(trace)` and the `Trace` type.
    - The trace source is advanced only by elapsed milliseconds from the caller; it exposes the last frame whose timestamp is at most t, or none before the first, keeps the last frame and reports the end after the last timestamp, and runs in Node. A malformed trace (missing fields, timestamps not increasing, aspect not positive) is rejected with a message naming the first bad frame. `latest()` never queues; a second `dispose()` does nothing.
    - Add one small hand-written trace to `tests/traces/` (synthetic, never recorded from a person) and load it in a test through `validateTrace`.
    - Export `PoseSource`, `StartOutcome`, `createTraceSource`, `validateTrace` and `Trace` from `marrow/input`, and re-export `PoseFrame`.
    - Tests: the advance rules; each kind of malformed trace with the frame index in the message; dispose twice.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 3.1, 3.2, 3.3, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - [x] 15.2 Pointer Source
    - Create `input/pointerSource.ts`: `createPointerSource(opts)` follows only the primary pointer and drives the right wrist; the left wrist is always invalid. The wrist is valid only while a mouse or pen is over the play area or a touch is in contact with it. The frame aspect is the play aspect A, and the wrist is the inverse base mapping of the pointer through `makeMapping` at gain 1. Nose and shoulders are valid at fixed synthetic positions. At most one frame per animation frame. `start()` resolves `ready`; `dispose()` removes every listener and is safe to call twice.
    - The play-area element and the frame scheduler are passed in, so tests run under jsdom.
    - Export `createPointerSource` from `marrow/input`.
    - Tests (`// @vitest-environment jsdom`, synthetic pointer events): only the primary pointer counts; validity on enter, leave, touch contact and release; the base mapping of the frame's wrist returns the pointer position within 1e-9; at most one frame per animation frame; dispose twice.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 3.1, 3.3, 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 15.3 Vendor the MediaPipe WASM files and the pose model
    - Find which WASM files `FilesetResolver.forVisionTasks` in `@mediapipe/tasks-vision` 1.2.3 requests in Chrome and Edge, and copy only those from `node_modules/@mediapipe/tasks-vision/wasm/` into `apps/garden-of-echoes/public/mediapipe/wasm/` (each `.wasm` file is about 14.7 MB).
    - Download `pose_landmarker_lite.task` (float16) from Google's model storage (design §12.1) into `apps/garden-of-echoes/public/mediapipe/models/`. Use a versioned path instead of `latest` if one exists, and record the exact URL.
    - In `docs/licenses.md`, replace "None yet" with one row per vendored file: source URL, download date, licence (the package files from the package's `package.json`; the model from its official model card, confirmed, not assumed) and SHA-256.
    - Tests: `vendored_assets_match_licenses` (added by this plan), which recomputes each vendored file's SHA-256 and compares it with `docs/licenses.md`.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass and `npm run build -w garden-of-echoes` copies the files into `dist/mediapipe/`.
    - _Requirements: 4.4, 4.5, 28.11_
  - [x] 15.4 Stale-frame helper
    - Add the pure helper of design §9.7 inside `marrow/input`: (previous exposed frame, incoming result or none, milliseconds since the last result, tuning) to the frame to expose. Once the last result is older than `staleFrameMs`, it publishes one new `PoseFrame` object with every landmark invalid, once per stall; the next real result is published as a new frame.
    - Named tests (design §10.2): `stale_frame_emits_new_invalid_frame` (4.8): valid results, then a stall past `staleFrameMs` gives exactly one new all-invalid frame (a different reference), then a fresh result gives another new frame with validity restored.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 4.8_
  - [x] 15.5 Camera Source: start, outcomes and dispose
    - Create `input/cameraSource.ts` with `createCameraSource(opts)`: the base path, the video element, and injectable `getUserMedia` and landmarker factory for tests.
    - `start()` is called only from a user-action handler and calls `getUserMedia` before its first `await`, asking for the user-facing camera at ideal `cameraWidth` x `cameraHeight`; it accepts the delivered size and sets the frame aspect from the delivered video.
    - Exactly one outcome per start: NotAllowedError or SecurityError gives `denied`; no `getUserMedia`, NotFoundError, OverconstrainedError, NotReadableError or AbortError gives `no-camera`; a failed WASM or model fetch, a failed initialisation, or no ready landmarker within `modelLoadTimeoutMs` gives `model-failed` and stops every track the source opened.
    - `dispose()` stops every track, detaches the stream from every video element, closes the landmarker, and does nothing on a second call. A track that ends while running makes every landmark invalid until a restart. No frame or pose data leaves the source or is stored.
    - Tests (`// @vitest-environment jsdom`, fakes only): each error name gives its outcome; the timeout with fake timers; tracks stopped on `model-failed` and on dispose; dispose twice; an ended track gives all-invalid frames.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 3.3, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8_
  - [x] 15.6 Camera Source: inference loop
    - Pose Landmarker with the lite model, one pose, `VIDEO` running mode, on the main thread, using the installed `@mediapipe/tasks-vision` 1.2.3 and imported nowhere outside `src/input`. Every WASM and model URL is built from the base path.
    - At most one video frame in inference, with new frames dropped while one runs; inferences no more often than `maxInferenceHz`. Landmarks 0, 11, 12, 15 and 16, with MediaPipe "left" on the player's left side; validity from `isLandmarkValid`. Each result becomes a new `PoseFrame` object with `t` from the source's monotonic clock, passed through the stale-frame helper.
    - Export `createCameraSource` from `marrow/input`.
    - Tests (fake landmarker and fake video frames): frames dropped while busy; the rate cap; index and side mapping; validity from visibility; the stale guard wired in; the base path in every loaded URL.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 2.3, 2.6, 4.1, 4.2, 4.3, 4.4, 4.8, 4.9, 28.3, 28.5_

- [ ] 16. Shared setup UI (`marrow/react`)
  - [x] 16.1 Component-test setup, MarrowCopy and UI primitives
    - Vitest also picks up `*.test.tsx`; a setup file registers the jest-dom matchers; component tests choose jsdom with a `// @vitest-environment jsdom` docblock, and the default environment stays `node` (design §12.2). Only the installed, approved test packages are used.
    - Add the `MarrowCopy` type, `MarrowCopyProvider` and `useMarrowCopy` (design §7).
    - Add a stylesheet with the `--marrow-*` properties and their neutral grey defaults (design §8), and the internal primitives (panel, button, radio, slider, and an `aria-live="polite"` instruction line) that read only those properties: no palette values, text at least 16 px, button text at least 18 px, and a visible focus ring that no style removes.
    - Export `MarrowCopyProvider`, `useMarrowCopy` and `MarrowCopy` from `marrow/react`. No component holds a string of its own.
    - Tests: the provider supplies strings; the primitives render real button, radio and range elements with the accessible names they are given; the stylesheet defaults are at least `uiMinTextPx` and `uiMinButtonTextPx`; no colour value appears outside the custom-property defaults.
    - Done when `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass (UI task).
    - _Requirements: 21.1, 24.2, 24.3, 24.4, 28.4, 28.6_
  - [ ] 16.2 Settings provider and settings controls
    - Add `SettingsProvider` and `useSettings` over `createSettingsStore`, and the controls `MotionSetting` (radio group Full, Gentle, Reduced), `AudioSettings` (mute checkbox and volume range) and `SimulatedInputLabel`, with every string from MarrowCopy.
    - The motion choice is stored and has no visible effect in this spec.
    - Export the provider, the hook and the three controls from `marrow/react`.
    - Tests: each control works by pointer and by keyboard (user-event); a change reaches subscribers before the next animation frame; accessible names come from the copy.
    - Done when `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass (UI task).
    - _Requirements: 6.10, 20.8, 20.10, 21.1, 22.9, 24.1, 28.9_
  - [ ] 16.3 Start, camera permission, hand choice and camera preview
    - `StartScreen`: the title and the Start control.
    - `CameraPermissionScreen`: the one-sentence explanation with "Use the camera" and "Try without camera"; each of the `denied`, `no-camera` and `model-failed` outcomes with its own calm message, Retry and "Try without camera". The camera is requested only from these click handlers.
    - `HandChoiceScreen`: a radio group Right, Left, Both with Continue; the stored choice is pre-selected; with none stored nothing is selected and Continue is disabled until a choice is made; the choice is stored.
    - `CameraPreview`: small and mirrored, its width capped by a maximum the app passes in; it detaches the stream when it unmounts.
    - Export the four components from `marrow/react`.
    - Tests: one component test per screen and per outcome; Retry and "Use the camera" call the start callback from the click; the preview detaches its stream on unmount.
    - Done when `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass (UI task).
    - _Requirements: 5.1, 21.1, 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 24.1, 28.9_
  - [ ] 16.4 Calibration screen
    - `CalibrationScreen`: the aura drawn on a canvas from `auraIntensity` and redrawn when a cell's validity changes; an orb for each valid active wrist; the current instruction in the live region; Retry.
    - "Keep your face and shoulders in view" while the calm-hold flag says so, and "Skip head view" once it is offered; the calibration hand hint with "Try without camera" in camera mode; "Use the whole screen" throughout calibration in simulated-input mode only.
    - The no-usable-slot state: its message with "Retry calibration" and "Try without camera" in camera mode, or with "Retry calibration" and "Use the whole screen" in simulated-input mode.
    - Export `CalibrationScreen` from `marrow/react`.
    - Tests: `whole_screen_never_in_camera_mode` (Req 28.9, design §10.4); each message and control appears only when its flag or mode says so; with a stubbed canvas context, the aura is redrawn only when validity changes.
    - Done when `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass (UI task).
    - _Requirements: 11.12, 11.14, 11.16, 12.3, 12.6, 15.5, 21.1, 22.7, 22.8, 22.10, 28.9_
  - [ ] 16.5 Pause and tracking-lost overlays
    - `PauseOverlay`: Resume, Recalibrate, the motion setting, mute, volume and Exit.
    - `TrackingLostOverlay`: "Step back into view" with a simple placeholder picture that has an accessible name, Recover, "Try without camera" and Exit.
    - Focus moves into an overlay when it opens.
    - Export both overlays from `marrow/react`.
    - Tests: every control and accessible name comes from the copy; each callback fires by click and by keyboard.
    - Done when `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass (UI task).
    - _Requirements: 21.1, 23.4, 23.7, 24.1, 28.9_
  - [ ] 16.6 Debug Overlay
    - `DebugOverlay`: render frames per second and inference results per second over `debugRateWindowMs`, with the pointer frame rate in their place in simulated-input mode; the validity of each active wrist and of the nose; each comfort grid drawn through the current Mapping; every hit area of the current frame; the head offset; and the pipeline latency from a PoseFrame's timestamp to the first render that draws it, labelled as excluding camera and display latency.
    - It takes no pointer input, contains no focusable element, changes no logic state, and draws only from the snapshot passed in for the current frame.
    - Export `DebugOverlay` from `marrow/react`.
    - Tests (the Debug Overlay tests of Req 28.9): nothing focusable; no pointer events; a frozen input snapshot stays unchanged; labels from the copy; the rate window.
    - Done when `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass (UI task).
    - _Requirements: 2.7, 25.2, 25.3, 25.4, 25.5, 28.9_

- [ ] 17. Playground, audio and end-to-end tests
  - [ ] 17.1 App copy and theme
    - In `apps/garden-of-echoes/src/copy/index.ts`, add `marrow: MarrowCopy` with every entry of Req 21.3, the steering texts exactly as written, the one-sentence camera explanation, and calm present-tense instructions; add the playground's own strings beside it.
    - In `src/ui`, add `theme.css` with the `--marrow-*` values from the grey ramp, `lanternWarm` as the only accent, and the fallback font stacks, plus the small provider that applies it (design §14.5).
    - Tests: `copy_banned_words_and_length` (21.7: every banned word of `accessibility-and-copy.md`, whole word, any case, over every string in `src/copy`, and at most 8 words in each instruction entry); `ui_contrast_pairs` (24.6: a small pure WCAG helper checks every text and background pair used by the Setup UI and the playground, read from `theme.css`, at 4.5:1 or more).
    - Done when `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass (UI task).
    - _Requirements: 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 24.5, 24.6, 26.12_
  - [ ] 17.2 Playground entry, content file and tuning check
    - `src/main.tsx` renders the current page unchanged without `playground=1`; with it, it lazy-loads `src/dev/playground.tsx` as a separate chunk that works under `BASE_PATH`.
    - Add `src/dev/playground-content.json` (15 slots in order, target count 3) and its hand-written typed validator, whose message names the first bad field, for example `playground-content.json: slots[7].y = 1.4 is out of range [0, 1]` (design §14.4).
    - On load the playground runs `validateTuning(TUNING)` and, if it fails, shows the `formatTuningErrors` message instead of running.
    - Tests: the validator for a missing field, a wrong type, an out-of-range value and an extra property; the tuning check shows the message for an invalid tuning object.
    - Done when `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass (UI task).
    - _Requirements: 1.4, 26.1, 26.2, 26.3_
  - [ ] 17.3 Setup flow
    - Add `src/dev/setupFlow.ts`, the pure state machine of design §14.1: START, CAMERA_PERMISSION, HAND_CHOICE, CAMERA_ERROR (with its outcome), CALIBRATING, PLAY and NO_USABLE_SLOT. "Try without camera" goes to CALIBRATING with the Pointer Source and skips hand choice; Retry requests the camera again; Recalibrate goes to hand choice in camera mode and straight to calibration in simulated-input mode; Exit returns to START and discards calibration; Recover keeps calibration; "Try without camera" in the tracking-lost overlay goes to calibration with the Pointer Source.
    - PAUSE and TRACKING_LOST are flags that never change the active state.
    - Tests: one per transition; the flags never change the state or the round.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 6.10, 12.9, 18.11, 22.2, 22.3, 22.4, 22.8, 23.5, 23.6, 23.8, 23.9_
  - [ ] 17.4 Round controller and play-area slot filter
    - Add `src/dev/roundController.ts` with the play-area slot filter of design §14.2: keep only slots whose circle of radius r + m lies inside [0, A] x [0, 1], applied with the current play aspect to the demand given to `createCalibration` (N = 3, r = `TUNING.hitRadius`, m = 0) and to every round.
    - When calibration completes and at each new round, rotate the filtered slots to start at the cursor and call `placeTargets`: `simultaneous` shows three targets at once, `sequential` shows target i alone in usable slot i mod k, and `none` leads to the no-usable-slot screen. Each round has new activation ids, and the cursor moves on so that a round avoids the last round's slots when enough usable slots exist. A completed target is no longer supplied to the Dwell Engine.
    - Tests: slots outside or across the play-area edge are dropped; the targets of every round are pairwise disjoint; consecutive rounds use different slots when at least 6 slots are usable; the `sequential` order; new activation ids; pause and hold flags leave the round unchanged.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 14.5, 18.11, 22.8, 26.4, 26.9, 26.10_
  - [ ] 17.5 Frame driver
    - Add `src/dev/frameDriver.ts`: a pure per-frame step plus a thin `requestAnimationFrame` loop, following design §3. `presenceDelta` first; then head view and tracking; then `sessionDelta` from this step's hold. A new frame is detected by reference identity of `source.latest()`, never by `t`. The pointer filter runs only on new frames, with the presence time accumulated since the last consumed frame, and resets when play resumes after Pause or a hidden tab. One Mapping, with one gain and centre, serves every active wrist. In simulated-input mode there is no filter and the gain is 1. Calibration samples on new frames; dwell, tracking and head view step every frame on the presence delta. The head offset never reaches pointers, hit areas, dwell or tracking. Mode differences come only from the settings passed in, never from the source type.
    - Tests: `driver_ignores_frame_timestamps` (added by this plan: the same frame objects with scrambled `t` give identical outputs); the filter resets after a pause; the simulated pointer equals the pointer position; the session delta is 0 in the step a hold begins; changing the head offset leaves pointers and dwell unchanged.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 2.7, 3.4, 6.6, 8.2, 8.4, 9.11, 10.4, 10.5, 16.7_
  - [ ] 17.6 Tone player
    - Add `src/audio/tonePlayer.ts`: the AudioContext is created or resumed only from the Start handler; Web Audio oscillators only, no audio files; C5, E5 and G5 sine tones of about 400 ms with a soft attack and release, one per target of a round; master gain = volume x 0.5, every change ramped over 100 ms, never a jump; 0 while muted. These app values live beside this code (Appendix B).
    - Tests with a fake AudioContext: nothing is created before the Start call; gain targets and ramp times; mute.
    - Done when `npm run typecheck`, `npm run lint` and `npm test` pass.
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5_
  - [ ] 17.7 Playground in simulated-input mode
    - `src/dev/playground.tsx` composes the providers, the setup flow, the Pointer Source, the frame driver, the calibration screen and the play area. The same code runs after the PoseSource in both modes.
    - The play area draws targets as plain SVG placeholder shapes, never larger than their hit areas and without story content. Every frame gives the Dwell Engine the presence delta, the pointers and the hit areas of the open targets. An orb for each valid active wrist, hidden while invalid. A progress ring, its arc length showing progress, only on targets with an owner and progress above 0. On selection the target shows as completed with a different shape and colour, eased over at least 300 ms, plays its tone unless muted, and is no longer supplied.
    - Escape and a Pause control open Pause on every screen after Start, and Escape or Resume closes it; Pause sets the paused flag; a mute control on every screen after Start; the "Simulated input" label on every screen; the current instruction in the live region; "Use the whole screen" during calibration. The playground does not use the Help Policy.
    - Tests: component tests of the play area (ring only with an owner and progress above 0; orb hidden while invalid; the completed shape); the existing end-to-end test still passes.
    - Done when `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass (UI task).
    - _Requirements: 6.10, 11.14, 19.10, 22.1, 22.9, 22.10, 23.1, 23.2, 23.3, 24.7, 24.8, 24.9, 26.5, 26.6, 26.7, 26.8, 26.9, 26.11, 27.1_
  - [ ] 17.8 Playground in camera mode
    - "Use the camera" starts `createCameraSource` from the click, with every URL under `BASE_PATH`. Outcome screens with Retry. Hand choice, and the mirrored preview of at most 320 CSS px during hand choice and calibration, removed and detached when play starts.
    - The tracking-lost overlay follows the tracking outputs. Recover disposes and restarts the source from the click, keeps calibration and keeps the overlay until the hold ends; an outcome other than `ready` shows that outcome's screen. "Try without camera" disposes the source and calibrates with the Pointer Source. During a hold the play area dims, eased over at least 300 ms, and every target stays where it is. The calibration hand hint's "Try without camera" works the same way. The one-wrist hint shows when tracking says so.
    - The source is disposed on Exit, on switching to simulated input, on unmount and on `pagehide`, and not on a tab switch (design §14.5).
    - Tests with a fake camera source: dispose on each of those events and not on `visibilitychange`; Recover restarts from the click handler.
    - Manual check with a webcam (Playwright never uses a camera): `?playground=1&debug=1` completes a round; record the inference rate the overlay shows in the journal, as measured.
    - Done when `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass (UI task).
    - _Requirements: 4.4, 5.1, 5.7, 11.12, 18.9, 22.2, 22.3, 22.4, 22.5, 22.6, 23.6, 23.7, 23.8, 23.9, 23.10_
  - [ ] 17.9 Debug overlay in the playground
    - With `debug=1` in the URL the playground renders `DebugOverlay` on every screen, fed from the snapshot the playground draws in the same frame; without it, the overlay is not rendered.
    - Tests: rendered only with `debug=1`.
    - Done when `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass (UI task).
    - _Requirements: 25.1, 25.5_
  - [ ] 17.10 End-to-end tests in simulated-input mode
    - Playwright only, simulated input only: (a) choose "Try without camera", paint with the mouse until calibration ends, see three targets, hold the mouse on each until it completes, and see a new round; (b) the same through "Use the whole screen"; (c) Escape opens Pause and Resume closes it; (d) an init script records `getUserMedia` calls and none happens on the simulated path; (e) the page without `playground=1` is unchanged.
    - Also: a focused control shows a visible focus ring; a production build with `BASE_PATH`, served by `vite preview` on its own port, loads `?playground=1` and serves the vendored MediaPipe files under the base path.
    - Done when `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass (UI task).
    - _Requirements: 4.4, 6.10, 24.2, 26.1, 26.2, 28.10_

- [ ] 18. Requirement coverage check
  - Add `tests/spec-coverage.test.ts`. It reads every acceptance criterion id from `.kiro/specs/marrow-input/requirements.md` and every `_Requirements:` line of this file, and fails with a list of any criterion that no task references. It also fails if any named test of design §10.2, or `stale_frame_emits_new_invalid_frame`, is not the title of a test in the repository.
  - Check the cross-cutting rules with evidence: core logic reads every steering and Appendix B number from `TUNING` (search `packages/marrow/src/core` for numeric literals); files sit where Req 28.1 says; the app imports Marrow only through `marrow/core`, `marrow/input` and `marrow/react`; MediaPipe is imported only in `src/input`; packages hold no story words or player-facing text; `eslint.config.js` and `tests/dependency-graph.test.ts` gained no exception and lost no rule since this spec began; every failing seed is in `docs/bugs-found.md`.
  - Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e`, and record their output.
  - Done when `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass.
  - _Requirements: 1.6, 28.1, 28.2, 28.3, 28.4, 28.7, 28.8, 28.12_

## Notes

The five decisions approved in chat on 2026-11-16 (core exports and the names `retryCalibration`, `chooseWholeScreen` and `skipHeadView`, the play-area slot filter, the hand-written content validator, the full rule comments, and `pagehide`) are written into design.md sections 1, 4, 6 and 14.

## Task Dependency Graph

Each wave holds one leaf task, in plan order, so no two tasks run in parallel. A task with sub-tasks is not listed: its sub-tasks are.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4"] },
    { "id": 4, "tasks": ["5"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["6.2"] },
    { "id": 7, "tasks": ["7.1"] },
    { "id": 8, "tasks": ["7.2"] },
    { "id": 9, "tasks": ["8"] },
    { "id": 10, "tasks": ["9.1"] },
    { "id": 11, "tasks": ["9.2"] },
    { "id": 12, "tasks": ["10"] },
    { "id": 13, "tasks": ["11.1"] },
    { "id": 14, "tasks": ["11.2"] },
    { "id": 15, "tasks": ["11.3"] },
    { "id": 16, "tasks": ["12.1"] },
    { "id": 17, "tasks": ["12.2"] },
    { "id": 18, "tasks": ["13.1"] },
    { "id": 19, "tasks": ["13.2"] },
    { "id": 20, "tasks": ["14.1"] },
    { "id": 21, "tasks": ["14.2"] },
    { "id": 22, "tasks": ["15.1"] },
    { "id": 23, "tasks": ["15.2"] },
    { "id": 24, "tasks": ["15.3"] },
    { "id": 25, "tasks": ["15.4"] },
    { "id": 26, "tasks": ["15.5"] },
    { "id": 27, "tasks": ["15.6"] },
    { "id": 28, "tasks": ["16.1"] },
    { "id": 29, "tasks": ["16.2"] },
    { "id": 30, "tasks": ["16.3"] },
    { "id": 31, "tasks": ["16.4"] },
    { "id": 32, "tasks": ["16.5"] },
    { "id": 33, "tasks": ["16.6"] },
    { "id": 34, "tasks": ["17.1"] },
    { "id": 35, "tasks": ["17.2"] },
    { "id": 36, "tasks": ["17.3"] },
    { "id": 37, "tasks": ["17.4"] },
    { "id": 38, "tasks": ["17.5"] },
    { "id": 39, "tasks": ["17.6"] },
    { "id": 40, "tasks": ["17.7"] },
    { "id": 41, "tasks": ["17.8"] },
    { "id": 42, "tasks": ["17.9"] },
    { "id": 43, "tasks": ["17.10"] },
    { "id": 44, "tasks": ["18"] }
  ]
}
```
