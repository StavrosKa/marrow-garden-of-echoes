# Requirements Document

## Introduction

This spec covers the shared view model for 2.5D scenes in `packages/world-view` (`src/core` pure, `src/pixi` Pixi helpers) and a proof slice in `apps/garden-of-echoes/src/dev` at `?playground=world`. The slice uses flat placeholder shapes, Marrow's placement function, Marrow's dwell engine, the mouse and the camera.

It follows `.kiro/steering/interaction-invariants.md` (sections 6, 7, 8 and 10), `art-and-motion.md` ("Palette and type", placeholder rule, "Travel", depth layers), `structure.md`, `tech.md`, `performance-budget.md` and `accessibility-and-copy.md`. It reuses `MotionLevel` and the settings store from `marrow` (task 14). It defines no second motion type.

Acceptance criteria use EARS wording. Criteria that start with "FOR ALL" are properties and become fast-check tests. Times are in milliseconds unless written in seconds. Every number written in a criterion is the starting value of a key in `packages/world-view/src/core/tuning.ts` (or an app value, marked as such in Appendix B); tests read the value from the tuning object, never from a literal.

This session writes requirements only. There is no design and no code. Appendix D lists the decisions that came from the user's answers and the ones I made; the ones I made are marked for review.

## Glossary

- **Screen space**: Marrow's normalised play-area coordinates: x in 0..A, y in 0..1, origin top left, A = play-area width divided by height. World-view uses it for every screen-side value. Only `src/pixi` converts it to pixels.
- **Depth**: a number along the travel axis. A larger depth is farther away.
- **Travel distance** (`travel`): how far the view has moved along the path, in the same units as depth.
- **Head offset**: a two-axis value in -1..1, in screen orientation, where 1 is the full parallax limit. It is the output of Marrow's Head View (task 10), changed by the glide and the motion level.
- **View**: the value `{ travel, head }`: the travel distance and the head offset.
- **Layer**: a group of drawn things with one parallax factor and one nominal depth. Layer ids are content-free names (`layer-0` ..) in the package; the app names them.
- **World point**: `{ x, y, depth, anchor, factor }`: a position in layer units, the depth of the point, its anchor and the parallax factor of its layer.
- **Projection frame** (`frame`): the value `{ aspect, sceneScale }`: the play-area aspect A and the scene parallax scale. The caller builds one per rendered frame and passes the same object to every call of `worldToScreen`, `screenToWorld` and `targetScreen` in that frame.
- **Anchor**: the travel distance at which a point's depth scaling is exactly 1. A point is authored at its anchor.
- **Interaction layer**: the layer that carries the targets. Its factor is `interactionFactor`. Targets of different stops sit on it at the depth of their stop.
- **Decorative layers**: every layer except the interaction layer.
- **Vanishing point**: the screen point (A/2, `vanishingPointY`) that depth scaling is centred on.
- **Depth scale** (`s`): the factor `(depth - anchor) / (depth - travel)`. It is 1 at the anchor, grows towards the viewer and tends to 1 for a far depth.
- **Near plane**: a depth distance `nearPlane`. A point with `depth - travel <= nearPlane` is **culled**: it has no screen position.
- **Parallax shift**: the screen displacement of a layer caused by the head offset.
- **Scene parallax scale**: a number in 0..1 supplied per scene that multiplies every parallax limit (1 for the forest, 0.6 for the hall; the app supplies it).
- **Glide**: the per-render-frame follow of the Head View output (Requirement 5).
- **Lock**: the view lock of steering section 8 (Requirement 6).
- **Travel step**: the pure function that advances a travel (Requirement 7). **Segment**: the finite pre-defined path `{ from, to, durationMs }` it moves along, with `from` and `to` travel distances.
- **Stop**: a travel distance at which the view rests and targets can be active.
- **Hit circle**: the screen-space circle `{ centre, radius }` of one target, built by world-view with `worldToScreen`.
- **Presence clock**, **session clock**, **tracking hold**: as in steering section 6 and Marrow's Clocks.
- **Motion profile**: the table of multipliers and switches for one `MotionLevel` (Requirement 8).
- **Scene Manager**: the object in `src/pixi` that owns the Pixi application and the render loop.
- **World Playground**: the screen at `?playground=world`.
- **Reachable region**: the set of screen points that Marrow's `isSlotUsable` accepts for a hit radius and a margin.
- **Backdrop layer**: a layer drawn as a rectangle that must cover the whole viewport (Requirement 4). Other layers are made of shapes that need not.
- **Style**: how a travel is shown, `travel` (the view moves) or `fade` (a cross-fade, Requirement 8.4).
- **Head driver**: a dev-only control under `?playground=world` that replaces the Head View output (Requirement 12.10).

## Requirements

### Requirement 1: Tuning module

**User Story:** As the developer, I want every view number in one typed, validated module, so that I can change values in one place and never by accident.

#### Acceptance Criteria

1. THE World-view Tuning SHALL be one typed object exported from `packages/world-view/src/core/tuning.ts` that holds every number in Appendix A and Appendix B marked as a package value.
2. THE Tuning SHALL carry a comment on each key: `tune` for values marked *(tune)* in steering and for new values, and `rule: change only with the user's approval` for every other value.
3. THE Tuning SHALL provide a validation function that returns every out-of-range key with its value and allowed range in a readable message.
4. THE validation SHALL reject: a parallax factor outside 0..1; a layer table in which the factor is not non-increasing as depth increases; a layer with `depth - anchor <= nearPlane`; an interaction factor that is not below the largest factor of the layer table; `nearPlane <= 0`; a glide time constant `<= 0`; a glide cap `<= 0`; a multiplier below 0; a cross-fade duration `<= 0`; `minFadeMs` below 600, not above `2 * maxClockStepMs` of Marrow, or above `crossFadeMs`; `arrivalToleranceMs < 0`. These rules SHALL not name any layer.
5. WHEN the World Playground loads, it SHALL validate the world-view tuning object, the layer table and the stop content, and IF validation fails, THEN it SHALL show the message instead of running.
6. THE logic in `packages/world-view/src/core` SHALL read every number of Appendix A and B from the tuning object, with no other numeric literal for these values.
7. A test SHALL check that the shipped tuning passes validation and that every key carries a `tune` or `rule` label.

### Requirement 2: View, layers and the two conversions

**User Story:** As a scene author, I want one pair of conversions between world and screen, so that what is drawn and what is hit are always the same place.

#### Acceptance Criteria

