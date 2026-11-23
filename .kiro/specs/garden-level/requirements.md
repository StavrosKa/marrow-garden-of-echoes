# Requirements: garden-level

## Introduction

Garden-level builds the first part of Garden of Echoes, playable end to end with placeholder art. The session runs from Home to the door of Whisper Hall. Two placeholder stages follow the door, Whisper Hall and Bloom, each with one target, so the whole session can finish in simulated-input mode.

The spec covers:

- the content-free attention primitive in `packages/marrow/src/challenges`,
- the pure session machine in `apps/garden-of-echoes/src/session`,
- Lantern Glade and Whisper Glade,
- path choice, journey A and journey B, and the two door thresholds,
- Home, Pause, instructions, level titles, and copy,
- the Web Audio synth,
- the headless simulator and the root `simulate` script,
- the `?start=<stage id>` shortcut,
- the findings from the review of marrow-input and world-view.

Final art, the themed interface, ambient particles, the hall interior, the Echo challenge, and Bloom drawing and saving are out of scope. The saved garden is covered by a later spec.

`marrow-input` and `world-view` are finished. This spec builds on their public APIs and does not change them. Any gap found in them is listed in the gap section below, not patched.

Steering references in this document:

- "steering 7" is the session state machine in `interaction-invariants.md`.
- "steering 10" is the invariant list in `interaction-invariants.md`.
- Other steering references name their file.

## Glossary

- **Presentation**: one stimulus shown in an attention round. It is either a select stimulus or a let-pass stimulus under the current rule.
- **Select stimulus**: a presentation the player should select with a completed dwell.
- **Let-pass stimulus**: a presentation the player should leave alone for the whole let-pass window.
- **Rule**: the current mapping of which shape-and-colour pair is a select stimulus. Whisper Glade uses blue drop and gold leaf.
- **Demonstration**: a fixed, non-scored display at a rule switch that shows the new rule.
- **Stimulus id**: an opaque string the challenge primitive passes through. The primitive never reads its content.
- **Sprite slot**: the typed interface through which a stage requests a sprite by name. The slot draws a placeholder now and loads a PNG later.
- **Placeholder stage**: a stage with one target and no real content, used to finish the session.

## Requirements

### Requirement 1: Session machine

**User story:** As the player, I move through the stages in order, and no stage is ever completed twice or completed while the game is paused or traveling.

#### Acceptance criteria

1. THE session machine SHALL hold the stage order `lantern-glade`, `whisper-glade`, `whisper-hall`, `bloom`, and each stage id SHALL be used unchanged in code, content, URLs and tests.
2. THE session machine SHALL follow the state sequence in steering 7: `SETUP -> CALIBRATING -> ENTERING -> PLAYING -> CELEBRATING -> TRAVELLING -> PLAYING ... -> BLOOM -> SAVED`. In this spec, the `BLOOM -> SAVED` transition ends at the placeholder end card of Requirement 9.
3. WHEN a stage completes, THE session machine SHALL make exactly one transition for that stage. A repeated or late completion event SHALL produce no transition.
4. WHILE travelling, celebrating, in playback, paused, or in a tracking hold, THE session machine SHALL not accept a gameplay completion event.
5. THE pause and tracking-hold states SHALL be suspension flags on top of the current stage. Setting or clearing them SHALL not change the active stage.
6. THE session machine SHALL be pure. It SHALL take `dtMs` and seeded input, and it SHALL not read wall-clock time, timers or randomness from the environment.

*Verification:* a fast-check property test over random event sequences, including repeated and late completions, that asserts exactly one transition per stage and no completion under any suspension flag (steering 10, item 4).

### Requirement 2: Journeys, travel and thresholds

**User story:** As the player, I walk the forest on a path that moves with me, and I reach the door of the hall.

#### Acceptance criteria

