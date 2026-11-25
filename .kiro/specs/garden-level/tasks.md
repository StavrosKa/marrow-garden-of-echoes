# Implementation plan: garden-level

This plan builds the garden-level spec in twelve tasks. Each task is one commit, starts from finished and tested work, and leaves something playable where the task says so. Requirement numbers refer to `requirements.md`, and section numbers refer to `design.md` (both final at `b603065`; this plan does not change them).

Rules for every task:

- A task is done only when `npm run typecheck`, `npm run lint` and `npm test` pass. Tasks 11 and 12 also run `npm run test:e2e`. The task reports the output.
- Tests use the test titles and files of `design.md` section 6. A test that has no title there gets a title that starts with the requirement ids it covers.
- Tests read numbers from `TUNING` (marrow), `ATTENTION_TUNING`, `SIM_PROFILES`, `APP_SESSION_TUNING` or the world-view `TUNING`. A literal is allowed only when it is a row of a table in `requirements.md`.
- Every stage task ships its `content.json`, its validator (`validateX`, `loadX`) and its contract test (`design.md` section 4.3).
- Tasks marked "stop after plan" write a plan of files, signatures and tests in the chat, then stop. The owner reviews it before any code is written.
- A task that needs a change to `requirements.md` or `design.md`, a new dependency, a lint exception, a relaxed rule, or a deploy stops and asks. Nothing else needs asking.
- Throwaway files go in `.scratch/`, and are deleted when the task is done.
- `docs/` already exists. It holds `architecture.md`, `bugs-found.md`, `kiro-journal.md` and `licenses.md`.
- If a push is rejected, stop and report. Never force-push.

## Tasks

- [x] 1. Tooling for the pure code (gap G12)
  - In `eslint.config.js`, add a pure zone for `apps/garden-of-echoes/src/session/**` and `apps/garden-of-echoes/src/stages/*/rules.ts`. It forbids React, `react-dom`, PixiJS, MediaPipe and the DOM globals, as the `marrow/core` zone does. No existing rule changes.
  - In `tests/core-no-wall-clock.test.ts`, add `packages/marrow/src/challenges`, `packages/marrow/src/sim` and `apps/garden-of-echoes/src/session` to the scanned directories. A listed directory that does not exist yet is skipped.
  - Add `tests/garden-tuning-labels.test.ts`. It checks every tuning file in the three new directories for the label comments of `tests/tuning-labels.test.ts`. A fixture with a missing label fails the test.
  - Probe, not committed: a file in `session/` that imports `react`, and one that reads `document`, must each fail `npm run lint`. Record both results in the commit body.
  - Verification: typecheck, lint and test pass. The two probe files fail lint, and then the probe files are deleted.
  - _Requirements: 23.1, 23.2, 23.3_