1. THE View Model SHALL export a function `worldToScreen(point, view, frame)` and a function `screenToWorld(screenPoint, view, layer, frame)` from `world-view`, where `layer` supplies the depth, the anchor and the factor of the point (the inverse needs them) and `frame` is the projection frame (the aspect A for the vanishing point and the horizontal shift, the scene parallax scale for the shift).
2. THE View Model SHALL be the only code in the repository that converts between world and screen space. Rendering, hit testing, placement of targets from slots and the margin calculation SHALL call these functions.
3. THE `worldToScreen` function SHALL return, for a point that is not culled, the screen position `v + (p - v) * s + shift`, where `v` is the vanishing point `(frame.aspect / 2, vanishingPointY)`, `p` is `(x, y)` in screen units, `s` is the depth scale and `shift` is the parallax shift of Requirement 3 for `view.head` and `frame`.
4. THE depth scale SHALL be `s = (depth - anchor) / (depth - view.travel)`.
5. WHEN `depth - view.travel <= nearPlane`, THE `worldToScreen` function SHALL return no position (culled).
6. FOR ALL valid views, all projection frames (aspect from 1.0 to 2.4, scene scale in 0..1) and all non-culled points, `screenToWorld(worldToScreen(p, view, frame), view, layer, frame)` SHALL equal `p` within a relative tolerance of 1e-9. A valid view has a finite `travel` inside the range of its segments and a head offset in -1..1 on both axes.
7. FOR ALL views, THE depth scale SHALL not decrease as `travel` increases, SHALL be exactly 1 when `travel` equals the anchor, and SHALL be greater than 1 when `travel` is greater than the anchor.
8. FOR ALL segments, THE depth scaling SHALL meet the thresholds that Appendix B states for that segment (growth depends on the distance travelled, so the forest segment and the door segment have their own): for every layer with depth at least `horizonDepth`, the screen position of any point inside the viewport (aspect up to 2.4, head offset 0) SHALL change by less than the segment's `horizonMaxMove` between the start and the end of the segment, and for every layer with depth at most `foregroundDepth`, the depth scale at the end of the segment divided by the depth scale at its start SHALL be at least the segment's `foregroundMinGrowth`. A single flat image zoom SHALL not be used: two layers with different depths SHALL get different scales for the same `travel`.
9. THE View Model SHALL not read the clock, the DOM or Pixi, and SHALL import only `marrow/core` types and pure functions.
10. THE draw order of layers SHALL be the order of depth, from the farthest to the nearest, and the layer table SHALL list the layers in that order. There is no exception for any layer.

### Requirement 3: Parallax factors, limits and direction

**User Story:** As the player, I want the scene to move like a window when my head moves, with the far scenery staying still, so that depth is felt without any roll or zoom.

#### Acceptance Criteria

1. THE Parallax SHALL compute the shift of a point as `shift.x = -head.x * factor * limitX * A * sceneScale` and `shift.y = -head.y * factor * limitY * sceneScale` (`A` is `frame.aspect` and `sceneScale` is `frame.sceneScale`), with `limitX = 0.03` and `limitY = 0.02` of the viewport at factor 1 (the nearest layer).
2. WHEN the head offset x is greater than 0 (the head moved to the right of the screen), THE shift x of every layer with factor greater than 0 SHALL be less than 0, and a layer with a smaller depth SHALL shift at least as much as one with a larger depth (strictly more when the factors differ).
3. THE Parallax SHALL use the factors of Appendix B (sky 0.00, far hills 0.03, far trees 0.10, interaction layer 0.20, fog 0.60, foreground 1.00; in order of depth: sky, far hills, far trees, interaction layer, fog, foreground) and no roll and no head-driven zoom: the head offset SHALL not change the depth scale.
4. THE Parallax SHALL multiply every limit by the scene parallax scale of the scene, which is 1 for the forest and 0.6 for the hall (the hall value is an app value, passed in; the package holds no name from the story).
5. FOR ALL head offsets in -1..1 on both axes, scene scales in 0..1 and layers, THE absolute shift of a layer SHALL not exceed `factor * limit * sceneScale` on each axis.
6. FOR ALL head offsets, THE shift of the interaction layer SHALL not exceed 0.2 of the shift of the nearest layer for the same head offset and scene scale.
7. THE Parallax SHALL be one pure function of the head offset applied to each layer. Layers SHALL not be shifted in any other way.

### Requirement 4: Overscan

**User Story:** As the player, I want never to see the edge of a layer, so that the world looks continuous at every head position and every travel distance.

#### Acceptance Criteria

1. THE layer table SHALL mark each layer as a backdrop layer or not. A backdrop layer is drawn as a rectangle that must cover the viewport (in the slice: sky and far hills). Any other layer is made of shapes (trunks, foliage, fog patches, targets) that need not cover it.
2. THE View Model SHALL export a pure function that returns, for a backdrop layer, a travel range and a projection frame, the smallest drawn rectangle (in layer units) that covers the whole viewport for every travel distance in the range and every head offset in -1..1, extended past the viewport by at least the maximum parallax shift of the layer on each axis, after the depth scale is taken into account.
3. THE View Model SHALL export a pure function `edgeOverscan(layer, frame)` that returns, for any other layer, the maximum parallax shift of the layer on each axis in screen units (`factor * limit * frame.sceneScale`, with `frame.aspect` for x). A shape of that layer that touches a viewport edge at the rest view (head offset 0, travel equal to the anchor of the layer) SHALL extend past that edge by at least this amount. The content validation (Requirements 1.5 and 11.9) SHALL reject a shape that does not.
4. THE Scene Manager SHALL draw each backdrop layer with a rectangle at least as large as the one 4.2 returns for the travel range of the scene.
5. FOR ALL backdrop layers, travel distances in the range, and head offsets in -1..1 on both axes, WHILE the layer is not culled, THE screen image of the drawn rectangle SHALL contain the viewport `[0, A] x [0, 1]`.
6. FOR ALL other layers, shapes that touch a viewport edge at rest and extend past it by at least `edgeOverscan`, travel distances in the range (the depth scale is at least 1 there, so it moves an edge only outwards) and head offsets in -1..1 on both axes, THE shape SHALL still reach that viewport edge, so no edge of the shape is exposed, and the validation of 4.3 SHALL accept every such shape.
7. THE overscan SHALL hold for every `MotionLevel`, because the Gentle and Reduced shifts are never larger than the Full one.
8. A culled layer SHALL be removed from the render, and SHALL not leave an exposed edge: the backdrop layers behind it SHALL still satisfy 4.5.

### Requirement 5: Head glide

**User Story:** As the player on a slow machine with a backlit webcam, I want the view to move smoothly even when pose frames arrive at 7 per second, so that I see no steps.

#### Acceptance Criteria