1. Journey A and journey B SHALL use the travel engine of `world-view`. They SHALL NOT use a separate travel implementation.
2. In Full motion, travel SHALL last 5 to 7 s with ease-in and ease-out. Travel SHALL start 1 to 2 s after the completion reward.
3. In Gentle motion, travel duration SHALL be the Full duration multiplied by 1.3.
4. In Reduced motion, each journey SHALL be a 1.5 s cross-fade to the next stage, and no travel scaling SHALL occur.
5. Journey B SHALL end in front of the hall door, whichever path option was chosen.
6. The two door thresholds, into Whisper Hall and out to Bloom, SHALL each be a travel of about 3 s through an opening door, made with the same travel engine and the same rules as Requirement 2.2 to 2.4.
7. Targets SHALL become active only after travel has fully stopped at the next stage.

*Verification:* unit tests for the duration ranges per motion setting, and a test that the target active flag stays false until travel stops.

### Requirement 3: Home and entry

**User story:** As the player, I start the game and choose how to play before anything asks for my camera.

#### Acceptance criteria

1. THE Home screen SHALL offer "Start" and "Try without camera". Both SHALL be real DOM buttons with a visible focus ring and an accessible name.
2. THE camera SHALL be requested only after the player presses "Start". The one-sentence explanation from steering "Camera and privacy wording" SHALL be shown before the browser prompt.
3. WHEN "Try without camera" is chosen, or the camera is denied, THE app SHALL enter simulated-input mode and show the persistent label "Simulated input".
4. THE camera setup screens (permission, hand choice, calibration) SHALL reuse the `marrow/react` components, with their text supplied through the typed `MarrowCopy` object.
5. Escape SHALL open Pause from anywhere after Home. Enter and Space SHALL activate a focused control.

### Requirement 4: Lantern Glade

**User story:** As the player, I light four lanterns one after another, and the forest begins to show colour.

#### Acceptance criteria

1. THE stage SHALL activate four lanterns one after another. The first lantern SHALL be the tutorial and SHALL show the instruction "Hold your light on the lantern."
2. Each selection SHALL play one note of the C major pentatonic scale, one note per lantern, in order. It SHALL light the lantern and reveal one colour patch.
3. The light change SHALL be eased over at least 300 ms. In Reduced motion, the light SHALL be steady.
4. After the fourth selection, the path SHALL light up and journey A SHALL begin.
5. Each lantern SHALL be placed into a usable slot by Requirement 10 (placement) and the rules in steering 4.
6. Every selection SHALL have a visual cue, and the sound cue SHALL be optional.

### Requirement 5: Whisper Glade

**User story:** As the player, I watch two spirits and choose the ones I am asked to choose, and the rule changes once in the middle.

#### Acceptance criteria

1. THE stage SHALL show two spirit positions. Presentations SHALL be shown in two blocks of three, six presentations in total.
2. Block one SHALL use the rule "select the blue drop, let the gold leaf pass".
3. Between the blocks, a demonstration SHALL show the switch to the rule "select the gold leaf, let the blue drop pass". The demonstration SHALL be fixed and SHALL NOT count as one of the six presentations.
4. Each block SHALL contain at least one select presentation and at least one let-pass presentation.
5. The order of presentations within each block SHALL be chosen from a seeded generator passed in as input. The order SHALL satisfy Requirement 5.4.
6. Each spirit SHALL pair colour with shape: blue with a drop, gold with a leaf. Colour SHALL NEVER be the only signal.
7. The stage SHALL use the attention primitive of Requirement 6. Stimulus ids SHALL be opaque. The blue and gold mapping SHALL live in the app, not in the package.
8. The instruction and mistake lines SHALL use the copy keys for the rule active in the current block. In block one, select lines use the `blueDrop` keys and pass lines use the `goldLeaf` keys. In block two, select lines use the `goldLeaf` keys and pass lines use the `blueDrop` keys. The line shown SHALL always match the rule active in the current block.

### Requirement 6: Attention round primitive

**User story:** As the developer, I can run an attention round on any content, and the primitive never needs to know what the stimuli look like.

#### Acceptance criteria

