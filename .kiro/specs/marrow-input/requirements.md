# Requirements Document

## Introduction

This spec covers the input and interaction core of Marrow in `packages/marrow` (`src/core`, `src/input`, `src/react`) and a neutral input playground in `apps/garden-of-echoes/src/dev` that proves it with a camera and with simulated input.

It follows `.kiro/steering/interaction-invariants.md` (sections 1-6, 9 and 10), `performance-budget.md`, `accessibility-and-copy.md`, `art-and-motion.md` ("Palette and type", placeholder rule), `structure.md` and `tech.md`. Where this document adds a rule that steering does not contain, the rule comes from the user's answers to the open questions (listed in Appendix D). Every number that is new relative to steering is listed in Appendix B.

Acceptance criteria use EARS wording. Criteria that start with "FOR ALL" are properties and become fast-check tests. Times are in milliseconds unless written in seconds. Every number written in a criterion is the starting value of a key in `tuning.ts`; tests read the value from the tuning object, never from a literal.

## Glossary

- **Camera space**: MediaPipe normalized image coordinates of the unmirrored camera image, x and y in 0..1, origin top-left.
- **Frame aspect** (`a`): camera image width divided by height, carried in every PoseFrame.
- **Aspect-corrected coordinates**: camera-space point (x * a, y). All camera-space distances (shoulder width, head offset) are measured in these units.
- **Play area**: the full browser viewport.
- **Screen space**: normalized play-area coordinates, x in 0..A, y in 0..1, origin top-left, where A is play-area width divided by height. Pointers, hit areas and placement live here.
- **Base mapping**: camera space to screen space without gain: mirror once (u = 1 - x), then scale uniformly by k = max(A / a, 1) about the centres, so the camera image covers the play area: s = (A/2 + (u*a - a/2) * k, 1/2 + (y - 1/2) * k).
- **Reach gain** (`g`): uniform scale about the comfort centre `c` applied after the base mapping: s' = c + g * (s - c).
- **Mapping**: the composition of base mapping and reach gain, with its exact inverse. It is the only conversion between camera space and screen space.
- **Active wrist**: in camera mode, a wrist the player chose (right, left or both); in simulated-input mode, the right wrist.
- **Pointer**: per active wrist and per step, a screen-space position and a validity flag.
- **Comfort grid**: per active wrist, a 32 x 24 grid over camera space holding the number of valid samples per cell.
- **Valid cell**: a cell with at least 4 valid samples.
- **Slot**: a candidate target centre in screen space, supplied by the caller in a fixed order.
- **Hit area**: a circle in screen space (centre, radius) for one target, supplied by the caller in every step together with the target id and its activation id.
- **Expanded circle**: a hit circle whose radius is increased by the parallax margin `m`.
- **Demand**: the placement request (slots, needed count N, hit radius r, parallax margin m).
- **Placement result**: `simultaneous` (N slots), `sequential` (k usable slots, 1 <= k, targets shown one at a time) or `none`.
- **Owner**: the pointer that holds a target. **Progress**: the dwell time accumulated by the current hold. **Hold**: a target state with an owner.
- **Activation**: one period in which a target is selectable, identified by an activation id the caller supplies with the hit area.
- **Step**: one call of a pure function `step(state, input, dtMs) -> { state, events }`.
- **Presence clock**, **session clock**: the two clocks of steering section 6.
- **Tracking hold**: the suspension of the session clock while no active wrist is valid (steering section 6).
- **Simulated-input mode**: input from a mouse, touch or pen pointer instead of the camera.
- **Painting phase**: the part of calibration in which the player moves each active hand to fill the comfort grid. **Calm hold**: the part that records the neutral nose and the shoulder width.
- **Head offset**: the two-axis head-view signal in -1..1, in screen orientation, where 1 means the full parallax limit that world-view will apply later.
- **Round**, **round boundary**, **difficulty**: help-policy events supplied by the caller. Marrow does not decide what they mean in content.
- **MarrowCopy**: the typed object of every string used by `marrow/react`, supplied by the app from `src/copy`.
- **Rule value**: a number in steering not marked *(tune)*; changed only with the user's approval. **Tune value**: a number marked *(tune)* in steering, or a new starting value from Appendix B.
- **Playground**: the screen at `?playground=1`.

Component names used in the criteria: Tuning, PoseFrame, Camera Source, Pointer Source, Trace Source, Pointer Filter, Head View, Mapping, Calibration, Placement, Dwell Engine, Clocks, Tracking Lifecycle, Help Policy, Settings Store, Setup UI (the components in `marrow/react`), Debug Overlay, Playground.

## Requirements

### Requirement 1: Tuning module

**User Story:** As the developer tuning with a real camera, I want every interaction number in one typed, validated module, so that I can change values in one place and never by accident.

#### Acceptance Criteria

1. THE Tuning SHALL be one typed object exported from `packages/marrow/src/core/tuning.ts` that holds every number this spec uses from steering (Appendix A) and every new number (Appendix B, except the values marked as app values).
2. THE Tuning SHALL carry a comment on each key: `tune` for values marked *(tune)* in steering and for new values from Appendix B, and `rule: change only with the user's approval` for every other value.
3. THE Tuning SHALL provide a validation function that returns every out-of-range key with its value and allowed range in a readable message.
4. WHEN the Playground loads, it SHALL validate the tuning object and, IF validation fails, THEN it SHALL show the validation message instead of running with an invalid value.
5. WHERE steering gives a range for a value (hit radius 0.07-0.13, reach gain 1.0-1.6), THE Tuning validation SHALL reject values outside that range.
6. THE logic in `packages/marrow/src/core` SHALL read every number from steering and Appendix B from the tuning object, with no other numeric literal for these values.
7. A test SHALL check that the shipped tuning object passes validation and that every key carries a `tune` or `rule` label.

### Requirement 2: PoseFrame and landmark validity

**User Story:** As the engine, I want one frame type for every input source, so that nothing downstream can tell a camera from a pointer or a trace.

#### Acceptance Criteria

1. THE PoseFrame SHALL contain a timestamp in milliseconds from the source's monotonic time, the frame aspect, and five landmarks: left wrist, right wrist, nose, left shoulder, right shoulder.
2. THE PoseFrame SHALL give each landmark a camera-space position (x, y) and a validity flag.
3. THE Camera Source SHALL take nose from landmark 0, shoulders from 11 and 12 and wrists from 15 and 16, assign MediaPipe "left" landmarks to the player's left side, and never require hip landmarks.
4. THE PoseFrame SHALL hold camera-space positions without mirroring.
5. THE core SHALL provide one pure validity function: a landmark is valid if and only if its visibility is at least 0.5 and 0 <= x <= 1 and 0 <= y <= 1.
6. THE Camera Source SHALL compute every validity flag with that function.
7. THE PoseFrame timestamp SHALL be used only inside `marrow/input` and the Debug Overlay (new-frame detection, inference rate, latency), and no pure logic SHALL use it as a clock.

### Requirement 3: PoseSource contract

**User Story:** As the app, I want camera, pointer and trace input behind one interface, so that the playground and later the game use one code path.

#### Acceptance Criteria