1. THE Glide SHALL be a pure step `stepGlide(state, targetHead, dtMs) -> state`, with `targetHead` the latest output of Marrow's Head View (held unchanged between pose frames) multiplied by the head multiplier of the current motion profile (Requirement 8).
2. THE Glide SHALL run once per rendered frame on the presence clock delta (clamped to 100 ms by Marrow's Clocks) and SHALL not run on pose frames.
3. THE Glide SHALL move each axis by `(target - out) * (1 - exp(-dt / tau))`, with `tau = 150 ms`, and SHALL then limit the move of each axis to `cap * dt / 1000`, with `cap = 4.0` head units per second.
4. THE World-view SHALL contain no second ease to centre for lost tracking. WHEN Marrow's Head View eases its output to 0 over 500 ms (steering section 6), THE Glide SHALL follow that output like any other change.
5. THE World-view SHALL not derive a head offset from pose landmarks and SHALL not use the shoulder midpoint. It SHALL read only the Head View output.
6. WHILE the presence clock is stopped (pause, hidden tab), THE Glide SHALL not move.
7. FOR ALL target sequences and frame times, THE glide output SHALL stay within -1..1 on both axes and SHALL never move past its target: after a step, `out` is between the previous `out` and `target` on each axis.
8. FOR ALL target sequences, THE glide output at 60 Hz and at 144 Hz render rates SHALL agree at common times within a tolerance of 0.4 per axis (measured, not derived: over 20000 random jittered 7 Hz schedules (seed 7, the schedules of the test) the worst per-axis difference between 60 Hz and 144 Hz at common times is 0.287; 0.4 leaves about a third of margin. At 0.4 the interaction layer differs by at most 0.4 * interactionFactor * limitX * A, about 0.004 of the screen height, far below the hit radius).
9. FOR ALL target sequences that change at 7 pose frames per second, and at 7 per second with random jitter of up to 50%, WHILE the distance to the target is more than `glideEpsilon` and the frame delta is at least 1 ms, THE rendered output SHALL change on every render frame: it never holds still for more than one render frame.
10. FOR ALL target sequences and frame deltas up to 100 ms, THE change of each axis in one render frame SHALL not exceed `cap * dt / 1000` (the cap holds at 60 Hz and at 100 ms frames).
11. THE per-rendered-frame limit SHALL be stated in the test as `cap * dt / 1000`, which at the 60 Hz frame time is about 0.067 head units, and at 100 ms is 0.4.

### Requirement 6: View lock

**User Story:** As the player, I want the target to stay under my hand while I hold on it, so that my own reaching never pushes it away.

#### Acceptance Criteria

1. THE View Lock SHALL be a pure step `stepLock(state, { liveHead, lockRequested }, dtMs) -> { state, interactionHead, decorativeHead }`, where `lockRequested` is true while any dwell is in progress on a target and during a Bloom stroke. The caller computes it; the lock never reads dwell itself.
2. WHILE `lockRequested` is true, THE interactionHead SHALL equal the value it had in the frame before `lockRequested` became true (the held value), exactly, for every frame.
3. WHILE `lockRequested` is true, THE decorativeHead SHALL equal `liveHead` (decorative layers keep moving).
4. WHEN `lockRequested` becomes false, THE interactionHead SHALL ease from the held value to `liveHead` over `lockEaseMs = 400 ms` on the presence clock (smootherstep weight), and SHALL continue to follow `liveHead` afterwards.
5. WHEN `lockRequested` becomes true during an ease-back, THE held value SHALL be the current `interactionHead`, with no jump.
6. WHILE no lock is active and no ease-back is running, THE interactionHead SHALL equal `liveHead`.
7. THE hit circles and the rendered position of every interaction-layer object SHALL use the interactionHead of the same frame.
8. THE motion level SHALL change the live head only through the Glide target (Requirement 5.1), so a motion change during a lock does not change the interaction layer.
9. FOR ALL sequences of `liveHead` and `lockRequested`, WHILE `lockRequested` is true for consecutive frames, THE interaction-layer offset (the shift of an interaction-layer point, in screen units) SHALL not change, and THE shift of at least one decorative layer SHALL change in each frame in which `liveHead` changed and its factor is greater than 0.

### Requirement 7: Travel

**User Story:** As the player, I want to be carried smoothly along the path to the next place, so that the world feels like one connected place.

#### Acceptance Criteria

1. THE Travel SHALL be a pure step `stepTravel(state, { dtMs, paused, motion }) -> { state, events, travel, progress, cover, travelling }`, with `dtMs` the session clock delta.
2. THE Travel SHALL move the view along one finite pre-defined segment `{ from, to, durationMs }`. A journey segment SHALL support `durationMs` from 5000 to 7000, and a door threshold segment SHALL support about 3000, with the same engine and the same rules.
3. THE Travel SHALL keep a progress fraction `p` in 0..1 per constant part. A part is a run of steps with the same style (Requirement 8.4) and the same duration `D` (Requirement 8.2). A part has a base `b` (the value of `p` when it starts, 0 for the first part), a remaining duration `R` in ms (`R = D * (1 - b)` in the travel style; in the fade style `R = X`, the fade duration of Requirement 8.4, which equals `D * (1 - b)` unless the `minFadeMs` floor binds), and `elapsed` in ms, the sum of the unpaused deltas of this part. WHILE not paused, each step SHALL add `dtMs` to `elapsed`, and `p = b + (1 - b) * min(1, elapsed / R)`.
4. IN the travel style, THE reported travel distance SHALL be `from + (to - from) * ease(p)`, where `ease` is a smootherstep (zero speed at both ends, so there is ease-in and ease-out), exactly `from` at the start and exactly `to` at arrival (assigned, not computed). The fade style is defined in Requirement 8.4.
5. WHEN `elapsed >= R - arrivalToleranceMs` (`arrivalToleranceMs = 1e-6`, a guard so that a float sum such as 0.9999999 of the duration still arrives), THE Travel SHALL set `p = 1`, report the distance exactly `to`, emit one `arrived` event and enter the state `arrived`. THE Travel SHALL emit no other `arrived` event, and SHALL not emit it again in any later step, for any later input.
6. WHILE `paused` is true, THE Travel SHALL not change `p` and SHALL emit no event. THE caller SHALL pass `paused` for pause, hidden tab and tracking hold. Because the delta is the session clock delta, the tracking hold also stops it.
7. A start request while the state is `travelling` or `arrived` SHALL have no effect (steering section 7: a repeated or late event never starts a second journey). A new journey SHALL need a new state.
8. A delta that is negative, not finite or zero SHALL move nothing.
9. WHILE the state is `travelling`, THE Travel SHALL report `travelling = true`; the caller SHALL use it for Requirement 13.2. Targets are active only after the Travel has reported `arrived` (or before it started).
10. FOR ALL segments, delta sequences (up to 10000 steps) and pause sequences at one constant motion level, THE number of `arrived` events SHALL be at most 1, and no `arrived` event SHALL occur in a step with `paused = true`. WHEN the sum of the unpaused deltas is at least `R + arrivalToleranceMs`, exactly one `arrived` event SHALL have occurred; WHEN it is below `R - arrivalToleranceMs`, none SHALL have occurred. The test SHALL not assert for sums between these two bounds, because a float sum depends on the order of additions (10000 additions of values up to 7000 differ by far less than the tolerance, so the bounds are safe).
11. FOR ALL segments and delta sequences at one constant motion level of Full or Gentle (travel style), THE reported travel distance SHALL not decrease and SHALL stay in `[from, to]`, and, for deltas up to `R / 20`, the distance moved in the first step and in the last step before arrival SHALL be less than the distance moved in a step of the same delta around `p = 0.5` (ease-in and ease-out). At the constant level Reduced (fade style), the distance SHALL be `from` until the fade reaches its midpoint and `to` after, and no other value.
12. FOR ALL durations at the long end (5000 and 7000 ms) and at the door length (3000 ms), with deltas that are whole milliseconds (exact in floating point), THE step in which the sum of the unpaused deltas first equals the duration SHALL report `arrived` and the distance exactly `to`, and no earlier step SHALL report it.

### Requirement 8: Motion settings

**User Story:** As a player who is sensitive to motion, I want to choose Full, Gentle or Reduced at any time, so that the game never moves more than I can bear.

#### Acceptance Criteria

1. THE World-view SHALL import the type `MotionLevel` (`'full' | 'gentle' | 'reduced'`) from `marrow/core` and SHALL not define another motion type.
2. THE World-view SHALL provide a pure function `motionProfile(level)` returning exactly these values (steering section 8):

| Field | Full | Gentle | Reduced |
|---|---|---|---|
| head multiplier | 1 | 0.5 | 0 |
| travel duration multiplier | 1 | 1.3 | not used |
| travel style | travel | travel | cross-fade of `crossFadeMs` = 1500, with progress cue |
| ambient amplitude multiplier | 1 | 0.5 | 0.25 (leaf sway, fog drift) |
| ambient speed multiplier | 1 | 0.5 | 1 |
| particles (fireflies, falling leaves) | on | on | off |
| light flicker | on | on | steady |
| pointer trail | on | on | off |

3. THE 5-7 s journey range and the 3 s door length SHALL apply to Full only. In Gentle, the duration SHALL be the segment duration times 1.3.
4. THE fade style SHALL replace the move by a cross-fade. A fade has a start progress `b` (0 for a travel that starts in Reduced; the current `p` for a switch in 8.6), a start distance `d0` (`from` for a travel that starts in Reduced; the current distance for a switch) and lasts `X = max(crossFadeMs * (1 - b), minFadeMs)`, with `minFadeMs = 600` (a rule value: the cover rises and falls, and each light change takes at least 300 ms, `accessibility-and-copy.md`; the floor binds only for a switch at `p > 0.6`). With `q = elapsed / X` in 0..1, THE Travel step SHALL report `cover = smootherstep(min(1, (1 - abs(2q - 1)) / (1 - 2h)))` with `h = maxClockStepMs / minFadeMs` (marrow's clock step over `minFadeMs`, 1/6 with the shipped values): 0 at `q = 0`, exactly 1 for `abs(q - 0.5) <= h` (the plateau), 0 at `q = 1`. It SHALL report `progress = b + (1 - b) * q`, and the distance `d0` while `q < 0.5` and exactly `to` from the first step in which `q >= 0.5`. That first step lies on the plateau, because one step crosses `q = 0.5` by at most `maxClockStepMs / X <= h`, so the switch of the distance happens under a full cover without a separate rule. The caller draws the cover as a fade through the stage colour and brightens the path or doorway with `progress`.
5. THE motion level SHALL be read each frame from the Marrow settings store. A change SHALL take effect from the next frame, with two readings of steering section 8 ("takes effect within one frame"): the head offset follows through the Glide (Requirement 8.7), and the style of a running travel follows Requirement 8.6.
6. A running travel SHALL have a travel level: the level at its start, lowered by any change to less motion (order Full, Gentle, Reduced). WHEN the motion level changes while a travel is running, a change to a level with less motion than the travel level SHALL apply to the travel at once, and any other change SHALL apply to the travel only from the next travel (the running travel keeps its travel level, its duration and its style). In detail:
   1. Full to Gentle (the travel level is Full): the travel keeps its style and `p`, and starts a new part with `b = p` and the duration `D'` of Gentle, so the remaining time is `D' * (1 - p)`. The distance and the cover do not jump.
   2. Full or Gentle to Reduced: the travel switches to the fade style with `b = p` and `d0` = the current distance, so the cross-fade lasts `X = max(crossFadeMs * (1 - p), minFadeMs)` (8.4). The distance stays `d0` while `q < 0.5` and becomes `to` in the first step with `q >= 0.5`, which lies on the plateau of full cover (8.4). The cover starts from 0.
   3. Gentle to Full, and Reduced to Full or Gentle (a change to more motion): the running travel does not change. A Gentle travel keeps its Gentle duration and a fade finishes as a fade. The head multiplier, the ambient multipliers and every other value of the new profile apply at once; the next travel uses the style and the duration of the new level.
   4. A change while no travel is running only decides what the next travel uses.
7. IN Reduced, THE head multiplier SHALL be 0 so the Glide target is (0, 0) and the offset eases to 0 through the Glide; the interaction layer does not jump (Requirement 6.8).
8. THE default level SHALL be the one Marrow's `parseSettings` returns, which is Reduced when the browser reports `prefers-reduced-motion: reduce` and no choice has been stored. THE slice SHALL create the store with that preference, with no second rule for it.
9. FOR ALL levels, THE profile SHALL equal the table above; a test SHALL compare the whole object for each level.
10. FOR ALL levels, parallax shifts SHALL not exceed those of Full (Requirement 4.7).
11. FOR ALL sequences of motion levels, deltas and pauses during one travel (up to 10000 steps), THE reported distance SHALL never decrease and SHALL stay in `[from, to]`, `progress` SHALL never decrease, THE number of `arrived` events SHALL be at most 1, and WHEN the unpaused time after the last change that applied to the travel is at least the remaining time `R` of the current part plus `arrivalToleranceMs`, exactly one `arrived` event SHALL have occurred.
12. FOR ALL such sequences, THE cover SHALL be 0 while the style is travel, and in every step the change of the cover SHALL be at most `COVER_SLOPE_MAX * dt / X`, where `COVER_SLOPE_MAX = 2 * 15/8 / (1 - 2h)` (5.625 with the shipped values: the steepest slope of smootherstep, 15/8, times 2 for the rise, stretched by the plateau) and `X >= minFadeMs` is the fade duration (no jump, including the step of a switch to Reduced and the step in which the distance switches to `to`). A fade SHALL last at least `minFadeMs` of unpaused time, for every sequence. A step without time (paused, or a delta that is zero, negative or not finite) SHALL return the stored progress, distance and cover unchanged; only a level change of that step can apply.
13. FOR ALL such sequences, THE travel level SHALL never rise during a travel; THE style SHALL change at most once, and only from travel to fade; THE duration `D` of the travel style SHALL change at most once, and only from the Full duration to the Gentle duration; and a change to more motion SHALL change none of the distance, the cover, `progress`, `D` and `R` of the running travel in the step in which it is made, apart from what the delta of that step adds.

### Requirement 9: Parallax margin and placement

**User Story:** As a player, I want every target to stay reachable however my head moves, so that parallax never puts a target out of my reach.

#### Acceptance Criteria

1. THE World-view SHALL export `parallaxMargin(sceneScale, aspect)`, which returns the largest displacement, in screen units, that the interaction layer can have for any head offset in -1..1 on both axes at Full: `sceneScale * hypot(interactionFactor * limitX * aspect, interactionFactor * limitY)`.
2. THE margin SHALL use the Euclidean length, because the head offset is clamped per axis and the corner of the square (1, 1) is farther than either axis.
3. THE App SHALL call Marrow's `placeTargets` with `m = parallaxMargin(...)` and with slots in screen space, and SHALL place each target in the world with `screenToWorld(slot, restView, layer, frame)`, where `restView = { travel: stop, head: (0, 0) }` and `frame` is the projection frame of the scene.
4. FOR ALL head offsets in -1..1 on both axes, scene scales in 0..1, motion levels and lock states, THE centre of the hit circle SHALL be at most `m` from its slot, and THE whole hit area SHALL lie inside the circle of radius `r + m` around the slot.
5. FOR ALL comfort grids, mappings and placement results from `placeTargets`, and for every allowed head offset, THE hit area of each placed target SHALL lie inside the reachable region: Marrow's `isSlotUsable` accepts the slot for `r` and `m` (it checks every point within `r + m`), and by 9.4 the hit area is inside that disk (invariant 2).
6. THE hit radius `r` SHALL be the Marrow value (0.07-0.13), unchanged by world-view. THE depth scale of the interaction layer at the stop SHALL be 1, so the hit radius equals `r` at every stop.

### Requirement 10: Scene Manager and hit circles (Pixi helpers)

**User Story:** As the developer, I want one object that owns Pixi and applies the view, so that the renderer only draws what the pure code decides.

#### Acceptance Criteria

1. THE Scene Manager in `packages/world-view/src/pixi` SHALL own the Pixi application, the canvas and the render loop on `requestAnimationFrame`. There SHALL be no `@pixi/react`.
2. THE Scene Manager SHALL create one container per layer, in the layer order, and SHALL each frame apply the View to every layer container (position, scale and visibility) using only `worldToScreen` with the projection frame of that rendered frame, converted to pixels by one scale from screen space to the canvas size.
3. THE Scene Manager SHALL read the view each frame from a callback `getFrame(dtMs)` that returns the view, the interaction head, the decorative head and the cover value. It SHALL not compute a head offset, a travel or a lock itself.
4. THE Scene Manager SHALL expose `hitCircles()`, returning the screen-space circle of each target that the caller marked active. The circle SHALL be computed by one function `targetScreen(point, r, view, frame)` that also gives the position at which the target is rendered. FOR ALL views and projection frames, THE rendered position of a target (the position given to its display object) and the centre of its hit circle SHALL be equal, bit for bit, because both come from one call of `worldToScreen` with the same view and the same frame object in the same rendered frame.
5. THE hit circle radius SHALL be `r * s`, where `s` is the depth scale of the target. At the stop `s = 1`.
6. THE Scene Manager SHALL return no hit circle for a target that is not active, for a culled target, or while the Travel is `travelling`.
7. THE Scene Manager SHALL give `getFrame` the raw frame delta in ms from the `requestAnimationFrame` timestamps and SHALL not clamp it: the only place where the frame delta is clamped to 100 ms is Marrow's `stepClocks`, called by the slice (Requirement 12.8). THE Scene Manager SHALL not use `Date.now()` or `performance.now()` for any logic.
8. THE Scene Manager SHALL set `touch-action: none` on the play area element and SHALL size the canvas to the play area, with the device pixel ratio used for rendering capped at the tuning key `maxPixelRatio` (starting value 2, `tune`), as the line "Canvas resolution" of `performance-budget.md` states. Hit testing works in screen space and does not depend on it.
9. THE Scene Manager SHALL destroy the application, remove its listeners and cancel its frame request on `dispose()`, and a test SHALL check that no frame request remains.
10. THE `src/pixi` code SHALL import PixiJS and may import `world-view` core; the `src/core` code SHALL import neither (lint rule in `structure.md`).

### Requirement 11: Proof slice: entry, layers and layout

**User Story:** As the developer, I want a small forest slice in the app with placeholder shapes, so that I can see and feel the view model working before any real art.

#### Acceptance Criteria

1. THE World Playground SHALL be reachable only with `?playground=world`, and the normal app and `?playground=1` SHALL not load it.
2. THE slice SHALL draw 6 placeholder layers in this order, with only the grey ramp and `lanternWarm` from the theme module: sky, far hills, far trees, main scene with the interaction layer, fog, foreground foliage. This is the depth order and the draw order (Requirement 2.10, Appendix B). Sky and far hills SHALL be backdrop layers (Requirement 4.1). Every colour SHALL come from the theme module.
3. THE slice SHALL draw the layer shapes as flat shapes (rectangles, circles, rounded shapes). It SHALL not load any image, font file or external asset.
4. THE foreground and fog layers SHALL not cover a required target: FOR ALL candidate slots in the stop content and for all head offsets in -1..1 on both axes at the rest view, no shape of the foreground or fog layer SHALL intersect the hit circle of a target placed in that slot, given the shifts of both layers.
5. THE play area element SHALL have `touch-action: none` (computed style).
6. THE slice SHALL show a stop with two placeholder targets (stop 1), one travel segment to a second stop, and one placeholder target at the second stop (stop 2).
7. THE slice SHALL show a read-only debug panel with the view (travel, head, interaction head), the motion level, the clock deltas, the travel state and the placement result.
8. ALL strings of the slice SHALL come from the app `copy/` folder, and the slice SHALL contain no player-facing string outside it. The debug panel is dev-only and may use fixed labels from `copy/`.
9. THE stop content (layer table, slots, segment definitions, scene parallax scale) SHALL be JSON validated at load against a schema, with a readable error (`tech.md` rule 7).

### Requirement 12: Proof slice: placement, input and dwell

**User Story:** As the developer, I want the slice to use Marrow's real placement and dwell with the mouse and the camera, so that the view model is proven with the real input path.

#### Acceptance Criteria

1. THE slice SHALL place the two targets of stop 1 with Marrow's `placeTargets` (`n = 2`) and the one target of stop 2 with `n = 1`, with `m = parallaxMargin(...)`, and SHALL use only the slots the result gives.
2. IF the placement result is not `simultaneous` for stop 1, or is `none` for stop 2, THEN THE slice SHALL show a plain notice from `copy/` and SHALL not start. It SHALL not enlarge the comfort grid to make the placement succeed, except for the whole-screen grid of Requirement 14.2.
3. THE slice SHALL pass the hit circles of the active targets to Marrow's Dwell Engine as `HitArea` values each frame, with the same `view` value and the same projection frame object used for rendering in that frame.
4. THE slice SHALL support the mouse, touch and pen through Marrow's Pointer Source in simulated-input mode, with the head offset taken from the pointer by Marrow's Head View (marrow Req 6.7), except while the head driver is on (12.10). IN mouse mode, THE comfort grid SHALL come from Marrow's `chooseWholeScreen`.
5. THE slice SHALL support the camera through Marrow's Camera Source (Requirement 14).
6. WHILE a dwell is in progress on a target, THE slice SHALL set `lockRequested` to true (Requirement 6) and the target SHALL stay under the pointer while the head moves. In simulated-input mode the head follows the pointer at 30%, so the head cannot move by more than 0.1 while the pointer stays on a target; the check therefore uses the head driver: with the pointer held inside a hit circle and the head driver changing the head offset by more than 0.1 during the hold, the dwell SHALL complete, the interaction-layer offset SHALL not change and the offset of a decorative layer SHALL change.
7. WHEN a dwell completes, THE slice SHALL turn that target's placeholder `lanternWarm`. There SHALL be no stage rule, no audio and no colour reveal.
8. THE slice SHALL read the presence and session clocks from Marrow's `stepClocks`, with the flags pause, hidden tab and tracking hold. `stepClocks` is the only place that clamps the frame delta to 100 ms (steering section 6).
9. THE slice SHALL provide a DOM Pause button. WHILE paused, no dwell progress, travel, glide or lock ease SHALL advance.
10. THE slice SHALL provide a dev-only head driver, present only under `?playground=world` and off by default: two sliders (x and y, -1..1) in the debug panel and a programmatic setter for the Playwright test. WHILE it is on, its value SHALL replace Marrow's Head View output as the input of the head multiplier and the Glide (Requirement 5.1), in mouse mode and in camera mode; the pointer and the Dwell Engine SHALL not be affected. The debug panel SHALL show that the driver is on.

### Requirement 13: Proof slice: travel and activation

**User Story:** As the player, I want the next place to appear only after I have been carried there, so that I cannot select anything half-way.

#### Acceptance Criteria

1. WHEN both targets of stop 1 are selected, THE slice SHALL start the travel after `rewardDelayMs = 1500` of session time, once.
2. WHILE the Travel is `travelling` (or the reward delay is running), THE slice SHALL pass no hit area to the Dwell Engine, so dwell cannot select, no dwell can start and no completion can occur (steering section 7).
3. THE targets of stop 2 SHALL become active only after the Travel has reported `arrived` (a stop is "fully stopped" when travel equals `to` and the state is `arrived`).
4. THE slice SHALL travel along one forest segment of 6000 ms in Full (7800 ms in Gentle, 1500 ms cross-fade in Reduced). A dev control SHALL let the developer choose a 3000 ms door-length segment instead. Both use the same Travel.
5. WHILE the travel style is fade (Reduced, or a switch to Reduced during the travel), THE slice SHALL draw the cover (Requirement 8.4) and brighten the path placeholder from the grey ramp to `lanternWarm` with `progress`, so the cross-fade shows progress.
6. WHEN the target at stop 2 is selected, THE slice SHALL show a Restart button (DOM). THE Restart SHALL create new clean states (view, glide, lock, travel, dwell, placement) and return to stop 1.
7. THE slice SHALL run no ambient motion, particles or audio.

### Requirement 14: Proof slice: camera mode and the start panel

**User Story:** As the developer, I want to try the slice with a real camera without the full setup screens, so that I can feel the head parallax with my own head.

#### Acceptance Criteria

1. THE start panel SHALL exist only under `?playground=world`, SHALL offer "Use mouse" and "Use camera" and SHALL be a DOM element with real buttons, a visible focus ring and an accessible name.
2. IN camera mode, THE slice SHALL mark the whole camera frame comfortable for each active wrist with Marrow's `markAllValid` (a dev shortcut like "Use the whole screen"), SHALL use `makeMapping` with reach gain 1 and no calibration screen, and SHALL say so in the debug panel. The active wrists are both wrists in camera mode (Marrow's "both") and the right wrist in mouse mode. This does not change Marrow's placement rules.
3. IN camera mode, THE slice SHALL record the neutral head only from a frame in which the nose and both shoulders are valid, because the shoulder width is needed. WHILE no such frame has arrived, THE slice SHALL show a plain waiting line from `copy/` and the head offset SHALL stay at (0, 0).
4. THE slice SHALL offer a "Set centre" button that records the neutral head again from the next frame that qualifies.
5. THE slice SHALL stop the camera tracks on exit and on unmount (`tech.md` rule 10), and SHALL not store or send any frame.
6. IN camera mode, THE slice SHALL run Marrow's Tracking Lifecycle for the tracking hold and SHALL pass its flag to `stepClocks`. A tracking hold SHALL stop the session clock, so the travel stops, and dwell does not count because no active wrist is valid. It SHALL not stop the presence clock: the Head View eases to centre, and the Glide and the lock ease keep running on the presence clock (Appendix D, decision 6). It SHALL show a plain dev line for the hold, not the tracking-lost overlay (task 16.5 is out of scope).
7. IF the camera is denied or missing, THEN THE slice SHALL show a plain notice and SHALL continue in mouse mode.
8. THE slice SHALL continue to work with a pose-frame rate of 7 per second.
9. IN camera mode, THE slice SHALL draw a small orb at each active wrist's screen pointer, the position given to the Dwell Engine, and SHALL hide each orb while its wrist is invalid. The active wrists are both wrists in camera mode (Marrow's "both") and the right wrist in mouse mode. It is a dev aid of the slice; the game's orb is marrow-input Requirement 26.7.