- [x] 2. Attention round (stop after plan)
  - [x] 2.1 `packages/marrow/src/challenges/rng.ts`: `seedRng`, `nextUnit`, `shuffle`, the value-type generator of `design.md` section 2.1. Unit tests: the same seed gives the same sequence, values lie in [0, 1), and `shuffle` is a permutation.
  - [x] 2.2 `challenges/tuning.ts`: `ATTENTION_TUNING` with its labels, and `validateAttentionTuning(t, core)`. Tests: `tuning shipped valid`, and one rejection test per rule (including `offerHelpAfterMistakes` must equal core `difficultiesBeforeHelp`).
  - [x] 2.3 `challenges/attention.ts`: `attentionWindowsFor`, `blockProblems`, `orderBlocks`, `createAttentionRound`, `stepAttention`, `currentPresentation`, with the rules of `design.md` section 2.3. The `dtMs` is the session delta. Unit tests in `attention.test.ts`: Reduced uses the Gentle windows, the demonstration does not count as a presentation, a select dwell before the minimum is kept, the mistake kinds, and the help reveal.
  - [x] 2.4 Property tests in `attention.properties.test.ts`: every block has a select and a let-pass presentation; each presentation lasts at least 2.5 s; a mistake never lowers `completed`; there are exactly two mistake kinds; with a wrong-answer rate of 1.0, every round completes within 18 presentations; the order depends only on the seed.
  - [x] 2.5 `tests/noTimingLiterals.test.ts`: parses `attention.ts` and `placementBand.ts` with the TypeScript parser and allows only the numbers 0 and 1.
  - Mutation check, once, on the properties of 2.4: 3 to 5 mutations, each reported as killed or survived.
  - Verification: typecheck, lint and test pass. The mutation results are in the commit body.
  - _Requirements: 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 3. Session machine, stage order and placeholder stages (stop after plan)
  - [x] 3.1 `apps/garden-of-echoes/src/session/stageOrder.ts`: `STAGE_IDS`, `ROUTE`, `parseStartParam`. Tests in `stageOrder.test.ts`: the four ids are accepted, an unknown id gives `null`, and no input throws.
  - [x] 3.2 `session/tuning.ts`: `APP_SESSION_TUNING` with `rewardToTravelMs` (1500, range 1000 to 2000) and `entryTitleMs`, and its validator. Test in `session/tuning.test.ts`.
  - [x] 3.3 `session/machine.ts`: `createSession`, `stepSession`, with the types of `design.md` section 2.6. The machine takes the journey segments as an argument. A test fixture supplies them until task 6 loads `segments.json`. Unit tests in `machine.test.ts`: stage order, rejected completions, suspension flags that do not change the stage, and the target flag that turns on only at arrival.
  - [x] 3.4 Property tests in `machine.properties.test.ts`: over random event sequences with repeated and late completions, each stage makes exactly one transition, and no completion is accepted under any flag. The machine reads no clock and no randomness.
  - [x] 3.5 Placeholder stages: `stages/shared/placeholderContent.ts`, `content.json` for all four stage ids (one target each), `content.ts` validators, `stages/shared/contract.ts`, and a `content.test.ts` contract test per stage. Lantern Glade and Whisper Glade keep placeholder content until tasks 6 and 8 replace it.
  - Verification: typecheck, lint and test pass. A scripted run in the test reaches `SAVED` through all four stages.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.7, 9.1, 9.2, 9.3, 20.1, 20.5, 23.2_

- [x] 4. Copy
  - [x] 4.1 `apps/garden-of-echoes/src/copy/garden.ts`: `GARDEN_COPY` with every key of the requirements table in section 14, plus `bloom.target`, the eight per-rule keys, and `pause.help`.
  - [x] 4.2 `copy/gardenMarrowCopy.ts`: `gardenMarrowCopy`, a complete `MarrowCopy` filled from `GARDEN_COPY`. A missing field fails typecheck.
  - [x] 4.3 Extend `copy/copy.test.ts`: the banned words are absent from every string in `GARDEN_COPY` and `gardenMarrowCopy`; every line is eight words or fewer except `camera.why`; the copy never claims therapy, rehabilitation, diagnosis or clinical benefit; and every key that a stage uses exists.
  - Verification: typecheck, lint and test pass. The copy test lists the number of keys it checked.
  - _Requirements: 3.4, 5.8, 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 5. Placement, help snapshot and placed rounds (stop after plan)
  - [x] 5.1 `packages/marrow/src/challenges/placementBand.ts`: `inRestingBand` and `planPlacement`, with the algorithm of `design.md` section 2.4. Property tests in `placementBand.properties.test.ts`: every placed slot and its full hit area lie in the reachable region for every allowed head offset; no band slot is used unless the out-of-band slots are not enough; the band slots used are the nearest to the edge and no more than needed. The generators are written inside the test file from marrow's public API only.
  - [x] 5.2 `apps/garden-of-echoes/src/session/roundSnapshot.ts`: `snapshotRound`. Test `roundSnapshot.test.ts`: both levels change in the middle of a round, and the round's snapshot does not change until the next placement. A repo test scans the app for `motorLevel` and `cognitiveLevel` reads, and allows them only in `roundSnapshot.ts` and its test.
  - [x] 5.3 `stages/shared/placeRound.ts`: `placeRound`. It maps the chosen screen objects back to their world points by identity. Test `placeRound.test.ts`: the returned points are the authored slots, and the band rule and the snapshot are both applied.
  - Verification: typecheck, lint and test pass. The property tests run at least the number of cases in the test parameters of `design.md` section 6.
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 12.1, 12.2, 12.3_