1. THE `marrow/input` entry point SHALL export one PoseSource interface and three implementations: Camera Source, Pointer Source and Trace Source.
2. THE PoseSource SHALL expose start (with its outcome), dispose, and the latest PoseFrame; it SHALL never queue frames for the consumer.
3. WHEN dispose is called more than once, THE PoseSource SHALL do nothing after the first call.
4. No code that consumes frames (filtering, mapping, calibration, dwell, tracking, the playground's targets) SHALL inspect which implementation produced a frame. The only differences between modes are the settings in Requirement 6.6-6.10, which the input setup passes in.

### Requirement 4: Camera Source inference

**User Story:** As a player in front of a webcam, I want my wrists and head followed smoothly, so that the pointer feels connected to my hand.

#### Acceptance Criteria

1. THE Camera Source SHALL use MediaPipe Tasks Vision Pose Landmarker with the lite model, one pose, video running mode, on the main thread.
2. THE Camera Source SHALL keep at most one video frame in inference: WHILE an inference is running, new video frames SHALL be dropped, not queued.
3. THE Camera Source SHALL start an inference no more often than the maximum inference rate (20 Hz).
4. THE Camera Source SHALL load the WASM files and the `pose_landmarker_lite` model only from the app's own public files under the configured base path, never from a third-party host.
5. THE repository SHALL record in `docs/licenses.md`, for each vendored file, its source URL, download date, licence and SHA-256.
6. THE Camera Source SHALL never send, store or record video frames or pose data.
7. THE Camera Source SHALL request the user-facing camera at 640 x 480 (ideal) and accept the size the browser delivers, setting the frame aspect from the delivered video.
8. WHILE the camera track is open but no new inference result has arrived for longer than the stale-frame timeout (500 ms), THE Camera Source SHALL publish a new PoseFrame (a fresh object) with every landmark invalid, once per stall, until a new result arrives, so that a stalled model is treated as lost tracking rather than a frozen valid pointer.

### Requirement 5: Camera lifecycle and permission outcomes

**User Story:** As a player, I want the camera asked for only when I choose it, and a calm way forward if it cannot start, so that I am never stuck.

#### Acceptance Criteria

1. THE Camera Source SHALL call `getUserMedia` only from the handler of an explicit user action (the camera button on the permission screen, Retry, or Recover).
2. WHEN start finishes, THE Camera Source SHALL report exactly one outcome: `ready`, `denied`, `no-camera` or `model-failed`.
3. IF `getUserMedia` fails with NotAllowedError or SecurityError, THEN THE Camera Source SHALL report `denied`.
4. IF `getUserMedia` is unavailable or fails with NotFoundError, OverconstrainedError, NotReadableError or AbortError (no camera, camera in use by another app, hardware error, unsupported constraints), THEN THE Camera Source SHALL report `no-camera`.
5. IF fetching the WASM files or the model fails, or the landmarker fails to initialise, or it is not ready within the model load timeout (20 s), THEN THE Camera Source SHALL report `model-failed` and stop every camera track it opened.
6. WHEN dispose is called, THE Camera Source SHALL stop every track of its MediaStream, detach the stream from every video element, and close the landmarker.
7. THE Playground SHALL call dispose on Exit, on switching to simulated input, on unmount, and on page hide.
8. IF the camera track ends while the source is running (for example the camera is unplugged), THEN THE Camera Source SHALL report every landmark as invalid until it is restarted.

### Requirement 6: Simulated input (Pointer Source)

**User Story:** As a player without a camera, I want to play with a mouse, touch or pen, so that the whole experience works without a camera.

#### Acceptance Criteria

1. THE Pointer Source SHALL follow only the primary pointer (the mouse, a pen, or the first touch) and drive the right wrist; the left wrist SHALL always be invalid.
2. THE Pointer Source SHALL report the wrist as valid only WHILE a mouse or pen pointer is over the play area, or WHILE a touch is in contact with it, and as invalid otherwise.
3. THE Pointer Source SHALL set the frame aspect to the play-area aspect A and the wrist position to the inverse base mapping of the pointer's screen position (x = 1 - s.x / A, y = s.y), so that the base mapping returns the pointer position exactly.
4. THE Pointer Source SHALL report the nose and both shoulders as valid, at fixed synthetic positions inside the frame.
5. THE Pointer Source SHALL produce at most one PoseFrame per animation frame.
6. WHILE in simulated-input mode, THE input setup SHALL use reach gain 1.0 and SHALL not apply the One Euro filter, so that the screen-space pointer equals the pointer position (steering section 2: the pointer joins the pipeline at the screen-space stage).
7. WHILE in simulated-input mode and the pointer is valid, THE Head View SHALL output x = 0.3 * (s.x - A/2) / (A/2) and y = 0, with no dead zone and no smoothing.
8. WHILE in simulated-input mode and the pointer is invalid, THE Head View SHALL ease to 0 as in Requirement 9.6.
9. WHILE in simulated-input mode, THE Tracking Lifecycle SHALL never start a tracking hold and never show the one-wrist hint; the dwell Invalid rule (Requirement 17) SHALL still apply to the pointer.
10. WHILE in simulated-input mode, THE Setup UI SHALL skip hand choice, never request the camera, never show a camera preview, and show the "Simulated input" label on every screen.

### Requirement 7: Trace Source

**User Story:** As a test author, I want to replay synthetic pose traces deterministically, so that the input pipeline can be tested without a camera or a browser.

#### Acceptance Criteria

1. THE Trace Source SHALL take a trace (an ordered list of PoseFrames) and SHALL be advanced only by elapsed milliseconds passed in by the caller.
2. WHEN advanced to elapsed time t, THE Trace Source SHALL expose the last frame whose timestamp is at most t, or no frame before the first one.
3. WHEN t passes the last timestamp, THE Trace Source SHALL keep exposing the last frame and report that the trace has ended.
4. THE Trace Source SHALL run in Node without a DOM.
5. IF a trace is malformed (missing fields, timestamps not increasing, a frame aspect that is not positive), THEN THE Trace Source SHALL reject it with a readable message naming the first bad frame.
6. Traces in `tests/traces` SHALL be synthetic (written by hand or generated by code); no trace SHALL be recorded from a real person.

### Requirement 8: Pointer filter

**User Story:** As a player, I want a steady pointer that never drags old positions along after my hand reappears, so that aiming is calm and predictable.

#### Acceptance Criteria

1. THE Pointer Filter SHALL apply one One Euro filter per active wrist to the camera-space wrist position, with minCutoff 1.2 Hz, beta 0.02 and dCutoff 1 Hz.
2. THE Pointer Filter SHALL update only when a new PoseFrame is consumed, using as its time delta the presence-clock time since the previous consumed frame.
3. WHEN a consumed frame has the wrist valid and the previous consumed frame had it invalid, THE Pointer Filter SHALL reset and output that sample unchanged.
4. WHEN play resumes after Pause or after the tab was hidden, THE Pointer Filter SHALL reset, so that the first valid sample after resume is output unchanged.
5. FOR ALL sample sequences that contain an invalid sample, THE Pointer Filter's outputs after that invalid sample SHALL be identical for any two sequences that differ only before it (positions before and after a gap are never blended).
6. FOR ALL sample sequences, including time deltas of 0, THE Pointer Filter SHALL produce finite outputs.
7. WHILE a wrist is invalid, THE pointer for that wrist SHALL be invalid, and its last filtered position SHALL not be used by any logic.

### Requirement 9: Head view signal

**User Story:** As a player, I want the view to respond to my head and settle when my head is out of view, so that parallax feels like a window and never jumps.

#### Acceptance Criteria

1. THE Head View SHALL use the neutral nose position and shoulder width recorded by the calm hold (Requirement 12) and SHALL not use the current shoulder positions.
2. THE Head View SHALL compute, per axis, d = (nose - neutral nose) / shoulder width in aspect-corrected coordinates, with the x axis mirrored once so that a head moving to the right of the screen gives d.x > 0, and y growing downwards.
3. THE Head View SHALL compute, per axis, raw = sign(d) * max(0, |d| - 0.05) / (0.25 - 0.05), clamped to -1..1.
4. THE Head View SHALL smooth raw per axis with exponential smoothing of time constant 120 ms on the presence clock: out += (raw - out) * (1 - exp(-dt / 120)).
5. FOR ALL d1 and d2, THE raw value SHALL satisfy: raw is 0 when |d| <= 0.05; raw is exactly sign(d) when |d| >= 0.25; and |raw(d1) - raw(d2)| <= |d1 - d2| / 0.2 (continuous at the dead-zone edge).
6. WHEN the nose becomes invalid, THE Head View SHALL move its output towards 0 so that |out| never increases and out is exactly 0 from 500 ms of presence time after the nose became invalid, for as long as the nose stays invalid.
7. WHEN the nose becomes valid again, THE Head View SHALL continue from its current output through the smoothing of 9.4, with no jump.
8. WHILE "Skip head view" is in effect for the session, THE Head View SHALL output (0, 0).
9. FOR ALL frame sequences, THE Head View output SHALL stay within -1..1 on both axes.
10. FOR ALL pairs of frame sequences that differ only in shoulder positions after calibration, THE Head View outputs SHALL be equal.
11. THE Head View SHALL never change pointer positions, hit areas, dwell or tracking state.

### Requirement 10: Camera-to-screen mapping

**User Story:** As a player, I want my right hand to appear on the right and a small comfortable movement to cover a usable part of the screen, so that reaching feels natural.

#### Acceptance Criteria

1. THE Mapping SHALL be the base mapping followed by the reach gain, as defined in the glossary, and SHALL be the only conversion between camera space and screen space.
2. THE Mapping SHALL mirror exactly once: FOR ALL mappings and camera points p, q with the same y and p.x < q.x, map(p).x > map(q).x.
3. FOR ALL play-area aspects A in 1.0..2.4, frame aspects a in 1.0..2.4, gains g in 1.0..1.6, comfort centres c inside the play area and camera points p, THE Mapping SHALL satisfy |inverse(map(p)) - p| <= 1e-9 and |map(inverse(s)) - s| <= 1e-9 for screen points s.
4. THE Mapping SHALL use the same gain and centre for every active wrist.
5. WHILE in simulated-input mode, THE Mapping SHALL use gain 1.0.

### Requirement 11: Calibration, painting phase

**User Story:** As a seated or one-handed player, I want to show the game where I can comfortably reach, so that it only ever asks me to reach there.

#### Acceptance Criteria

1. WHEN the painting phase starts, THE Calibration SHALL create one empty comfort grid (32 x 24 cells over camera space) per active wrist.
2. WHEN a frame is consumed in which an active wrist is valid, THE Calibration SHALL add one sample to that wrist's grid, in the cell containing the wrist's camera-space position after the Pointer Filter stage: column min(floor(x * 32), 31), row min(floor(y * 24), 23).
3. THE Calibration SHALL treat a cell as valid if and only if it holds at least 4 samples.
4. FOR ALL sample sequences, a cell SHALL be valid only if at least 4 valid samples fell inside it; cells inside the bounding box, the convex hull or the gaps between sampled cells SHALL never become valid without their own samples.
5. THE Calibration SHALL measure painting time on the presence clock and count it only in steps in which at least one active wrist is valid.
6. WHEN painting time is at least 20 s and the demand is met, THE Calibration SHALL end the painting phase in that step.
7. WHEN painting time is at least 12 s and the demand is met and no cell of any active wrist has become valid during the last 2 s of painting time, THE Calibration SHALL end the painting phase.
8. WHEN the painting phase has ended, THE Calibration SHALL add no further samples to the grids.
9. WHEN painting time reaches 30 s, THE Calibration SHALL end the painting phase whether or not the demand is met.
10. THE Calibration SHALL never end the painting phase before 12 s of painting time, except through "Use the whole screen".
11. THE Calibration SHALL decide whether the demand is met by running Placement (Requirement 14) with the reach gain and centre computed from the current grids (Requirement 13); the demand is met when the result is `simultaneous`.
12. WHILE in camera mode and no active wrist has been valid for more than 1000 ms during the painting phase, THE Setup UI SHALL show the calibration hand hint with a "Try without camera" control next to it.
13. WHEN the player activates Retry at any point of calibration, THE Calibration SHALL clear every grid, the neutral head data and all calibration timers, and restart the painting phase.
14. WHERE simulated-input mode is active, THE Setup UI SHALL show a "Use the whole screen" control throughout calibration.
15. WHEN the player activates "Use the whole screen", THE Calibration SHALL mark every cell of the pointer's grid as valid and end calibration at once, skipping the calm hold.
16. THE Setup UI SHALL never offer "Use the whole screen" in camera mode.
17. WHILE calibration is running, THE Tracking Lifecycle SHALL not start a tracking hold and SHALL not show the tracking-lost overlay.

### Requirement 12: Calibration, calm hold and "Skip head view"

**User Story:** As a player, I want the game to learn my resting head position, and to go on without head view if my face and shoulders cannot be seen, so that setup never blocks me.

#### Acceptance Criteria

1. WHEN the painting phase ends (other than through "Use the whole screen"), THE Calibration SHALL start the calm hold.
2. THE Calibration SHALL complete the calm hold after 2 s of continuous presence time in which the nose and both shoulders are valid in every consumed frame.
3. IF the nose or a shoulder is invalid in a consumed frame during the calm hold, THEN THE Calibration SHALL restart the 2 s and THE Setup UI SHALL show "Keep your face and shoulders in view" until they are all valid again.
4. WHEN the calm hold completes, THE Calibration SHALL record the neutral nose as the mean camera-space nose position, and the shoulder width as the mean aspect-corrected distance between the shoulders, over the frames of the completing 2 s.
5. THE Calibration SHALL not require the wrists during the calm hold, and SHALL not require the head to be still.
6. WHEN 5 s of presence time have passed since the calm hold started and it has not completed, THE Setup UI SHALL also offer "Skip head view".
7. WHEN the player activates "Skip head view", THE Calibration SHALL complete without neutral head data, and Head View SHALL output (0, 0) until the next calibration; everything else SHALL continue.
8. WHEN calibration completes, THE Calibration SHALL compute the reach gain and centre once (Requirement 13) and THE Playground SHALL start play without a confirmation step.
9. THE Calibration SHALL keep no calibration data after Exit or a page reload; a returning player calibrates again.
10. WHILE in simulated-input mode, THE calm hold SHALL complete after 2 s, because the synthetic nose and shoulders are always valid.

### Requirement 13: Comfort centre and reach gain

**User Story:** As a player with a small comfortable range, I want that range to cover a usable part of the screen, so that I can reach targets without straining.

#### Acceptance Criteria

1. THE Calibration SHALL compute the comfort centre c as the mean of the base-mapped centres of all valid cells of all active wrists (each cell counted once per wrist).
2. THE Calibration SHALL compute span as the larger side of the screen-space bounding box (at gain 1) of all valid cells of all active wrists, cells taken as whole rectangles.
3. THE Calibration SHALL compute the reach gain as g = clamp(0.6 / span, 1.0, 1.6).
4. IF no cell is valid, THEN THE Calibration SHALL use g = 1.0 and c = the play-area centre.
5. THE bounding box SHALL be used only to size the gain; reachability SHALL be decided only from valid cells through the Mapping (Requirement 14).
6. FOR ALL grids, THE computed gain SHALL lie in 1.0..1.6, and the set of valid cells SHALL be identical before and after the gain is computed.
7. WHILE in simulated-input mode, THE Calibration SHALL use g = 1.0 and c = the play-area centre.

### Requirement 14: Placement in the comfort region

**User Story:** As a player, I want every target placed where I have actually reached, so that nothing ever asks me to reach beyond my comfortable range.

#### Acceptance Criteria

1. THE Placement SHALL be a pure function of the demand (slots in order, needed count N >= 1, hit radius r, parallax margin m >= 0), the comfort grids of the active wrists, and the Mapping.
2. THE Placement SHALL call a slot usable if and only if there is one active wrist whose valid cells contain every screen point within distance r + m of the slot, each point converted to camera space with the inverse Mapping; a point that falls outside the camera frame is not covered.
3. THE Placement SHALL not combine the cells of two wrists to cover one slot.
4. THE Placement SHALL choose slots in one pass: walk the usable slots in caller order and choose each one whose expanded circle overlaps no expanded circle already chosen, until N are chosen. IF the pass chooses N slots, THEN THE Placement SHALL return `simultaneous` with them.
5. IF at least one slot is usable but the pass chooses fewer than N, THEN THE Placement SHALL return `sequential` with all usable slots in caller order (k of them), and target i (from 0) SHALL be shown alone in usable slot i mod k.
6. IF no slot is usable, THEN THE Placement SHALL return `none`.
7. THE Placement SHALL never change a comfort grid, and no code SHALL enlarge a comfort grid to make a placement succeed.
8. FOR ALL grids (including grids with holes and several separate regions), gains 1.0..1.6, centres, aspects A and a in 1.0..2.4, slots, radii 0.07..0.13 and margins 0..0.05: for every slot s returned in a `simultaneous` or `sequential` result there SHALL exist one active wrist w such that, for every offset o with |o| <= m and every point p with |p - (s + o)| <= r, the inverse Mapping of p lies inside the camera frame and in a valid cell of w (steering section 10 invariant 2, at the level of this spec).
9. FOR ALL grids and demands, adding samples SHALL never make a usable slot unusable at the same gain and centre, and removing a valid cell SHALL never make an unusable slot usable.
10. FOR ALL `simultaneous` results, the N expanded circles SHALL be pairwise disjoint.

### Requirement 15: Comfort aura

**User Story:** As a player, I want to see the region I have painted as a soft glow, so that I know where the game will put things.

#### Acceptance Criteria

1. THE core SHALL provide a pure aura function that gives, for any screen point, an intensity in 0..1 from the comfort grids and the Mapping.
2. FOR ALL grids and screen points, THE aura intensity SHALL be greater than 0 only at points whose inverse Mapping lies in a valid cell of an active wrist.
3. THE aura function SHALL give intensity 0 for cells with 1 to 3 samples.
4. THE aura function SHALL soften edges only inwards: intensity may fall towards the edge of the valid region but never extends past it.
5. THE Setup UI SHALL draw the aura during calibration from the aura function and update it at least once per consumed frame that changes a cell's validity.

### Requirement 16: Presence and session clocks

**User Story:** As a player, I want time to stop when I pause, leave the tab or step out of view, so that the game never moves on without me.

#### Acceptance Criteria

1. THE Clocks SHALL be a pure step function that takes the raw frame delta and the flags paused, hidden and tracking hold, and returns the presence delta and the session delta.
2. THE Clocks SHALL clamp the raw delta to 0..100 ms, and SHALL treat a negative or non-finite delta as 0.
3. WHILE paused or hidden, THE Clocks SHALL return presence delta 0 and session delta 0.
4. WHILE not paused, not hidden and not in a tracking hold, THE Clocks SHALL return presence delta = session delta = the clamped delta.
5. WHILE in a tracking hold and neither paused nor hidden, THE Clocks SHALL return presence delta = the clamped delta and session delta 0.
6. FOR ALL sequences of raw deltas and flags, presence delta SHALL be in 0..100 and session delta SHALL be in 0..presence delta.
7. THE Dwell Engine, the Tracking Lifecycle, the Pointer Filter, the Head View smoothing and the Calibration SHALL run on the presence clock. Any later timed game behaviour (playback, presentation, help timers) runs on the session clock; this spec has none. DOM transitions in the Setup UI are presentation only and change no logic state.
8. THE pure logic in `packages/marrow/src/core` SHALL not call `Date.now()`, `performance.now()`, `setTimeout`, `setInterval` or `requestAnimationFrame`.

### Requirement 17: Dwell selection

**User Story:** As a player, I want to select a target by resting my pointer on it, without accidental or double selections, so that holding still is all it takes.

#### Acceptance Criteria

1. THE Dwell Engine SHALL be a pure step function whose input is the presence delta dt (0..100), the pointer of each active wrist (validity and screen position), and the hit areas of this step, each with target id, activation id, centre and radius in screen space.
2. THE Dwell Engine SHALL consider only targets supplied in the current step.
3. THE Dwell Engine SHALL classify the owner of a held target in each step as exactly one of: Inside (valid and distance to the centre <= radius), Outside (valid and distance > radius), Invalid (not valid).
4. WHEN a target has no owner, is not latched, its activation has not produced a selection, and at least one pointer is valid and inside its hit area, THE Dwell Engine SHALL make that pointer the owner with progress 0; IF several pointers qualify in the same step, THEN the one nearest the centre SHALL own it, and on an exact tie the right wrist SHALL own it.
5. THE step in which a pointer acquires a target SHALL add no progress.
6. WHILE the owner is Inside, THE Dwell Engine SHALL add dt to progress and set both the Outside and the Invalid timer to 0.
7. WHILE the owner is Outside, THE Dwell Engine SHALL keep progress unchanged, add dt to the Outside timer and set the Invalid timer to 0; WHEN the Outside timer exceeds 150 ms, it SHALL set progress to 0 and release ownership in that step.
8. WHILE the owner is Invalid, THE Dwell Engine SHALL keep progress unchanged, add dt to the Invalid timer and set the Outside timer to 0; WHEN the Invalid timer exceeds 300 ms, it SHALL cancel the hold (progress 0, ownership released) in that step.
9. THE Dwell Engine SHALL never let a pointer that is not the owner change a held target's progress, timers or owner.
10. WHEN ownership is released (rules 7 and 8), any active pointer SHALL be able to start a new hold from progress 0 from the next step on, as in rule 4.
11. WHEN progress reaches 1500 ms, THE Dwell Engine SHALL in that step emit exactly one selection event (target id, activation id, wrist), set progress to 0, release ownership, mark that activation as used, and latch the target with the set of pointers that are valid and inside its hit area in that step.
12. WHILE a target is latched, THE Dwell Engine SHALL let no pointer acquire it; a pointer SHALL leave the latch set only in a step in which it is valid and outside the hit area; going invalid SHALL not count as leaving; the latch SHALL end when the set is empty.
13. THE Dwell Engine SHALL never emit a second selection for an activation that has produced one.
14. WHEN a target's activation id changes, or the target is not supplied in a step, THE Dwell Engine SHALL drop its hold (progress 0, no owner, no event of selection) and keep its latch.
15. THE Dwell Engine SHALL expose, for each supplied target, its owner, progress in ms and progress as a fraction of the dwell time.

Properties (steering section 10 invariant 1). Each is a named fast-check test. Generators: step deltas 0..100; one or two pointers with independent validity gaps and paths that enter, leave, cross and rest on targets; several targets with radii 0.07..0.13 that may overlap; activation changes and removals.

16. FOR ALL step sequences, in every step each target's progress SHALL increase by exactly dt when the same pointer owned it at the start and the end of the step and that pointer was Inside, and SHALL not increase otherwise (time is never counted twice, and never counted for two pointers).
17. FOR ALL step sequences, the progress reached in a selecting step SHALL equal the sum of dt over the owner's Inside steps after it acquired the target, and that sum SHALL be at least 1500 ms (time across a gap is never counted).
18. FOR ALL step sequences, every selection event SHALL occur in a step in which the selecting pointer is valid and inside the target's hit area.
19. FOR ALL step sequences with two pointers, while a target has an owner, replacing the other pointer's path with any other path SHALL leave that target's state unchanged until the owner releases it.
20. FOR ALL step sequences, between two selections of the same target the activation id SHALL differ, and every pointer latched by the first selection SHALL have had a step in which it was valid and outside the hit area.
21. FOR ALL step sequences, ownership SHALL be released by the Outside rule exactly in the first step in which continuous Outside time exceeds 150 ms, and by the Invalid rule exactly in the first step in which continuous Invalid time exceeds 300 ms, never earlier.
22. FOR ALL step sequences in which every continuous Outside stint is at most 150 ms and every continuous Invalid stint is at most 300 ms, the Outside and Invalid rules SHALL never release ownership, whatever the total time of the stints.

### Requirement 18: Tracking lifecycle

**User Story:** As a camera player, I want the game to hold still when it cannot see my hands and to resume calmly when I return, so that I never lose progress to a tracking gap.

#### Acceptance Criteria

1. THE Tracking Lifecycle SHALL be a pure step function whose input is the presence delta, the validity of each active wrist, the validity of the nose, and whether calibration or simulated-input mode is active.
2. THE Tracking Lifecycle SHALL measure continuous lost time (presence time in which no active wrist is valid) and reset it to 0 in any step in which an active wrist is valid.
3. WHEN continuous lost time exceeds 300 ms, THE Tracking Lifecycle SHALL begin a tracking hold in that step, and the Clocks SHALL receive the hold flag from that step on.
4. WHEN continuous lost time exceeds 1000 ms during a tracking hold, THE Tracking Lifecycle SHALL show the "Step back into view" overlay, and it SHALL stay shown until the hold ends.
5. WHILE in a tracking hold, THE Tracking Lifecycle SHALL measure continuous valid time (presence time in which at least one active wrist is valid) and reset it to 0 in any step with no valid active wrist.
6. WHEN continuous valid time reaches 1000 ms, THE Tracking Lifecycle SHALL end the hold and hide the overlay in that step.
7. WHILE the nose is invalid and at least one active wrist is valid, THE Tracking Lifecycle SHALL not begin a hold; Head View eases to centre (Requirement 9.6) and play continues.
8. WHILE one active wrist is invalid and another active wrist is valid, THE Tracking Lifecycle SHALL not begin a hold; a hold on a target owned by the invalid wrist SHALL follow the Invalid rule (Requirement 17.8).
9. WHEN, outside calibration, one active wrist has been invalid for more than 1000 ms while another active wrist is valid, THE Setup UI SHALL show the one-wrist hint, and SHALL hide it when that wrist is valid again or a tracking hold begins.
10. WHILE calibration is running or simulated-input mode is active, THE Tracking Lifecycle SHALL never begin a tracking hold.
11. THE Pause and the tracking hold SHALL be flags only: they SHALL never change the current playground round or its targets.

Properties (steering section 10 invariant 5). Each is a named fast-check test. Generators: per-step validity of each active wrist and the nose with gaps of 0..2000 ms, short flickers, step deltas 0..100, pause and hidden periods.

12. FOR ALL step sequences in which at least one active wrist is valid in every step and the nose validity is arbitrary, no tracking hold SHALL begin, the session delta SHALL equal the presence delta in every step, and the Dwell Engine state SHALL be identical to the state for the same sequence with the nose always valid (losing only the head never cancels a valid wrist hold).
13. FOR ALL step sequences outside calibration and simulated-input mode, the session clock SHALL advance by the full clamped delta in every step that is not paused, not hidden and not in a hold, SHALL not advance in any step in a hold, and a hold SHALL begin in the first step in which continuous lost time exceeds 300 ms and in no earlier step.
14. FOR ALL step sequences, a hold SHALL end only in a step in which continuous valid time reaches 1000 ms; valid stretches shorter than 1000 ms, however many, SHALL never end it.

### Requirement 19: Help policy

**User Story:** As a player who finds a round hard, I want gentle help that never changes under my hand and always lets me finish, so that difficulty never blocks the journey.

#### Acceptance Criteria

1. THE Help Policy SHALL be a pure, content-free step function over these events: round started (with its step count n >= 1), difficulty (axis motor or cognitive), step completed, continue with help, and round ended. Each event carries whether a dwell or playback is active, and round ended carries whether a motor step is allowed.
2. THE Help Policy SHALL not decide what counts as a difficulty; the caller reports each one with its axis.
3. WHEN the second difficulty of a round (either axis) is reported, THE Help Policy SHALL emit "offer help" once for that round.
4. WHEN a round ends with at least two difficulties, THE Help Policy SHALL raise at most one axis by one level: the axis with more difficulties in that round; on a tie, the axis that was not changed last; for the first change of a session, motor.
5. IF the chosen axis is at its highest level, or it is motor and the caller reports that a motor step is not allowed (Placement would not succeed with the larger radius), THEN THE Help Policy SHALL raise the other axis if it can, and otherwise change nothing.
6. THE Help Policy SHALL keep each level in 0..2, and SHALL never lower a level within a session.
7. THE Help Policy SHALL map motor levels 0, 1, 2 to hit radii 0.09, 0.11, 0.13; cognitive levels are integers whose meaning the app defines.
8. THE Help Policy SHALL change a level only while processing a round-ended event that reports no active dwell and no playback. IF a round ends while a dwell or playback is active, THEN THE Help Policy SHALL apply the pending change at the next event that reports neither, before handling that event.
9. THE Help Policy SHALL accept "continue with help" in every state of a round; WHEN it is used, the policy SHALL emit "reveal step" for the current step and count that step as completed.
10. THE Playground SHALL not use the Help Policy in this spec; it is covered by tests.

Properties (steering section 10 invariant 6). Each is a named fast-check test. Generators: sessions of 1..8 rounds with n in 1..10, any interleaving of difficulties, step completions and "continue with help", random dwell and playback flags, motor step allowed or not.

11. FOR ALL event sequences, each processed event SHALL change at most one axis, by exactly +1, and only in a round-ended event or a deferred application processed with no active dwell and no playback; levels SHALL stay in 0..2 and never decrease.
12. FOR ALL rounds and any events before it, a round with n steps and c steps completed SHALL reach completion after at most n - c further "continue with help" events, with no other event required (every help path completes in a bounded number of steps).
13. FOR ALL sessions, the total number of level changes SHALL be at most 4.

### Requirement 20: Settings store

**User Story:** As a player, I want my motion, sound and hand choices remembered on this browser, so that I do not set them again each visit.

#### Acceptance Criteria

1. THE Settings Store SHALL keep exactly these settings: motion (Full, Gentle or Reduced), mute (on or off), volume (0..1) and hands (right, left or both).
2. THE Settings Store SHALL write them to localStorage as versioned JSON under keys that all start with one fixed prefix supplied by the app.
3. THE Settings Store SHALL parse and validate stored data with a pure function: IF the data is not valid JSON or has an unknown version, THEN all settings SHALL take their defaults; IF one field is invalid, THEN only that field SHALL take its default.
4. FOR ALL strings stored under the settings key, reading SHALL never throw and SHALL return valid settings.
5. IF localStorage is unavailable or a write fails, THEN THE Settings Store SHALL keep the settings in memory for the rest of the page's life and show no message.
6. THE Settings Store SHALL use these defaults: motion Reduced when the browser reports `prefers-reduced-motion: reduce` and no motion choice is stored, otherwise Full; mute off; volume 0.6; hands not chosen.
7. WHEN a motion choice is stored, THE Settings Store SHALL use it instead of the browser preference.
8. WHEN a setting changes, THE Settings Store SHALL notify every subscriber before the next animation frame.
9. THE Settings Store SHALL never store calibration data, pose data or video.
10. THE motion setting SHALL have no visible effect in this spec, because this spec adds no motion effects; world-view applies it later.

### Requirement 21: MarrowCopy and wording

**User Story:** As the author of the game's text, I want every string in one typed place, so that wording rules can be checked and the engine stays free of player-facing text.

#### Acceptance Criteria

1. THE Setup UI SHALL take every string it shows, including accessible names and debug labels, from a typed MarrowCopy object supplied through a React provider, and SHALL contain no player-facing string of its own.
2. THE app SHALL fill MarrowCopy in `apps/garden-of-echoes/src/copy`, and a missing entry SHALL be a type error.
3. THE MarrowCopy SHALL contain entries for: the start screen title and its Start control; the camera explanation sentence; "Use the camera"; "Try without camera"; the denied, no-camera and model-failed messages; Retry; the hand choice question with Right, Left, Both and Continue; the painting instruction; the calm hold instruction; "Keep your face and shoulders in view"; "Skip head view"; "Use the whole screen"; the calibration hand hint; the no-usable-slot message with "Retry calibration"; Pause, Resume, Recalibrate, Exit; the settings labels (motion, Full, Gentle, Reduced, sound, mute, volume); "Step back into view"; the accessible name of the tracking-lost placeholder picture; Recover; the one-wrist hint; "Simulated input"; the camera preview's accessible name; and the debug overlay labels.
4. THE copy SHALL use these texts as written in steering: "Keep your face and shoulders in view", "Skip head view", "Step back into view", "Retry calibration", "Try without camera", "Simulated input", Retry, Recover, Exit.
5. THE camera explanation SHALL be one sentence saying that the camera follows the player's hands and head, and that video stays on this device and is never recorded or sent anywhere.
6. THE copy SHALL follow `accessibility-and-copy.md`: English, one instruction at a time, present tense, calm, describing what to do next.
7. A test SHALL fail IF any string in `apps/garden-of-echoes/src/copy` contains a banned word from `accessibility-and-copy.md` (whole word, any case), or IF an entry marked as an instruction has more than 8 words.

### Requirement 22: Setup screens

**User Story:** As a player, I want a short, clear setup with or without a camera, so that I reach play quickly and always have a way forward.

#### Acceptance Criteria

1. THE Playground SHALL begin with a start screen whose Start control is the first user action; audio may start only from it (Requirement 27).
2. WHEN Start is activated, THE Setup UI SHALL show the camera permission screen with the camera explanation and two controls, "Use the camera" and "Try without camera", and SHALL not request the camera before "Use the camera" is activated.
3. WHEN the Camera Source reports `denied`, `no-camera` or `model-failed`, THE Setup UI SHALL show that outcome's own calm message with Retry and "Try without camera"; Retry SHALL request the camera again from its click handler.
4. WHEN the Camera Source reports `ready`, THE Setup UI SHALL show hand choice: a radio group Right, Left, Both with Continue. The stored choice SHALL be pre-selected; with none stored, nothing SHALL be selected and Continue SHALL be disabled until a choice is made. The choice SHALL be stored.
5. WHILE hand choice or calibration is shown in camera mode, THE Setup UI SHALL show a small mirrored live camera preview, at most 320 CSS px wide.
6. WHEN play starts, THE Setup UI SHALL remove the preview and detach the stream from it; there SHALL be no camera preview during play.
7. THE calibration screen SHALL show the aura, the orb of each valid active wrist, the current instruction, Retry, and the calm hold messages and controls of Requirement 12, and in simulated-input mode "Use the whole screen".
8. WHEN Placement returns `none`, THE Setup UI SHALL show the no-usable-slot message with "Retry calibration" and "Try without camera" in camera mode, or with "Retry calibration" and "Use the whole screen" in simulated-input mode.
9. WHILE simulated-input mode is active, THE Setup UI SHALL show the "Simulated input" label on every screen.
10. THE Setup UI SHALL expose the current instruction in an `aria-live="polite"` region on every screen.

### Requirement 23: Pause and tracking-lost overlays

**User Story:** As a player, I want to pause at any moment and to be guided back when the camera loses me, so that I stay in control.

#### Acceptance Criteria

1. WHEN Escape is pressed on any screen after the start screen, THE Setup UI SHALL open Pause; WHEN Escape is pressed or Resume is activated in Pause, it SHALL close Pause.
2. Every screen after the start screen SHALL show a mute control, and the play and calibration screens SHALL also show a Pause control; both SHALL work by mouse, touch and keyboard, so that mute is one click away.
3. WHILE Pause is open, THE Clocks SHALL receive the paused flag.
4. THE Pause overlay SHALL offer Resume, Recalibrate, the motion setting (Full, Gentle, Reduced), mute, volume, and Exit.
5. WHEN Recalibrate is activated, THE Setup UI SHALL go to hand choice with the current hands pre-selected in camera mode, or straight to calibration in simulated-input mode.
6. WHEN Exit is activated, THE Playground SHALL dispose the Camera Source, discard calibration and return to the start screen.
7. WHEN the Tracking Lifecycle shows the overlay, THE Setup UI SHALL show "Step back into view" with a simple placeholder picture and Recover, "Try without camera" and Exit.
8. WHEN Recover is activated, THE Playground SHALL dispose and restart the Camera Source from that click, keep the calibration, and keep the overlay until the hold ends; IF the restart reports an outcome other than `ready`, THEN THE Setup UI SHALL show that outcome's screen.
9. WHEN "Try without camera" is activated in the overlay, THE Playground SHALL dispose the Camera Source and start calibration with the Pointer Source.
10. WHILE a tracking hold is in effect, THE Playground SHALL dim its play area, eased over at least 300 ms, and keep every target where it is.

### Requirement 24: Accessibility and placeholder look

**User Story:** As a player using a mouse, touch or keyboard, I want every control to be a real, readable control, so that the placeholder look never costs usability.

#### Acceptance Criteria

1. THE Setup UI and the Playground SHALL make every menu, overlay and settings control a real DOM element (button, radio, checkbox or range input) with an accessible name, reachable by mouse, touch and keyboard, activated by Enter or Space when focused.
2. THE Setup UI SHALL show a visible focus ring on every focusable control, and no style SHALL remove it.
3. THE Setup UI SHALL use text of at least 16 px and button text of at least 18 px.
4. THE components in `marrow/react` SHALL hold no palette values and SHALL read colours, fonts, radii and spacing from CSS custom properties named `--marrow-*`, with neutral grey defaults.
5. THE app SHALL set the `--marrow-*` properties from its theme module in `src/ui`, using only the grey ramp and `lanternWarm` as the single accent (art-and-motion.md placeholder rule), with the fallback font stacks named in art-and-motion.md.
6. A test SHALL check that every text colour and background colour pair used by the Setup UI and the Playground has a WCAG contrast ratio of at least 4.5:1.
7. THE Setup UI and the Playground SHALL ease every change of light (dimming, completion highlight) over at least 300 ms and SHALL never flash.
8. THE Playground SHALL show a completed target with a different shape as well as a different colour, and SHALL show dwell progress by the length of the ring's arc.
9. THE Playground SHALL pair every sound with a visual change and SHALL be fully usable muted.

### Requirement 25: Debug overlay

**User Story:** As the developer, I want to see rates, validity, the comfort grid and every hit area live, so that I can tune with a real camera and check placement by eye.

#### Acceptance Criteria

1. WHERE the URL contains `debug=1`, THE Debug Overlay SHALL be shown on every Playground screen; otherwise it SHALL not be rendered.
2. THE Debug Overlay SHALL show: render frames per second and inference results per second, each over the last 1 s; the validity of each active wrist and of the nose; the comfort grid of each active wrist drawn through the current Mapping; every hit area supplied to the Dwell Engine in the current frame; the head offset; and the internal pipeline latency from a PoseFrame's timestamp to the first render that draws it, labelled as excluding camera and display latency.
3. WHILE in simulated-input mode, THE Debug Overlay SHALL show the pointer frame rate in place of the inference rate.
4. THE Debug Overlay SHALL take no pointer input, contain no focusable element, and change no logic state.
5. THE Debug Overlay SHALL draw from the same state the Playground uses in the same frame.

### Requirement 26: Input playground

**User Story:** As the developer, I want a neutral screen that runs the whole input core, so that I can prove it with a mouse and with my wrist before any stage exists.

#### Acceptance Criteria

1. THE Playground SHALL be reachable only when the URL contains `playground=1`; without it, the app SHALL show its current page unchanged.
2. THE Playground SHALL be loaded as a separate lazily loaded chunk and SHALL work in `npm run dev` and in the deployed build under `BASE_PATH`.
3. THE Playground SHALL read its candidate slots (15 slots in screen space, in order) and its target count (3) from a JSON file in `apps/garden-of-echoes/src/dev`, validated at load with a readable error.
4. WHEN calibration completes, THE Playground SHALL run Placement with N = 3, r = the tuning hit radius (0.09) and m = 0, and show the targets as the result says: three at once (`simultaneous`), one at a time (`sequential`), or the no-usable-slot screen (`none`).
5. THE Playground SHALL draw each target as a plain placeholder shape whose visible extent never goes beyond its hit area, with no story content.
6. THE Playground SHALL, in every frame, give the Dwell Engine the presence delta, the pointers and the hit areas of the open targets of the current round.
7. THE Playground SHALL draw each valid active wrist as a small orb at its screen pointer and hide the orb while that wrist is invalid.
8. THE Playground SHALL draw a progress ring on each target that has an owner and progress above 0, and on no other target.
9. WHEN the Dwell Engine selects a target, THE Playground SHALL show it as completed (eased over at least 300 ms), play its own tone unless muted, and stop supplying it to the Dwell Engine.
10. WHEN every target of a round is completed, THE Playground SHALL start a new round of three targets with new activation ids, taking the usable slots in rotation so that the new round avoids the last round's slots where enough usable slots exist.
11. THE Playground SHALL run the same code after the PoseSource in camera mode and in simulated-input mode.
12. THE Playground's instruction and labels SHALL come from `apps/garden-of-echoes/src/copy`.

### Requirement 27: Playground audio

**User Story:** As a player, I want a soft tone when a target completes, and silence until I choose to start, so that sound is pleasant and never sudden.

#### Acceptance Criteria

1. THE Playground SHALL create or resume its AudioContext only in the handler of the Start control.
2. THE Playground SHALL synthesize tones with Web Audio oscillators and use no audio files.
3. THE Playground SHALL give the three targets of a round three different pentatonic notes (C5, E5, G5), each a sine tone of about 400 ms with a soft attack and release.
4. THE Playground SHALL set the master gain to volume x 0.5, and SHALL ramp every gain change (volume, mute) over 100 ms, never jumping.
5. WHILE mute is on, THE master gain SHALL be 0.

### Requirement 28: Repository rules, dependencies and tests

**User Story:** As the maintainer, I want this spec to keep every structural rule and to prove its invariants with tests, so that later specs build on a checked core.

#### Acceptance Criteria

1. THE implementation SHALL place pure logic in `packages/marrow/src/core`, PoseSource implementations in `src/input`, shared UI and settings storage in `src/react`, and the Playground in `apps/garden-of-echoes/src/dev`, with copy in `src/copy`, theme tokens in `src/ui` and the tone player in `src/audio`.
2. THE app SHALL import Marrow only through `marrow/core`, `marrow/input` and `marrow/react`.
3. THE code in `packages/marrow/src/core` SHALL import no React, PixiJS, DOM or MediaPipe; MediaPipe SHALL be imported only in `packages/marrow/src/input`.
4. THE files in `packages/` SHALL contain no story words and no player-facing text, as checked by `eslint.config.js` and `tests/dependency-graph.test.ts`.
5. WHEN `@mediapipe/tasks-vision` is needed, its exact version SHALL be proposed in design.md and installed only after the user's approval.
6. WHEN component tests are added, every package they need (including peer dependencies) SHALL be listed with exact version and licence and installed only after the user's approval.
7. THE test files SHALL not add lint exceptions or weaken any rule in `eslint.config.js` or `tests/dependency-graph.test.ts`, and test files inside `packages/` SHALL obey the same content and text rules as other files there.
8. THE repository SHALL have one named fast-check test for each property criterion ("FOR ALL") in Requirements 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19 and 20; IF a property test fails, THEN its seed SHALL be kept as a regression test and recorded in `docs/bugs-found.md`.
9. THE repository SHALL have component tests for the setup screens, the overlays, the Settings Store and the Debug Overlay, including a test that "Use the whole screen" is never rendered in camera mode.
10. THE repository SHALL have Playwright tests, in simulated-input mode only, that: (a) choose "Try without camera", paint with the mouse until calibration ends, see three targets, hold the mouse on each until it completes, and see a new round; (b) do the same through "Use the whole screen"; (c) open Pause with Escape and close it with Resume; (d) confirm the camera is never requested on the simulated path; (e) confirm the page without `playground=1` is unchanged.
11. THE `docs/licenses.md` file SHALL list every new dependency, and every vendored file with its source URL, download date, licence and SHA-256.
12. A task in this spec SHALL count as done only when `npm run typecheck`, `npm run lint` and `npm test` pass, and `npm run test:e2e` for tasks that change UI.

## Out of scope

PixiJS scenes, world projection, head parallax rendering and view lock, travel, every stage, the session state machine and Home, challenge primitives, the help UI ("Want a hint?", "Continue with help" screens), the simulator, Web Worker inference, torso lean, jitter-based sizing, the themed interface pass and font files, and applying the motion setting.

## Appendix A: Steering numbers used by this spec

Each lives in `packages/marrow/src/core/tuning.ts` with the label shown. `tune` = marked *(tune)* in steering; `rule` = "rule: change only with the user's approval".

| Value | Meaning | Source | Label |
|---|---|---|---|
| 0.5 | Minimum landmark visibility | invariants 1 | tune |
| 1.2 Hz, 0.02, 1 Hz | One Euro minCutoff, beta, dCutoff | invariants 2 | tune |
| 1.0-1.6 | Reach gain range | invariants 2 | tune |
| 0.3 | Simulated head strength | invariants 2 | tune |
| 20 s, 12 s, 30 s | Calibration nominal, earliest finish, cap | invariants 3 | tune |
| 2 s | Calm hold | invariants 3 | rule |
| 5 s | "Skip head view" offered after | invariants 3 | rule |
| 32 x 24 | Comfort grid | invariants 3 | tune |
| 4 | Samples for a valid cell | invariants 3 | tune |
| 0.09 (0.07-0.13) | Hit radius, fraction of viewport height | invariants 4 | tune |
| 1.5 s | Dwell time | invariants 5 | tune |
| 150 ms | Outside window | invariants 5 | rule |
| 300 ms | Invalid window | invariants 5 | rule |
| 100 ms | Maximum clock step | invariants 6 | rule |
| 0.5 s | Head ease to centre | invariants 6 | rule |
| 1 s | One-wrist hint delay | invariants 6 | rule |
| 300 ms | Tracking hold starts after | invariants 6 | rule |
| 1 s | Tracking-lost overlay after | invariants 6 | rule |
| 1 s | Resume after continuous valid tracking | invariants 6 | tune |
| 0.05 | Head dead zone, in shoulder widths | invariants 8 | tune |
| 2 | Difficulties in a round before help | invariants 9 | rule |

Also used, not from interaction-invariants.md: camera request 640 x 480 (tech.md); 16 px text and 300 ms light easing (accessibility-and-copy.md); 18 px button text and the placeholder colours (art-and-motion.md). Numbers for later specs (parallax limits, interaction-layer factor, travel and threshold times, motion multipliers) go into world-view's tuning module in the world-view spec.

## Appendix B: Numbers that are new relative to steering

All are starting values labelled `tune`. Engine values live in marrow's `tuning.ts`; app values live in the app next to the code that uses them.

| Value | Meaning | Where | Requirement |
|---|---|---|---|
| 20 s | Model load timeout | marrow tuning | 5.5 |
| 2 s | Early finish needs no new valid cell for this long | marrow tuning | 11.7 |
| 0.25 | Head offset clamp, in shoulder widths (output 1 at the clamp) | marrow tuning | 9.3 |
| 120 ms | Head offset smoothing time constant | marrow tuning | 9.4 |
| 0.6 | Target span for the reach gain, in screen units | marrow tuning | 13.3 |
| motor 0-2 (0.09, 0.11, 0.13), cognitive 0-2 | Help levels | marrow tuning | 19.6, 19.7 |
| 1 s | Calibration hand hint delay | marrow tuning | 11.12 |
| 20 Hz | Maximum inference rate (from the 15-20 Hz budget target) | marrow tuning | 4.3 |
| 500 ms | Stale-frame timeout: landmarks invalid after no new inference result for this long | marrow tuning | 4.8 |
| 0.6 | Default volume | marrow tuning | 20.6 |
| 1 s | Debug overlay rate window | marrow tuning | 25.2 |
| 320 CSS px | Maximum camera preview width | app | 22.5 |
| 15 slots, 3 targets | Playground content | app (JSON) | 26.3 |
| C5, E5, G5; about 400 ms | Playground tones | app | 27.3 |
| 0.5 | Master gain cap | app | 27.4 |
| 100 ms | Gain ramp | app | 27.4 |

Generator ranges and tolerances inside property criteria (for example aspects 1.0..2.4, margins 0..0.05, 1e-9) are test parameters, not tuning values.

## Appendix C: Steering section 10 invariants covered here

| Invariant | Covered by |
|---|---|
| 1. Dwell never counts time twice, never selects on invalid input, respects ownership, requires re-entry | Requirement 17, criteria 16-22 |
| 2. Every placed target and its full hit area stay inside the reachable region for every allowed head offset | Requirement 14, criteria 8-10, with 11.4 and 15.2. At this level the head offset is the caller's margin m; world-view checks its projection against it later |
| 5. Head-only loss never cancels a valid wrist hold; the session clock stops after more than 300 ms, not before, and restarts only after 1 s of continuous valid tracking | Requirement 18, criteria 12-14 |
| 6. At most one adaptation axis changes per round boundary; every help path completes in a bounded number of steps | Requirement 19, criteria 11-13 |

Invariants 3, 4, 7 and 8 belong to later specs. The first part of invariant 8 (camera denied, then simulated input) starts here, in Requirement 22.3.

## Appendix D: Decisions behind this document

From the user's answers (all recommendations accepted, with these changes):

- Simulated input: hand choice skipped, the pointer drives the right wrist, calibration painted with the pointer, plus the "Use the whole screen" control in simulated-input mode only (Requirements 6, 11.14-11.16).
- Head offset formula: per axis, output = sign(d) * (|d| - 0.05) / (0.25 - 0.05), clamped to -1..1, smoothing after that (Requirement 9.3-9.5). Taken literally, the formula gives a value of the opposite sign inside the dead zone (d = 0.01 gives -0.2), so Requirement 9.3 writes max(0, |d| - 0.05) to keep the output 0 there. It is unchanged outside the dead zone.
- Tuning labels: `tune` and `rule: change only with the user's approval` on every value (Requirement 1.2).
- Component tests approved in principle; the package list waits for approval (Requirement 28.6).
- MediaPipe version waits for approval in design.md; WASM and model vendored in the app's public files, with SHA-256 in `docs/licenses.md` (Requirements 4.4, 4.5, 28.5).

Conflicts with the prompt, resolved in favour of steering: simulated input joins at the screen-space stage (Requirement 6.6-6.7); only *(tune)* values are tuning values, the rest are rules (Appendix A); later-spec numbers stay out of marrow's tuning; steering items the prompt did not list are included (one-wrist hint, stored hands, Reduced default, Escape, aria-live, mute, theme properties); no tracking hold during calibration (Requirement 11.17); the PoseFrame timestamp is not a logic clock (Requirement 2.7).

Since the questions were asked, `art-and-motion.md` gained a final palette. This document follows its placeholder rule: only the grey ramp and `lanternWarm`, with `--marrow-*` CSS properties (Requirement 24.4-24.5).

Choices this document makes that neither steering nor the answers settle. Each can be changed before design:

1. The step in which a pointer acquires a target adds no progress (17.5).
2. After a release, another pointer can acquire from the next step (17.10).
3. If the chosen help axis cannot step, the other axis steps instead (19.5).
4. Hand choice with nothing stored has nothing pre-selected (22.4).
5. The calibration hand hint shows "Try without camera" in camera mode, so calibration has no dead end (11.12).
6. The no-usable-slot screen offers "Use the whole screen" in simulated-input mode, because "Try without camera" does not apply there (22.8).
7. Recalibrate goes through hand choice in camera mode (23.5).
8. "Use the whole screen" also skips the calm hold, which simulated input does not need (11.15).
9. The Pointer Source follows only the primary pointer (6.1).
10. The camera is disposed on page hide as well as on Exit and unmount (5.7).
11. Fonts use the fallback stacks until the themed pass (24.5).