1. THE primitive `attentionRound` SHALL live in `packages/marrow/src/challenges` and SHALL be pure. It SHALL import no React, DOM, PixiJS or MediaPipe code.
2. Stimuli SHALL be opaque ids. The primitive SHALL NOT read or interpret them.
3. Each presentation SHALL be marked as select or let-pass under the current rule, and that marking SHALL be an input to the round, not a result.
4. Each presentation SHALL last at least 2.5 s. This is the 1.5 s dwell plus 1 s.
5. A let-pass presentation SHALL last its let-pass window: 4 s in Full motion and 6 s in Gentle motion. The round SHALL advance on its own after the window. No player action is needed.
6. A select presentation SHALL stay on screen until it is selected with a completed dwell, or until its select window ends. The select window is 10 s in Full motion and 15 s in Gentle motion. When the window ends with no selection, that is a mistake.
7. A mistake SHALL repeat the presentation with a hint and SHALL remove nothing from the player's progress.
8. The primitive SHALL have a rule-switch step between blocks, and the demonstration SHALL be a separate phase.
9. No countdown, timer or seconds count SHALL be shown in any attention round.
10. Every timing value above SHALL be read from the tuning module of `packages/marrow`. No timing value SHALL appear as a literal in the logic.

*Verification:* property tests over seeded rounds that assert: every block has at least one select and one let-pass presentation; each presentation lasts at least 2.5 s; a mistake never reduces progress; no timing literal appears in the logic (a lint rule or a grep test).

### Requirement 7: Mistakes, hints and bounded help

**User story:** As the player, a mistake shows me how to try again, and I always reach the end of the round.

#### Acceptance criteria

1. There are exactly two mistakes in an attention round: a select presentation whose select window ends without a completed dwell, and a dwell on a let-pass stimulus during its window.
2. A mistake SHALL repeat the presentation with the hint copy from Requirement 14 for the active rule (Requirement 5.8). No mistake SHALL remove progress.
3. "Continue with help" SHALL be reachable at any time during an attention round and from Pause. After the second mistake on one presentation, the help offer "Want a hint?" SHALL also appear, next to "Continue with help".
4. After the third mistake on one presentation, the presentation SHALL complete with help and the round SHALL continue. These values (2 and 3) are proposed starting values in the tuning module.
5. "Continue with help" SHALL reveal the next step and count it complete.
6. Every help path SHALL reach completion in a bounded number of steps. A round of six presentations, with at most three attempts each, completes in at most 18 presentations.
7. The help policy SHALL follow marrow-input Requirements 19.1 to 19.9. The primitive SHALL not add its own help timers.

*Verification:* a property test with the adversarial profile of Requirement 19 (wrong-answer rate 1.0) that asserts completion within the bound in criterion 6.

### Requirement 8: Path choice

**User story:** As the player, I choose between fireflies and candles before journey B, and either choice leads to the hall door.

#### Acceptance criteria

1. Before journey B, two targets SHALL appear: left for the fireflies, right for the candles.
2. Any active pointer SHALL be able to select either target. The choice SHALL NOT be tied to one hand.
3. Both options SHALL use the same journey B geometry, and both SHALL arrive at the hall door.
4. The choice SHALL change only the dressing along journey B. Candles SHALL stand beside the path. Glowing dots SHALL be static, and fireflies are not in this spec.
5. The placement rules of Requirement 10 and the dwell rules of marrow-input apply to both targets.

### Requirement 9: Placeholder stages and the end card

**User story:** As the tester, I can finish the whole session before the real hall and Bloom exist.

#### Acceptance criteria

1. Whisper Hall SHALL have one target. Its single dwell SHALL open the way to Bloom. The target SHALL show the instruction "Hold your light on the hall lantern."
2. Bloom SHALL have one target. Its single dwell SHALL lead to the end card.
3. The end card SHALL read "The garden waits. Bloom is not built yet." Its container SHALL have the test id `end-card`. Tests SHALL assert the test id, not the text.
4. The title "Whisper Hall" SHALL fade in when the hall door has opened, and "Lantern Garden" SHALL fade in at the start.

### Requirement 10: Placement from reach