### Requirement 15: Acceptance tests

**User Story:** As the developer, I want each rule proven by a named property test, so that I can trust the view model without looking at it.

#### Acceptance Criteria

1. THE spec SHALL have these property-based tests with fast-check, each with a name that starts with its invariant:
   1. `projection round trip`: Requirement 2.6.
   2. `hit circle equals rendered target position`: Requirement 10.4, over views, projection frames, motion levels and lock states (invariant 3).
   3. `hit area inside reachable region for all head offsets`: Requirement 9.4-9.5 (invariant 2).
   4. `lock holds interaction layer, decorative layers move`: Requirement 6.9.
   5. `travel arrives exactly once and never while paused`: Requirement 7.10.
   6. `no layer edge exposed`: Requirements 4.5 and 4.6.
   7. `glide per-frame limits at 7 pose frames per second`: Requirements 5.7-5.10.
   8. `travel across motion level changes`: Requirements 7.11 and 8.11-8.13.
2. THE tests of 15.1.1 to 15.1.8 SHALL run in `npm test` without WebGL, the DOM or a camera: the Scene Manager's hit circle and position come from the pure `targetScreen` function and are checked with a fake display object.
3. WHEN a property test fails, THE failing seed SHALL be kept as a regression test and noted in `docs/bugs-found.md` (seed, what broke, fix commit), for real bugs only.
4. THE spec SHALL have one Playwright test in simulated-input mode on `?playground=world` that checks: the play area has `touch-action: none`; a target's rendered sprite position equals its hit circle (read through a read-only debug snapshot that exists only under `?playground=world`); with the pointer held on a target and the head driver (12.10) changing the head offset by more than 0.1, dwell completes, the interaction layer offset is unchanged and a decorative layer offset changes during the dwell; both targets selected lead to travel, no dwell can select during travel, and the stop 2 target becomes active only after arrival.
5. THE camera path SHALL be checked by the user with a real camera. The task list SHALL include that check as a manual step, and the journal SHALL not state that the camera path was verified unless the user reports it.
6. EVERY test of Requirements 5, 6, 7 and 8 SHALL read its numbers from the tuning object.
7. A requirement coverage check SHALL map every acceptance criterion of this document to at least one test, a manual step, or a stated reason why it has none (as in marrow-input).

