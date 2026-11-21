# Coverage of world-view requirements

Each row maps one criterion id of `requirements.md` to a test (`test`, the literal title of an `it`, `test` or `describe` call; a describe title needs an it inside it), a manual step of the Notes in `tasks.md` (`manual`), or a sentence (`reason`). `tests/world-view-coverage.test.ts` checks every row (Req 15.7).

| id | kind | reference |
|---|---|---|
| 1.1 | test | tuning shipped valid and labelled |
| 1.2 | test | tuning shipped valid and labelled |
| 1.3 | test | tuning rejects each rule of design 5.2 (Req 1.3, 1.4) |
| 1.3 | test | tuning rejects with one issue per failing key, in key order |
| 1.4 | test | tuning rejects each rule of design 5.2 (Req 1.3, 1.4) |
| 1.4 | test | tuning rejects minFadeMs at 2 * maxClockStepMs and accepts a value just above it, when that bound binds |
| 1.4 | test | layer table rules: depth - anchor must be above nearPlane |
| 1.5 | test | invalid content shows the message and not the scene |
| 1.6 | test | core reads numbers from tuning |
| 1.7 | test | tuning shipped valid and labelled |
| 2.1 | test | projection round trip |
| 2.2 | test | no depth - travel pattern in src/pixi or the app (Req 2.2) |
| 2.2 | reason | The conversions sit in packages/world-view/src/core, and the scan above finds no depth - travel expression in src/pixi or the app; the rest is by review. |
| 2.3 | test | worldToScreen worked example |
| 2.4 | test | worldToScreen worked example |
| 2.5 | test | projection round trip: worldToScreen returns null if and only if !(dz > nearPlane) |
| 2.6 | test | projection round trip |
| 2.7 | test | depth scale grows with travel and is 1 at the anchor |
| 2.8 | test | depth scaling thresholds for the journey and door segments: the shipped numbers pass |
| 2.9 | test | core_no_wall_clock |
| 2.9 | test | pure zones import no React, PixiJS, MediaPipe or DOM |
| 2.10 | test | layer table rules: depth must decrease along the table (farthest first) |
| 3.1 | test | worldToScreen worked example |
| 3.2 | test | parallax direction and bounds: a head to the right shifts every layer with a factor to the left |
| 3.2 | test | parallax direction and bounds: a nearer layer shifts at least as much, strictly more when the factors differ |
| 3.3 | test | the shipped content has the Appendix B layer rows |
| 3.4 | test | parallax direction and bounds: the shift never exceeds factor * limit * sceneScale on each axis |
| 3.5 | test | parallax direction and bounds: the shift never exceeds factor * limit * sceneScale on each axis |
| 3.6 | test | parallax direction and bounds: the interaction layer shifts at most its factor times the nearest layer |
| 3.7 | test | parallax direction and bounds: the head changes no depth scale and no roll |
| 4.1 | test | the shipped content has the Appendix B layer rows |
| 4.2 | test | backdropRect is the viewport grown by the overscan when the smallest scale is at least 1 |
| 4.2 | test | no layer edge exposed |
| 4.3 | test | edgeOverscan is the largest shift of the layer on each axis |
| 4.3 | test | content rejects a shape that reaches an edge without the overscan |
| 4.4 | test | scene manager draws each backdrop at least as large as backdropRect |
| 4.5 | test | no layer edge exposed |
| 4.6 | test | no layer edge exposed: a shape that touches an edge and extends by edgeOverscan still reaches it |
| 4.7 | test | no layer edge exposed: the shift of Gentle and Reduced never exceeds Full for any head offset (4.7, 8.10) |
| 4.8 | test | no layer edge exposed: a culled layer is hidden and the backdrops behind it still cover the viewport |
| 4.8 | test | scene manager hides a culled layer |
| 5.1 | test | glide unit rules: one step moves each axis by (target - out) * (1 - exp(-dt / tau)) when the cap does not bind (5.3) |
| 5.1 | test | glide and lock read the motion level only through the target |
| 5.2 | test | slice works at 7 pose frames per second |
| 5.2 | test | clocks come from marrow and nothing clamps |
| 5.3 | test | glide unit rules: the cap limits the move to glideCapPerS * dt / 1000 when it binds (5.3) |
| 5.4 | test | glide unit rules: the output follows a Head View ramp to 0 like any other target (5.4, 5.5) |
| 5.5 | test | glide unit rules: the output follows a Head View ramp to 0 like any other target (5.4, 5.5) |
| 5.6 | test | glide unit rules: a delta of 0, negative, NaN or infinite moves nothing (5.6) |
| 5.7 | test | glide per-frame limits at 7 pose frames per second |
| 5.7 | test | glide unit rules: the target is clamped to -1..1 (5.7) |
| 5.8 | test | glide per-frame limits at 7 pose frames per second: parity at 60 Hz and 144 Hz within PARITY_TOLERANCE (5.8) |
| 5.9 | test | glide per-frame limits at 7 pose frames per second |
| 5.10 | test | glide per-frame limits at 7 pose frames per second |
| 5.11 | test | glide per-frame limits at 7 pose frames per second |
| 6.1 | test | lock holds interaction layer, decorative layers move: row 1, free and lockRequested gives locked with held = last |
| 6.1 | test | lockRequested comes from the previous frame's dwell |
| 6.2 | test | lock holds interaction layer, decorative layers move: row 3, locked and lockRequested holds the held value exactly |
| 6.3 | test | lock holds interaction layer, decorative layers move |
| 6.4 | test | lock holds interaction layer, decorative layers move: ease reaches liveHead exactly after lockEaseMs (6.4) |
| 6.5 | test | lock holds interaction layer, decorative layers move: re-lock during an ease has no jump (6.5) |
| 6.6 | test | lock holds interaction layer, decorative layers move: no lock gives liveHead (6.6) |
| 6.7 | test | frame order: dwell and render share one view |
| 6.8 | test | glide and lock read the motion level only through the target |
| 6.9 | test | lock holds interaction layer, decorative layers move |
| 7.1 | test | travel arrives exactly once and never while paused |
| 7.2 | test | segment rules: a journey lasts journeyMinMs..journeyMaxMs, ends included |
| 7.2 | test | segment rules: a door lasts exactly doorMs |
| 7.3 | test | travel unit rules: the distance starts exactly at from and follows the smootherstep of p (7.3, 7.4) |
| 7.4 | test | travel unit rules: the distance starts exactly at from and follows the smootherstep of p (7.3, 7.4) |
| 7.5 | test | travel arrives exactly once and never while paused |
| 7.6 | test | travel unit rules: a paused step changes nothing and emits no event (7.6) |
| 7.7 | test | travel unit rules: a start request while travelling or arrived changes nothing (7.7) |
| 7.8 | test | travel unit rules: a delta of 0, negative, NaN or infinite moves nothing (7.8) |
| 7.9 | test | travel unit rules: travelling is true until arrival, and no event comes after it (7.9) |
| 7.10 | test | travel arrives exactly once and never while paused |
| 7.11 | test | travel across motion level changes: constant Full and Gentle are monotone, in range and ease in and out (7.11) |
| 7.11 | test | travel across motion level changes: constant Reduced holds from until the fade midpoint, then to |
| 7.12 | test | travel arrives exactly once and never while paused: whole-millisecond deltas arrive exactly |
| 8.1 | test | motion profile equals the table for every level |
| 8.2 | test | motion profile equals the table for every level |
| 8.3 | test | travel unit rules: a Gentle travel lasts the segment duration times gentleTravelMultiplier (8.3) |
| 8.4 | test | travel unit rules: a fade rises to cover 1 at the switch and falls to 0 at arrival, and progress reaches 1 (8.4) |
| 8.5 | test | glide and lock read the motion level only through the target |
| 8.6 | test | travel unit rules: Full to Gentle at p keeps p and the distance, with remaining D * (1 - p) (8.6.1) |
| 8.6 | test | travel unit rules: a change to Reduced at p switches to a fade with b = p, d0 = distance and X = max(crossFadeMs * (1 - p), minFadeMs) (8.6.2) |
| 8.6 | test | travel unit rules: a change to more motion leaves the running travel unchanged (8.6.3) |
| 8.6 | test | travel unit rules: a change while idle only decides the next travel (8.6.4) |
| 8.7 | test | glide unit rules: Reduced gives a target of (0, 0) that decays below glideEpsilon with no jump (8.7) |
| 8.8 | test | 8.8: the slice starts at Reduced when the browser prefers reduced motion |
| 8.9 | test | motion profile equals the table for every level |
| 8.10 | test | no layer edge exposed: the shift of Gentle and Reduced never exceeds Full for any head offset (4.7, 8.10) |
| 8.11 | test | travel across motion level changes |
| 8.12 | test | travel across motion level changes |
| 8.13 | test | travel across motion level changes |
| 9.1 | test | parallaxMargin is the Euclidean length |
| 9.2 | test | parallaxMargin is the Euclidean length |
| 9.3 | test | 9.3 9.6: each target projects back to its slot at the rest view, with the hit radius r |
| 9.4 | test | hit area inside reachable region for all head offsets |
| 9.5 | test | hit area inside reachable region for all head offsets |
| 9.6 | test | 9.3 9.6: each target projects back to its slot at the rest view, with the hit radius r |
| 10.1 | test | scene manager dispose leaves no frame request, listener or application |
| 10.2 | test | scene manager applies layer transforms through worldToScreen |
| 10.3 | test | scene manager applies layer transforms through worldToScreen |
| 10.4 | test | hit circle equals rendered target position |
| 10.5 | test | hit circle equals rendered target position |
| 10.6 | test | hit circle equals rendered target position |
| 10.7 | test | scene manager passes the raw frame delta and reads no clock |
| 10.8 | test | scene manager sets touch-action and caps the pixel ratio |
| 10.8 | test | hit circles do not depend on the pixel ratio |
| 10.9 | test | scene manager dispose leaves no frame request, listener or application |
| 10.10 | test | pure zones import no React, PixiJS, MediaPipe or DOM |
| 10.10 | test | PixiJS code in world-view lives only in src/pixi |
| 11.1 | test | isWorldRoute is true only for playground=world |
| 11.1 | test | main.tsx loads the playground only through a dynamic import behind the route check |
| 11.2 | test | the shipped content has the Appendix B layer rows |
| 11.2 | test | scene layers take their colours from the theme and keep the table order |
| 11.3 | test | no image or font import |
| 11.4 | test | front layers clear every slot at every aspect |
| 11.5 | test | scene manager sets touch-action and caps the pixel ratio |
| 11.5 | test | world playground in simulated-input mode |
| 11.6 | test | 12.1 12.2: placement of both stops |
| 11.6 | test | stop travel of segmentEnd is the segment end |
| 11.7 | test | debug snapshot is frozen and holds no live state |
| 11.7 | test | the snapshot reports every stop target by id, and refuses writes |
| 11.8 | test | no player-facing string outside copy |
| 11.9 | test | content validates |
| 11.9 | test | content rejects a key that is not known |
| 12.1 | test | 12.1 12.2: placement of both stops |
| 12.2 | test | 12.2: a notice when stop 1 is not simultaneous |
| 12.2 | test | 12.2: a notice when stop 1 has no usable slot |
| 12.2 | test | 12.2: a notice when stop 2 has no usable slot |
| 12.2 | test | 12.2: no grid is enlarged |
| 12.3 | test | frame order: dwell and render share one view |
| 12.4 | test | 12.4: mouse comfort comes from chooseWholeScreen |
| 12.5 | manual | M1 |
| 12.5 | manual | M2 |
| 12.5 | manual | M3 |
| 12.5 | manual | M4 |
| 12.6 | test | head driver replaces the head output |
| 12.6 | test | world playground in simulated-input mode |
| 12.7 | test | 12.7: a completed dwell reports the lanternWarm colour |
| 12.7 | test | 12.7: a selection recolours the target on the scene |
| 12.8 | test | clocks come from marrow and nothing clamps |
| 12.9 | test | pause freezes glide, lock, travel and dwell |
| 12.10 | test | head driver replaces the head output |
| 13.1 | test | both selected start the travel once after the reward delay |
| 13.2 | test | no hit area while the reward delay or the travel runs |
| 13.3 | test | stop-2 target is active only after arrival |
| 13.4 | test | 13.4: the forest journey is 6000 ms and the door 3000 ms |
| 13.4 | test | 13.4: a journey started in Gentle lasts 7800 ms |
| 13.5 | test | world playground in simulated-input mode |
| 13.6 | test | restart creates clean states |
| 13.7 | test | no ambient motion or audio import |
| 14.1 | test | start panel buttons by role and name and the focus ring |
| 14.2 | test | 12.1 14.2: camera comfort is the whole frame at reach gain 1 |
| 14.3 | test | neutral head needs nose and both shoulders |
| 14.4 | test | a later frame does not change the neutral head until Set centre |
| 14.5 | test | camera stop on exit |
| 14.5 | test | camera stop on unmount |
| 14.6 | test | tracking hold stops the session clock and not the presence clock |
| 14.7 | test | camera denied continues in mouse mode |
| 14.8 | test | slice works at 7 pose frames per second |
| 14.8 | manual | M6 |
| 14.9 | test | 14.9: with a valid right wrist the orb is shown at the position that the dwell step received, scaled to CSS px |
| 15.1 | test | projection round trip |
| 15.1 | test | hit circle equals rendered target position |
| 15.1 | test | hit area inside reachable region for all head offsets |
| 15.1 | test | lock holds interaction layer, decorative layers move |
| 15.1 | test | travel arrives exactly once and never while paused |
| 15.1 | test | no layer edge exposed |
| 15.1 | test | glide per-frame limits at 7 pose frames per second |
| 15.1 | test | travel across motion level changes |
| 15.2 | test | hit circle equals rendered target position |
| 15.3 | test | every seed regression test named in docs/bugs-found.md exists (Req 15.3) |
| 15.4 | test | world playground in simulated-input mode |
| 15.5 | manual | M1 |
| 15.5 | manual | M2 |
| 15.5 | manual | M3 |
| 15.5 | manual | M4 |
| 15.5 | manual | M5 |
| 15.5 | manual | M6 |
| 15.6 | test | core reads numbers from tuning |
| 15.7 | test | every criterion id of requirements.md has a coverage row, and every row names a known id (Req 15.7) |
| 15.7 | test | every test row names a literal it or test title, or a describe title with an it inside (Req 15.7) |
| 16.1 | test | world-view depends on pixi.js only |
| 16.1 | test | the lockfile pins pixi.js at 8.22.0 |
| 16.2 | test | docs/licenses.md records pixi.js 8.22.0 (Req 16.2) |
| 16.3 | test | other workspaces are reached only through the seven package entry points |
| 16.3 | test | the app imports only from packages |
| 16.4 | test | world-view imports only marrow/core from marrow |
| 16.4 | test | pure zones import no React, PixiJS, MediaPipe or DOM |
| 16.5 | test | packages mention no app content |
| 16.5 | test | packages contain no player-facing text |
| 16.6 | test | csp_allows_pixi_shaders |
| 16.7 | test | world-view depends on pixi.js only |
| 16.8 | reason | The report of task 8 pastes the real output of npm run typecheck, npm run lint, npm test and npm run test:e2e, with their results. |