**User story:** As the player, every target is within my reach, and resting hands never place a target.

#### Acceptance criteria

1. Each target SHALL be placed from the reach calibration of the wrist that serves it. There is no side rule: any active wrist may serve any slot. In one-hand play, only the active wrist counts.
2. A slot is usable when its hit circle, expanded by the maximum interaction-layer parallax offset, lies on valid comfort cells of the serving wrist (steering 4).
3. A slot is in the resting band when any part of its hit circle lies in the bottom quarter of the camera frame (normalized y of 0.75 or more). Placement SHALL NOT use a slot in the resting band, except as criterion 5 allows.
4. A hand in that band SHALL still be a valid pointer. Its dwell rules are the rules of steering 5, unchanged.
5. If the resting band leaves too few usable slots for a player's reach, placement MAY use slots that are in the band. It SHALL take the slots nearest the band's upper edge first, and SHALL use only as many as needed. The stage SHALL remain completable.
6. If no slot is usable at all, the app SHALL show "Retry calibration" and "Try without camera". It SHALL NOT enlarge the comfort map.
7. Dwell ownership and re-entry SHALL use the existing marrow-input rules. This spec SHALL NOT write a new dwell reducer.

*Verification:* property test over random comfort grids and reach values that asserts two things. First, every placed target and its full hit area lies inside the reachable region for every allowed head offset (steering 10, item 2). Second, no slot in the resting band is used unless the band left too few usable slots. In that case the slots used in the band are exactly the nearest to the upper edge, and no more of them are used than needed.

### Requirement 11: Calibration explains itself

**User story:** As the first-time player, I understand what calibration is measuring and how long it will take.

#### Acceptance criteria

1. The calibration screen SHALL show the painted area of reach as a clearly visible area.
2. The screen SHALL show a progress ring toward the 20 s nominal time. The ring SHALL carry no number, no seconds count and no countdown.
3. The screen SHALL show the sentence "Reach stops at the edge of the camera's view." from `src/copy`.
4. The sentence and the ring SHALL have an accessible name and SHALL meet the contrast rules of steering "Accessibility and wording".

### Requirement 12: Help read only at placement

**User story:** As the player, a change of help level never changes a round while I am playing it.

#### Acceptance criteria

1. The app SHALL read the motor level and the cognitive level only when a round is placed.
2. A help level change deferred by marrow-input Requirement 19.8 SHALL NOT affect the round in progress.
3. A test SHALL change both levels in the middle of a round and assert that the round's parameters are unchanged until the next placement.

*Note:* marrow-input 19.8 defers the change to the next event. Nothing in its public API stops a consumer from reading the level mid-round. This spec enforces the rule in the app, see the gap section.

### Requirement 13: Input safety on the play area

**User story:** As the player on a touch screen, a touch move never scrolls the page or cancels my touch.

#### Acceptance criteria

1. The play area SHALL set `touch-action: none`.
2. A test SHALL assert the computed style of the play area and that a touch move over it does not trigger a page pan.

### Requirement 14: Copy and wording

**User story:** As the player, every line is calm, short and written in the same tone.

#### Acceptance criteria

1. All player-facing text SHALL live in `apps/garden-of-echoes/src/copy`. Shared components SHALL receive their text through the typed `MarrowCopy` object.
2. Every line SHALL be English, present tense, about eight words or fewer, and one instruction at a time. The one exception is `camera.why`. Its wording comes from steering "Camera and privacy wording", and it may run longer than eight words. The copy test SHALL exempt only that key from the word limit.
3. The banned-word list of `accessibility-and-copy.md` SHALL NOT appear in any player-facing string. A test SHALL check every string in `src/copy` and in `MarrowCopy`.
4. The copy below is the draft for review. Lines are final only after the owner approves them.