### Requirement 16: Dependencies, packaging and security

**User Story:** As the maintainer, I want a pinned dependency and clean package boundaries, so that the build stays reproducible and the packages stay content-free.

#### Acceptance Criteria

1. THE spec SHALL add `pixi.js` at the exact version `8.22.0` (no range) to `packages/world-view/package.json` `dependencies`, with the lockfile committed. Version 8.23.0 (released 2026-11-11) is not used because the user wants a version at least a few weeks old; 8.22.0 was released 2026-10-01.
2. THE `docs/licenses.md` SHALL record PixiJS (name, version, licence, source URL, date) when it is installed.
3. THE `world-view` entry point SHALL export the pure code and `world-view/pixi` SHALL export the Pixi helpers, and the app SHALL import only those two entry points.
4. THE `world-view/src/core` code SHALL import no PixiJS, DOM or React, and SHALL import from `marrow` only `marrow/core`. `marrow` SHALL not import `world-view`. The existing lint rules and dependency test SHALL pass without an exception.
5. NO file in `packages/` SHALL mention lanterns, spirits, glades, the hall or other story content, and none SHALL contain player-facing text.
6. THE existing page CSP is `connect-src 'self'`. PixiJS 8 builds shaders with `new Function`, and that is governed by `script-src` (which falls back to `default-src`), not by `connect-src`. THE current page works because its CSP declares neither, so eval is not restricted. THE design SHALL note that adding `default-src` or `script-src` later means importing `pixi.js/unsafe-eval` in `world-view/pixi` before the application is created, or the renderer fails.
7. THE spec SHALL add no other dependency. Adding one needs the user's approval.
8. THE `npm run typecheck`, `npm run lint` and `npm test` SHALL pass, and the report SHALL say so with the output; if something fails or was skipped, it SHALL say that instead.