- [x] 6. Lantern Glade end to end, with journey A and audio
  - [x] 6.1 `apps/garden-of-echoes/src/journeys/segments.json` (four segments, as `design.md` section 4.1 shows) and `journeys/journeys.ts` (`loadSegments`, `journeyTravel`). Tests in `journeys.test.ts`: the travel duration for Full, Gentle and Reduced; door segments last `doorMs`; Reduced gives a 1.5 s cross-fade; and the segments chain.
  - [x] 6.2 `stages/lantern-glade/`: `content.json` (four lanterns, notes, slots, copy keys), `content.ts` validator, and `content.test.ts` contract test. The real content replaces the placeholder from task 3.
  - [x] 6.3 `stages/lantern-glade/rules.ts`: four lanterns in order, the first as the tutorial, one note and one colour patch per selection, the path lit after the fourth. Placement goes through `placeRound`. Tests in `rules.test.ts`.
  - [x] 6.4 Light and flicker: `scene/flicker.ts`, `stages/lantern-glade/light.test.ts` (eased over at least 300 ms, steady in Reduced) and `scene/flicker.test.ts` (at most 15 % either way, cycles of 1.5 s or longer).
  - [x] 6.5 Audio: `audio/pentatonic.ts`, `audio/tonePlayer.ts` (adds `playFrequency`; the playground tests stay as they are), and `audio/gardenAudio.ts`. Test `gardenAudio.test.ts`: `start` runs only from a user action, every note has a visual cue, and the game runs with the audio muted.
  - [x] 6.6 `apps/garden-of-echoes/src/session/stageDriver.ts`: the per-frame glue of `design.md` section 3, steps 5 to 8. It places each round through `placeRound`, which reads the help levels once. It maps attention events to help events in this order: `roundStarted` with steps 1 when a presentation starts; `difficulty` with axis `motor` for a select window that ends without a dwell, and `cognitive` for a dwell on a let-pass stimulus; then `stepCompleted`, or `continueWithHelp` when help completed the presentation; then `roundEnded` with `motorStepAllowed`. On each frame it reads the suspension and tracking-hold flags, sets `playbackActive` during a demonstration, and sets `dwellActive` from `dwellView`. It keeps no timer of its own (7.7). Test `stageDriver.test.ts`: the event order for one presentation, the axis mapping, a round in progress keeps its snapshot when the help levels change (12.1), and a completion under a suspension flag reaches no stage rule (1.4).
  - [x] 6.7 Minimal `?start=<stage id>` entry in `main.tsx`: it calls `parseStartParam`, starts the stage in simulated input with the whole frame as reach, never requests the camera, and shows the existing placeholder `App` screen for an unknown id. It is the way to start the Lantern Glade play-through until task 10. Test `startEntry.test.ts`. Task 11.5 extends this entry and does not replace it.
  - [x] 6.8 Scene: `scene/spriteSlot.ts` (placeholder shapes from the slot names of `art-and-motion.md`), `scene/sceneSetup.ts`, and `stages/lantern-glade/scene.ts`. Test `spriteSlot.test.ts`. The Lantern Glade title fades in and out. The stage completes into journey A and arrives at the placeholder Whisper Glade.
  - Verification: typecheck, lint and test pass. Then `npm run dev` and a mouse play-through of Lantern Glade to Whisper Glade, started with `?start=lantern-glade`, reported in the commit body.
  - _Requirements: 1.1, 1.4, 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 9.4, 17.1, 17.2, 17.3, 17.4, 7.7, 12.1, 18.1, 18.2, 18.4, 18.5, 20.1, 20.2, 20.3, 20.4, 22.1, 22.2, 22.3, 22.4_