| Key | Draft text |
|---|---|
| `home.start` | Start |
| `home.noCamera` | Try without camera |
| `camera.why` | The camera follows your hands and head. Video stays on this device and is never recorded or sent anywhere. |
| `label.simulated` | Simulated input |
| `calibrate.edge` | Reach stops at the edge of the camera's view. |
| `hint.light` | More light, face the window. |
| `tracking.step` | Step back into view |
| `lantern.first` | Hold your light on the lantern. |
| `lantern.next` | Light the next lantern. |
| `path.choose` | Follow the fireflies or the candles. |
| `whisper.select.blueDrop` | Reach for the blue drop. |
| `whisper.select.goldLeaf` | Reach for the gold leaf. |
| `whisper.pass.blueDrop` | Let the blue drop pass. |
| `whisper.pass.goldLeaf` | Let the gold leaf pass. |
| `whisper.demo` | Watch. Now reach for the gold leaf. |
| `mistake.select.blueDrop` | Let's watch again. Reach for the blue drop. |
| `mistake.select.goldLeaf` | Let's watch again. Reach for the gold leaf. |
| `mistake.pass.blueDrop` | Let's watch again. Let the blue drop pass. |
| `mistake.pass.goldLeaf` | Let's watch again. Let the gold leaf pass. |
| `help.offer` | Want a hint? |
| `help.continue` | Continue with help |
| `hall.target` | Hold your light on the hall lantern. |
| `title.lantern` | Lantern Garden |
| `title.hall` | Whisper Hall |
| `end.card` | The garden waits. Bloom is not built yet. |
| `pause.resume` | Resume |
| `pause.recalibrate` | Recalibrate |
| `pause.motion` | Motion |
| `pause.sound` | Sound |
| `pause.help` | Continue with help |
| `pause.restart` | Restart |
| `pause.exit` | Exit |

*Key naming:* the suffix of a select or pass key names the spirit that line refers to. Under block one's rule, the select key is `blueDrop` and the pass key is `goldLeaf`. Under block two's rule, the select key is `goldLeaf` and the pass key is `blueDrop` (Requirement 5.8).

5. Copy SHALL NOT claim therapy, rehabilitation, diagnosis or clinical benefit.

### Requirement 15: Single instruction line and live region

**User story:** As the player using a screen reader, I hear the one current instruction.

#### Acceptance criteria

1. The game SHALL show one in-world instruction line at a time.
2. The current instruction SHALL also be exposed in an `aria-live="polite"` region.
3. The quiet hint "More light, face the window." (Requirement 16.2) SHALL use the same line only when no required instruction is pending. It SHALL NEVER replace a required instruction.

### Requirement 16: Low frame rate stays playable

**User story:** As the player with a low-cost camera, the game still works, and I am told how to get more light.

#### Acceptance criteria

1. Dwell timing SHALL run on `dt` from the presence clock. No target size SHALL change because of frame rate.
2. WHEN the median delivered inference rate is below 5 per second over 10 s, THE app SHALL show "More light, face the window." once per session. The hint SHALL be quiet and never block play.
3. The tuning values for the rate threshold and the window SHALL be in the tuning module.

*Verification:* a simulation profile with slow delivery (Requirement 19) that asserts the hint appears once and the stage still completes.

### Requirement 17: Lighting and motion

**User story:** As the player sensitive to flashing, the game never strobes and I can turn motion down.

#### Acceptance criteria

1. Light changes SHALL be eased over at least 300 ms.
2. Lantern and candle flicker SHALL vary brightness by at most 15% either way, in cycles of 1.5 s or longer.
3. In Reduced motion, lantern and candle light SHALL be steady.
4. The motion setting SHALL be Full, Gentle or Reduced. It SHALL start in Reduced when `prefers-reduced-motion` is set, and SHALL change within one frame when the player changes it.
5. The Pause screen SHALL offer the motion setting.

### Requirement 18: Audio

**User story:** As the player, I hear calm notes and cues, and I can mute with one click.

#### Acceptance criteria

1. Audio SHALL be synthesized with Web Audio. No audio files SHALL be used.
2. Audio SHALL start only after an explicit user action.
3. Mute SHALL be one click away from every screen with a control.
4. Every sound cue SHALL have a visual equivalent.
5. The game SHALL be fully completable with audio muted.
6. The sound setting SHALL be in the Pause screen.