## Out of scope

- Real art, sprites, fonts and audio; stage rules; colour reveal; particles and ambient motion (the profile table only defines their multipliers); save.
- The Marrow playground of tasks 16-17, the calibration screen, the camera permission screen, the pause and tracking-lost overlays, the Debug Overlay component, and settings controls from `marrow/react`.
- Deriving the head offset from landmarks, and a shoulder-midpoint fallback (the Head View of task 10 stays the only source).
- Sequential target presentation in the slice, and levels, journeys and thresholds beyond the one forest segment and the 3 s dev segment.
- A second ease to centre for lost tracking.

## Appendix A: Steering numbers used by this spec

| Value | Source | Where used |
|---|---|---|
| Limits at the nearest layer: 3% of width, 2% of height | invariants section 8 | 3.1 |
| Hall limits 60% *(tune)* | section 8 | 3.4 (app value) |
| Interaction layer factor 0.2 of the nearest *(tune)* | section 8 | 3.3, 9.1 |
| Gentle: head x0.5, ambient amplitude and speed x0.5, travel x1.3 *(tune)* | section 8 | 8.2 |
| Reduced: no head parallax, no particles, sway and fog x0.25, steady light, 1.5 s cross-fade with progress *(tune)* | section 8 | 8.2, 8.4 |
| Travel 5-7 s with ease-in and ease-out *(tune)*; door thresholds about 3 s *(tune)* | section 7 | 7.2, 13.4 |
| Travel starts 1-2 s after the completion reward *(tune)* | section 7 | 13.1 |
| Light changes eased over at least 300 ms | accessibility-and-copy | 8.4 (`minFadeMs` = 600) |
| Dwell cannot select and targets become active only after travel has fully stopped | section 7 | 13.2-13.3 |
| Frame delta clamp 100 ms (only in `stepClocks`); session clock stops during tracking hold | section 6 | 5.2, 7.6, 12.8 |
| Head lost: view eases to centre over about 0.5 s (done by Head View) | section 6 | 5.4 |
| View lock: held at the value at the start, eased back after | section 8 | 6 |
| 5-6 depth layers per scene; order of the forest layers | art-and-motion | 11.2 |
| Hit radius 0.07-0.13 (Marrow) | section 4 | 9.6 |
| `touch-action: none` on the play area | product and tech rules | 10.8, 11.5 |
| Canvas device pixel ratio capped at 2 *(tune)*; hit testing never depends on it | performance-budget | 10.8 |