- [x] 7. Simulator pieces and the app script, on the placeholder session (stop after plan)
  - [x] 7.1 `packages/marrow/src/sim/tuning.ts` (`SIM_PROFILES` with the eight rows of requirement 19.6, and `validateSimTuning`), `invariants.ts` and `report.ts` (`formatReport`, `exitCodeFor`). Tests: `tuning.test.ts`, `invariants.test.ts` and `report.test.ts`.
  - [x] 7.2 `sim/player.ts` (`chooseFor`, `framesFor`) and `sim/calibrationSweep.ts` (`sweepSamples`). Tests: the choices are seeded, and the wrong-answer rate of each profile matches its table row over 10 000 draws within a stated tolerance.
  - [x] 7.3 `apps/garden-of-echoes/src/dev/simulate/runSession.ts`, `cli.ts` and `run.mjs`. The root `package.json` gets `"simulate": "node apps/garden-of-echoes/src/dev/simulate/run.mjs"`, and the app package gets the same script. The `simulate` stub in `packages/marrow/package.json` is removed. Tests: `runSession.test.ts` (the placeholder session completes with the baseline profile and seed 42; "the placeholder session" means Lantern Glade runs through the real driver and its dwell, and Whisper Glade, Whisper Hall and Bloom complete by a `stageCompleted` event sent through `stepSession`, until tasks 8 to 12 give them targets), and `cli.test.ts` (defaults, `--seed` and `--runs`, invalid values exit 2, and any violation exits 1).
  - Verification: typecheck, lint and test pass. Then `npm run simulate -- --seed 42 --runs 50`, with its output in the commit body.
  - _Requirements: 1.3, 19.1, 19.2, 19.4, 19.5, 19.6_

- [x] 8. Whisper Glade, path choice and journey B
  - 8.1 `stages/whisper-glade/content.json` (two spirits, two blocks of three marks, two spirit slots, path slots), `content.ts` validator with the block rules of `design.md` section 4.2, and `content.test.ts` contract test. The real content replaces the placeholder from task 3.
  - 8.2 `stages/whisper-glade/rules.ts`: two blocks, a demonstration between them that does not count, the attention round from task 2, and seeded block order. The copy key follows the rule of the current block. Tests: `rules.test.ts` (blocks, demonstration, shape with colour). Property tests in `rules.properties.test.ts`: over seeded rounds, each presentation uses the keys of its block's rule, and each of the eight per-rule keys exists and is used.
  - 8.3 `stages/whisper-glade/pathChoice.ts`: two targets, either pointer, the same journey B geometry, and the choice changes only the dressing. Test `pathChoice.test.ts`.
  - 8.4 Journey B and the door into the hall: the route goes through `journeyB` and `doorHall` to the placeholder Whisper Hall. Extend `journeys.test.ts`.
  - 8.5 Whisper Glade placeholder arrival background. `scene/forestLayers.ts` gets a Whisper Glade layer table with the same five-row shape, `scene/spriteSlot.ts` gets `glade2-ground`, `forest-fartrees-b`, `glade2-trunk-left` and `glade2-trunk-right` (reusing the sky and hills of the forest), `scene/sceneSetup.ts` gives each stage its own bands, and `ui/GardenStage.tsx` switches to the next stage's layers when journey A arrives. Tests: the name list in `spriteSlot.test.ts`; the Whisper Glade table passes the world-view layer checks for journeys A and B, extended in `journeys.test.ts`; in `tests/e2e/lantern-frame.spec.ts` the arrival pixel differs from the Lantern Glade backdrop; under Reduced motion the arrival is the 1.5 s cross-fade. Requirements: 2.4. No requirements change is needed for this sub-task.
  - Verification: typecheck, lint and test pass, and `npm run test:e2e` passes for the arrival check of 8.5. Then a mouse play-through of Whisper Glade and journey B to the hall door, reported in the commit body.
  - _Requirements: 2.4, 2.5, 2.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 9. Simulator with all profiles and invariants (stop after plan)
  - 9.1 Run every profile in `SIM_PROFILES` through `runSession`, with the real machine and stage rules. The invariants are: one transition per stage; no completion under a suspension flag; no target active before travel stops; no band slot unless needed; help levels unchanged between round start and round end. Extend `runSession.test.ts`: every profile completes for seed 42.
  - 9.2 The adversarial profile completes within the step budget through help, and the slow profile completes. Both are tests.
  - 9.3 Check the default invocation `npm run simulate -- --seed 42 --runs 50`. Its output, with each profile's completions, help steps, violations and seeds, goes in the commit body.
  - Verification: typecheck, lint and test pass. The default invocation exits 0 on a clean run and 1 on a seeded violation.
  - _Requirements: 1.3, 7.6, 12.2, 19.3, 19.4, 19.5, 19.6, 19.7_