### Requirement 19: Simulator and synthetic profiles

**User story:** As the developer, I can run a full session without a camera and check it for broken rules.

#### Acceptance criteria

1. The simulator SHALL be split in two. `packages/marrow/src/sim` SHALL provide only content-free pieces: synthetic player profiles, seeded synthetic pointer and answer generation, and invariant reporting. A script in `apps/garden-of-echoes` SHALL wire those pieces to the real session machine and stage logic. The exact file location of that script is decided in the design. The `marrow` package SHALL import nothing from the app.
2. The root script `simulate` SHALL run the app script, and `npm run simulate -- --seed 42 --runs 50` SHALL be the default invocation. The flags are `--seed` and `--runs`.
3. Each run SHALL cover every synthetic profile below.
4. The output SHALL print: completion, help steps used, invariant violations and the seed.
5. The process SHALL exit with a non-zero code when any invariant is violated, and when any run does not complete.
6. The profiles and their wrong-answer rates SHALL be in the tuning module, as follows:

| Profile | Wrong-answer rate |
|---|---|
| baseline | 0 |
| limited-reach | 0.1 |
| jitter | 0.1 |
| slow | 0.2 |
| one-hand | 0.1 |
| tracking-gaps | 0.1 |
| incorrect-answers | 0.5 |
| adversarial | 1.0 |

7. The adversarial profile SHALL still finish, through help, in a bounded number of steps.

### Requirement 20: Shortcut for testing and recording

**User story:** As the tester, I can jump to any stage without going through the camera.

#### Acceptance criteria

1. `?start=<stage id>` SHALL accept `lantern-glade`, `whisper-glade`, `whisper-hall` and `bloom`.
2. The shortcut SHALL never request the camera.
3. The shortcut SHALL use simulated-input mode, with the full frame as reach.
4. The shortcut SHALL show the "Simulated input" label.
5. An unknown stage id SHALL show the Home screen and SHALL NOT crash.

### Requirement 21: Privacy and network

**User story:** As the player, nothing I do leaves my machine.

#### Acceptance criteria

1. The Content Security Policy SHALL keep `connect-src 'self'`.
2. No feature in this spec SHALL add a network origin. MediaPipe runtime and model SHALL be served from the app's own static files.
3. A test SHALL parse the built CSP and assert `connect-src 'self'`.
4. Video frames SHALL NOT be stored or sent. All camera tracks SHALL stop on exit and when the app unmounts.

### Requirement 22: Placeholder art and the sprite-slot interface

**User story:** As the owner, I can replace placeholder shapes with final PNG files without changing any logic.

#### Acceptance criteria

1. The agent SHALL create no images. No PNG, SVG or other image file is created by this spec.
2. Where a sprite is needed (lanterns, spirits, doors), a plain geometric placeholder SHALL be drawn in code.
3. All sprites SHALL be requested through the same sprite-slot interface. The interface takes a stable name and returns a drawable.
4. Replacing a placeholder with a PNG file SHALL need no change to stage logic. Only the slot's source changes.

### Requirement 23: Architecture and dependencies

**User story:** As the developer, the logic stays pure and testable, and the dependency set stays unchanged.

#### Acceptance criteria

1. Logic under `packages/marrow/src/core`, `src/challenges`, `src/sim`, and `apps/garden-of-echoes/src/session` SHALL import no React, PixiJS, DOM or MediaPipe code.
2. Logic SHALL NOT call `Date.now()`, `performance.now()` or `setTimeout`. Time SHALL arrive as `dtMs`.
3. Every tunable value SHALL live in a typed tuning module of the package that owns it, and SHALL be validated at startup.
4. No new dependency SHALL be added. Web Audio is built into the browser. Vitest, fast-check and Playwright are already installed.
5. The public APIs of `marrow-input` and `world-view` SHALL NOT change.
6. Throwaway files SHALL go under `.scratch/` at the repository root.
7. The `packages/marrow` package SHALL import nothing from `apps/garden-of-echoes`.