## Appendix B: Numbers that are new relative to steering

All are `tune` values in `world-view/src/core/tuning.ts` unless marked.

| Key | Starting value | Notes |
|---|---|---|
| `limitX`, `limitY` | 0.03, 0.02 | rule (steering) |
| `interactionFactor` | 0.2 | steering *(tune)* |
| layer factors | sky 0.00, far hills 0.03, far trees 0.10, interaction 0.20, fog 0.60, foreground 1.00 | agreed with the user; non-increasing as depth increases (1.4) |
| `nearPlane` | 0.5 | depth units |
| `vanishingPointY` | 0.45 | a little above centre |
| layer depths (forest slice) | sky 4000, far hills 600, far trees 120, main (interaction) 24, fog 18, foreground 14 | starting values; the layer table order is the depth order and the draw order (2.10); the stop 2 targets sit at depth 36 with anchor 12 |
| slice segment | `from` 0, `to` 12, 6000 ms; door `from` 0, `to` 4, 3000 ms | app values |
| `horizonDepth`, `foregroundDepth` | 500, 15 | for 2.8 (fog at 18 is not a near layer for this check) |
| `horizonMaxMove`, `foregroundMinGrowth` per segment | forest segment (`to` 12): 0.03, 3; door segment (`to` 4): 0.01, 1.3 | for 2.8. Hand check, aspect up to 2.4 (farthest viewport point from the vanishing point about 1.32): far hills move at most about 0.027 (forest) and 0.009 (door); foreground at depth 14 grows by 7 (forest) and 1.4 (door) |
| `arrivalToleranceMs` | 1e-6 | float guard for arrival (7.5) |
| `minFadeMs` | 600 | rule: derived from `accessibility-and-copy.md` (light changes of at least 300 ms; the cover rises and falls) |
| `COVER_SLOPE_MAX` | 5.625 | derived as in 8.12: `2 * 15/8 / (1 - 2h)` with `h = maxClockStepMs / minFadeMs` (1/6 shipped: 3.75 / (2/3)); test parameter for 8.12 |
| `glideTauMs` | 150 | user |
| `glideCapPerS` | 4.0 | user, hard cap |
| `glideEpsilon` | 0.001 | for 5.9 |
| `lockEaseMs` | 400 | |
| `crossFadeMs` | 1500 | steering *(tune)* |
| `rewardDelayMs` | 1500 | app value, steering 1-2 s |
| motion profile | Requirement 8.2 | steering |
| `maxPixelRatio` | 2 | steering *(tune)*, `performance-budget.md` "Canvas resolution"; used by the Scene Manager (10.8) |
| 144 Hz / 60 Hz agreement tolerance, per axis | 0.4 | test parameter; measured basis in 5.8 |

## Appendix C: Steering invariants covered here

- Invariant 2 (placed targets and their hit areas stay inside the reachable region for every allowed head offset): Requirement 9.4-9.5, test 15.1.3.
- Invariant 3 (`screenToWorld(worldToScreen(p))` returns `p`, and the rendered target position equals the hit-test position): Requirements 2.6 and 10.4, tests 15.1.1 and 15.1.2.
- Invariant 4, travel part (no gameplay completion while travelling): Requirement 13.2-13.3 and 7.10. The session-level transition rule belongs to the session spec.
- Invariant 8, motion part (Reduced motion leaves every stage completable): Requirement 8, with the slice reaching stop 2 in every level (Playwright, 15.4).
- Section 8 rules on projection, parallax, view lock and motion settings: Requirements 2, 3, 4, 6, 8.

## Appendix D: Decisions behind this document

From the user's answers:
- `pixi.js` 8.22.0 exact, in `packages/world-view/package.json`; the CSP reasoning corrected (script-src and default-src, not connect-src) and a design note for `pixi.js/unsafe-eval` (16.6).
- Head View stays the only head source; the shoulder-midpoint fallback is dropped; world-view adds only the glide and no second ease to centre (5.4-5.5).
- Glide: exponential follow with tau 150 ms and a hard cap of 4.0 units per second, with the five property checks of 5.7-5.10.
- Lock freezes the interaction layer only (6.2-6.3).
- Camera path in the slice: own start panel, only under `?playground=world`; neutral head only from a frame with the nose and both shoulders valid (14.1-14.3).
- Settings wiring through the existing store, with a motion control in the slice (8.5); behaviour on a change during travel (8.6).
- Slice flow: reward delay, travel, stop 2 with one target, then Restart; dwell cannot select during travel, and targets activate only after arrival (13).
- Layer table, overscan of at least the maximum shift, fog never covering a required target (3.3, 4, 11.4).
- One Playwright test (15.4); margin by `parallaxMargin` (9.1).