- [x] 10. Home, setup flow and calibration screen
  - 10.1 `ui/Home.tsx`: "Start" and "Try without camera" as DOM buttons with a visible focus ring and an accessible name. The camera is requested only after Start, and the explanation is shown first. "Try without camera" and a denied camera enter simulated input with the label "Simulated input". Test `Home.test.tsx` (jsdom).
  - 10.2 Setup screens: camera permission, hand choice and calibration reuse `marrow/react` with `gardenMarrowCopy`. Escape is wired to open Pause once task 11 adds it. Enter and Space activate a focused control. Test `setup.test.tsx`.
  - 10.3 `ui/CalibrationExplainer.tsx`: the painted area, a progress ring with no number and no countdown, and the sentence `calibrate.edge`, with the accessible names and contrast of the steering. Test `CalibrationExplainer.test.tsx`.
  - 10.4 The no-usable-slot screen (Requirement 10.6): when placement returns `none`, the app shows "Retry calibration" and "Try without camera", and it does not enlarge the comfort map. Retry restarts calibration through `retryCalibration`. Test `noUsableSlot.test.tsx`: both buttons appear, Retry calls `retryCalibration`, the comfort grids are unchanged, and "Try without camera" enters simulated input.
  - Verification: typecheck, lint and test pass. Then `npm run dev` and a check of the camera-denied path into simulated input, reported in the commit body.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 10.6, 11.1, 11.2, 11.3, 11.4_