### Requirement 24: Accessibility of controls

**User story:** As the player using a keyboard, I can reach every control.

#### Acceptance criteria

1. Every menu, overlay and settings control SHALL be a real DOM element with a visible focus ring and an accessible name.
2. Nothing essential SHALL exist only inside the canvas.
3. Interactive text and buttons SHALL meet WCAG AA contrast against their actual background. UI text SHALL be at least 16 px.
4. The Pause screen SHALL offer: resume, recalibrate, motion setting, audio setting, "Continue with help" (copy key `pause.help`), restart, and exit. "Continue with help" from Pause behaves as in Requirement 7.5.
5. Restart SHALL begin again at `lantern-glade` with no confirmation, because no progress is saved in this spec. Exit SHALL return to Home.

*Owner-approved:* restart needs no confirmation, since nothing is saved.

## Acceptance tests

### Steering 10 items (property or simulation tests)

| Steering 10 item | Test | Requirements |
|---|---|---|
| 3. For any view, `screenToWorld(worldToScreen(p))` returns `p`, and the rendered target position equals the hit-test position | Property test in `world-view` and a simulation check of the app's rendered target against the hit test | 2, 10 |
| 4. Exactly one transition per stage; no completion while travelling, celebrating, in playback, paused or in tracking hold | Property test over random event sequences, plus simulator invariant | 1 |
| 6. At most one adaptation axis changes per round boundary; every help path completes in a bounded number of steps | Property test over seeded rounds and the adversarial profile | 7, 12, 19 |
| 8. Camera denied leads to simulated input and full completion. Reduced motion and mute leave every stage completable | Simulator runs with profiles, plus the Playwright test below | 3, 17, 18, 19 |

### Playwright

One test SHALL complete Home to the end card in simulated-input mode, with Reduced motion set and audio muted. The test SHALL assert the test id `end-card`. It SHALL NOT need a camera.

### Other checks

- Test for touch-action on the play area (Requirement 13).
- Test that no timing literal appears in attention logic (Requirement 6).
- Test that the CSP keeps `connect-src 'self'` (Requirement 21).
- Test that copy contains no banned word (Requirement 14).
- Test that copy lines other than `camera.why` are eight words or fewer (Requirement 14.2).
- Test over seeded rounds that, for every presentation in Whisper Glade, the select and pass lines use the keys for the rule active in that block, and that each of the eight per-rule keys exists and is used (Requirement 5.8).
- `npm run typecheck`, `npm run lint` and `npm test` pass. The results are reported with their output.

## Tuning values introduced by this spec

| Value | Full | Gentle | Owner |
|---|---|---|---|
| Presentation minimum | 2.5 s | 2.5 s | attention (`marrow`) |
| Let-pass window | 4 s | 6 s | attention (`marrow`) |
| Select window | 10 s | 15 s | attention (`marrow`) |
| Help offer after mistakes | 2 | 2 | attention (`marrow`) |
| Forced completion after mistakes | 3 | 3 | attention (`marrow`) |
| Resting band (normalized y) | 0.75 | 0.75 | placement (`marrow`) |
| Low-rate hint threshold | 5 per s over 10 s | same | camera (`marrow`) |
| Synthetic wrong-answer rates | per profile, Requirement 19 | same | simulator (`marrow`) |

Travel durations and the parallax values come from steering and are not repeated here.

## Gap list: marrow-input and world-view

Listed, not patched. This is the first gap found. The review of the public API is still in progress and more gaps may follow.

1. **Mid-round help change.** marrow-input 19.8 defers a help change to the next event. Nothing in the public API stops a consumer from reading the level in the middle of a round. This spec enforces the rule in the app (Requirement 12). A public-API fix belongs in marrow-input, in a later change the owner approves.

## Owner confirmation

1. Copy approved, except the keys changed in this revision: the eight per-rule whisper and mistake keys, and `pause.help`. Those keys are not approved yet and need your review.
2. Restart without confirmation: approved.
3. Forced completion after 3 mistakes and the help offer after 2: approved.