Decisions I made, for review:
1. **Margin is a Euclidean length.** My earlier proposal was `max(0.2 * 0.03 * A, 0.2 * 0.02)`. At the corner of the head square (1, 1) the interaction layer moves by the hypotenuse, which is larger, so a `max` would let a hit area leave the expanded circle. The function is therefore `sceneScale * hypot(...)`, and it takes `(sceneScale, aspect)`, not a motion level, because it returns the Full value (the largest) and every other level is smaller (9.1-9.2).
2. **Depth scale is relative to an anchor**: `(depth - anchor) / (depth - travel)`. A plain `focal / (depth - travel)` would shrink far layers to a point at the start. With an anchor, every layer is 1 at its own authoring distance, far layers tend to 1 (the horizon stays still), near layers grow without bound and are culled at the near plane. The stop 2 targets use an anchor at their stop.
3. **Motion changes the Glide target, not the shift.** Switching to Reduced therefore eases the head to 0 over a few frames, with no jump, and a motion change during a lock cannot move the interaction layer. A direct multiplier on the shift would jump, and it would break the lock. The cost: Reduced reaches 0 parallax in about half a second, not in the first frame. Steering's "takes effect within one frame" is read as "starts within one frame".
4. **Reduced cross-fade is a fade through a cover**, not two views drawn at once: the distance is held at its start value and becomes `to` under a full cover at the fade's midpoint. This keeps one view per frame. Changes of the level during a travel follow the user's review rule (Requirement 8.6).
5. **Ambient speed in Reduced is 1.** Steering gives an amplitude of x0.25 for sway and fog drift and says nothing about speed. The profile table only holds the numbers; the slice has no ambient motion.
6. **Glide and the lock ease run on the presence clock**, like Head View. Travel runs on the session clock (steering section 6), so a tracking hold stops the travel and lets the head ease to centre.
7. **Camera mode uses `markAllValid` for the comfort grid.** `chooseWholeScreen` works only in simulated-input mode. The slice marks the whole camera frame comfortable, shows it in the debug panel, and leaves Marrow's placement rules as they are.
8. **The slice runs Marrow's Tracking Lifecycle in camera mode** so that a tracking hold stops the travel, with a plain dev line instead of the overlay.
9. **Front layers**: the rule "never covers a required target" is applied to foreground as well as fog, because steering section 8 states it for foreground objects.
10. **Placement outside `simultaneous`** shows a notice and does not start; sequential presentation is not built in the slice.
11. **Where depth lives**: a target at stop 2 is on the interaction layer but has its own depth. Whether the design uses one container or one per stop is left to design.md, as long as 10.4 holds.

From the user's review of this document (second round), all applied in this revision:
1. Layers: fog moved to depth 18, between the interaction layer (24) and the foreground (14), and the validation uses generic rules instead of names: factor non-increasing as depth increases, `depth - anchor > nearPlane` for every layer, interaction factor below the largest factor (1.4, 3.2-3.3, Appendix B).
2. Motion change during travel replaces the earlier rule (keep `p` and use `D'(1 - p)` for every change), which snapped the distance and the cover: a change to less motion applies at once, a change to more motion applies its style from the next travel; Full and Gentle keep `p`; Full or Gentle to Reduced starts a fade of `crossFadeMs * (1 - p)` from the current distance, held while `q < 0.5` and switched to `to` in the first step with `q >= 0.5`; Reduced to Full or Gentle lets the fade finish (8.4, 8.6, 8.11-8.13). For review: this reads steering's "takes effect within one frame" as follows. The head offset (through the Glide), the ambient values and every non-travel value change at once. A change to less motion changes the running travel at once. A change to more motion changes the travel style from the next travel. Two consequences I noticed, both decided in the third round below: (a) a switch to Reduced late in a travel gave a short fade (150 ms at p = 0.9); (b) Gentle to Full mid-travel sped the travel up from the same `p`. The text of this item describes the second-round rule; the current rule is Requirement 8.6.
3. 2.8: thresholds stated per segment (forest and door), with the hand check in Appendix B.
4. 14.6 now follows decision 6: the glide and the lock ease keep running on the presence clock during a tracking hold; only the session clock, travel and dwell (no valid wrist) stop.
5. A dev-only head driver replaces the Head View output for 12.6 and the Playwright test (12.10, 15.4), because the simulated head follows the pointer at 30%.
6. Exact arrival: `elapsed` per constant part with `arrivalToleranceMs = 1e-6`; the property asserts only outside the tolerance band, plus an exact case with whole-millisecond deltas (7.3, 7.5, 7.10-7.12). 7.11 is per constant level; the cross-level property is 8.11-8.13.
7. Overscan: full-viewport coverage for backdrop layers only; any other shape that touches a viewport edge at rest extends past it by at least the layer's maximum shift (4).
8. The 100 ms clamp is in `stepClocks` only (12.8); the Scene Manager passes the raw delta (10.7).

From the user's review of this document (third round), all applied in this revision:
1. Fade floor: `X = max(crossFadeMs * (1 - p), minFadeMs)` with `minFadeMs = 600`, a rule value derived from `accessibility-and-copy.md` (light changes of at least 300 ms; the cover rises and falls, so two changes). The floor binds only for a switch at `p > 0.6`. It applies to 8.4, 8.6.2, the 8.12 bound (`X >= minFadeMs`, and a fade lasts at least `minFadeMs`), the validation (1.4) and Appendix B. The progress cue still reaches 1 at the end of the fade, more slowly.
2. Gentle to Full mid-travel: a change to more motion applies from the next travel, so the running travel keeps its Gentle duration. Only Full to Gentle starts a new part with `D'`. To make this exact when levels change several times, 8.6 uses a travel level: the level at the start of the travel, lowered by any change to less motion. A change applies to the running travel only if it goes below the travel level; for example Gentle to Full to Gentle changes nothing. 8.11-8.13 now assert that the travel level never rises, `D` changes at most once and only from the Full duration to the Gentle one, and a change to more motion alters nothing of the running travel.
3. Draw order is depth order, with no exception (2.10, 11.2): sky, far hills, far trees, main, fog, foreground. The fog is now behind the foreground, so 11.4 still checks both front layers.

From the user's answers at the start of the design session, all applied:
1. Pixel ratio: `performance-budget.md` now has the "Canvas resolution" line (cap 2, `tune`). 10.8 names the tuning key `maxPixelRatio`; Appendix A and B list it.
2. Projection inputs: the world point carries its anchor and the functions take a projection frame `{ aspect, sceneScale }` (glossary, 2.1, 2.3, 2.6, 3.1, 4.2, 4.3, 9.3, 10.2, 10.4, 12.3, 15.1.2). 4.2 and 4.3 take the frame too, because `edgeOverscan` and the backdrop rectangle need the aspect for the x shift (the same gap as 2.1).
3. 7.3: in the fade style `R = X` (8.4), so 7.3 and 8.4 agree.

Open for you: the numbers in Appendix B marked "starting values" (layer depths, segment lengths, `horizonDepth`, `foregroundDepth`, per-segment thresholds, `arrivalToleranceMs`) are mine; they are not from steering.
Parity tolerance (5.8, Appendix B): changed from 0.08 to 0.4 per axis, on the measured worst case of 0.287 over 20000 jittered 7 Hz schedules.
Cover rule (8.4, 8.12): the switch step lies on a plateau of full cover, `abs(q - 0.5) <= h` with `h = maxClockStepMs / minFadeMs`, instead of a forced cover of 1; `COVER_SLOPE_MAX` becomes 5.625. A paused step after the switch had moved the cover under the forced value (seed 774323422).