- [ ] 11. In-game interface, pause, end card, titles, low-rate hint and motion
  - 11.1 `ui/InstructionLine.tsx` (one line, `aria-live="polite"`, the quiet light hint never replaces a required line) and `ui/PlayArea.tsx` (`touch-action: none`, asserted through the computed style). Tests `InstructionLine.test.tsx` and `PlayArea.test.tsx`.
  - 11.2 `ui/PauseScreen.tsx`: resume, recalibrate, motion, sound, "Continue with help", restart without confirmation, and exit to Home. Every control is a DOM element with a focus ring and a name. Tests `PauseScreen.test.tsx` and `controls.test.tsx`.
  - 11.3 `ui/EndCard.tsx` (test id `end-card`), the level titles that fade in and out (Lantern Garden at the start, Whisper Hall when the door opens), and the help offer "Want a hint?" next to "Continue with help". Test `EndCard.test.tsx`.
  - 11.4 `session/lowRate.ts`: the delivered-rate watch, with its values in `session/tuning.ts`. It shows the hint once per session. The motion setting takes effect in the next frame. Tests `lowRate.test.ts` and `motion.test.ts`.
  - 11.5 Extends the `?start=<stage id>` entry that task 6.7 added. This task adds the full test `start.test.tsx`, and an unknown id shows the Home screen from task 10 instead of the placeholder. The entry does not change: it still calls `parseStartParam`, uses simulated input with the whole frame as reach, and never requests the camera.
  - 11.6 Lit lanterns flicker. `stages/lantern-glade/scene.ts` gives each lit lantern a colour: the lantern light level (`lightLevel`) times `flickerFactor` from `scene/flicker.ts`, clamped per channel. Unlit lanterns stay steady. `ui/GardenStage.tsx` calls `setTargetColour` for each lit lantern in the frame loop. Tests: a new `scene.test.ts` checks that every lit colour stays within 15% either way of the light colour, measured before clipping, with cycles of at least 1.5 s, and that the colour is constant in Reduced motion; `tests/e2e/lantern-frame.spec.ts` reads the pixel of a lit lantern at two times and checks the change is within the same bound. Requirements: 17.2, 17.3.
  - 11.7 Head view in simulated input. `ui/GardenStage.tsx` calls `stepHeadView` from `marrow/core` each frame with the simulated pointer and the play aspect. The offset goes to `scene/sceneSetup.ts` (`frameDataOf` takes the head) and to `session/stageDriver.ts` (`drawnTargetsOf` takes the head view), so the hit centres and the drawn discs share one view. Tests: in `stageDriver.test.ts`, a valid pointer at the left edge, the centre and the right edge gives −0.3, 0 and +0.3, and an invalid pointer eases to 0 within 500 ms; `tests/e2e/lantern-frame.spec.ts` is extended to head −0.3, 0 and +0.3, with drawn and hit centres within one pixel. Requirements: marrow-input 6.7 and 6.8 (this task's requirement ids are in the marrow-input spec, not this spec's list above).
  - 11.8 Head view with camera input. Depends on 10.2, which records the neutral nose and shoulder width. In camera mode, `ui/GardenStage.tsx` runs `stepHeadView` on the presence clock with the same offset path as 11.7. Skip head view gives (0, 0). Tests: the camera cases in marrow's `headView.test.ts` already cover the signal; the garden test checks that a moved nose moves the offset in the expected direction, that skip gives (0, 0), and that 11.7's frame test passes with camera input. Requirements: marrow-input 9.1 to 9.10 (see the note in 11.7).
  - Verification: typecheck, lint, test and `npm run test:e2e` pass, including the flicker pixel check of 11.6 and the head checks of 11.7. Then `npm run dev` and a keyboard-only walk through Home and Pause, reported in the commit body.
  - _Requirements: 7.3, 7.5, 9.3, 9.4, 13.1, 15.1, 15.2, 15.3, 16.1, 16.2, 16.3, 17.2, 17.3, 17.4, 17.5, 18.3, 18.6, 20.1, 20.2, 20.3, 20.4, 20.5, 24.1, 24.2, 24.3, 24.4, 24.5_

- [ ] 12. End to end, repo checks and the deploy check
  - 12.1 `tests/e2e/garden-level.spec.ts`: Home to the end card in simulated input, with Reduced motion and audio muted. The test asserts the test id `end-card`, and it runs without a camera. The same file covers Escape and keyboard activation, the touch move on the play area, `?start=bloom`, and an unknown `?start` id.
  - 12.2 Extend `tests/content-security-policy.test.ts`: parse the built CSP and assert `connect-src 'self'` (21.1, 21.3). Extend `tests/vendored-assets.test.ts` if the new files need it (21.2).
  - 12.3 `tests/no-image-files.test.ts` (new): no PNG, SVG, JPG or WebP file is added under `apps/garden-of-echoes` by this spec. The allowlist is the image files already tracked at `9243e22`, read with `git ls-tree`.
  - 12.4 Run `npm run simulate -- --seed 42 --runs 50` once more, and check that the dependency rules and the wall-clock test still pass. Check that `package.json` changes add no dependency (23.4).
  - 12.5 Camera tracks: `apps/garden-of-echoes/src/ui/cameraTracks.test.tsx` (jsdom, with a fake `MediaStream` whose track `stop` calls are recorded). Exiting to Home stops every track, and unmounting the app stops every track, so no track outlives its screen (21.4).
  - 12.6 Deploy check on the public URL. Steering requires the owner's approval before a deploy, so this task stops and asks before deploying. After approval, run the Home-to-end-card path on the built URL in simulated input.
  - Verification: typecheck, lint, test and `npm run test:e2e` pass locally. The public-URL check passes after the owner approves the deploy. The gate in `product.md` is met only when that check passes.
  - _Requirements: 3.1, 3.3, 9.3, 13.2, 18.5, 20.1, 20.2, 20.3, 20.4, 20.5, 21.1, 21.2, 21.3, 21.4, 22.1, 23.4_