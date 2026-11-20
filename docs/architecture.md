# Architecture

## World view

This section describes the code of `packages/world-view` and of the slice in `apps/garden-of-echoes/src/dev/world`, as it is written. The design is `.kiro/specs/world-view/design.md`. Where the code differs from it, the section "Differences from the design" says so. Each statement names the file that holds it. The camera path (manual steps M1 to M6 of `.kiro/specs/world-view/tasks.md`) has not been run by the user, so nothing here says that the camera path was verified.

### Entry points

- `world-view` is `packages/world-view/src/core/index.ts`. It exports the pure code: `TUNING`, `validateTuning`, `worldToScreen`, `screenToWorld`, `targetScreen`, `parallaxMargin`, `edgeOverscan`, `backdropRect`, `createGlide`, `stepGlide`, `createLock`, `stepLock`, `motionProfile`, `createTravel`, `startTravel`, `stepTravel`, `resolveLayerTable`, `validateLayerTable`, `validateSegment`, `checkDepthScaling`, and their types. It imports only `marrow/core`.
- `world-view/pixi` is `packages/world-view/src/pixi/index.ts`. Its one function, `createSceneManager(options)`, wraps `createSceneManager(options, ports)` from `sceneManager.ts` with `createPixiPorts()` from `pixiPorts.ts`. It exports the types `SceneManager`, `SceneManagerOptions`, `SceneLayerSpec`, `ShapeSpec`, `SceneTarget`, `FrameData`, `HitCircle` and `DebugEntry`.
- The app imports only these two entries (`tests/dependency-graph.test.ts`, "the app imports only from packages").

### Per-frame data flow

Each rendered frame runs in two parts. The Scene Manager's tick calls the slice, the slice returns the frame data, the Scene Manager draws, and then the slice takes the dwell step. Both parts are in the files named below.

Scene Manager tick (`packages/world-view/src/pixi/sceneManager.ts`, `tick`, with `frameLoop.ts`):
1. `createFrameLoop` requests the next animation frame before the tick runs. The raw delta is the difference of the `requestAnimationFrame` timestamps, zero on the first tick, and is not clamped.
2. If the size observer set the dirty flag, `readSize` reads the host size. A new aspect replaces the projection frame object and redraws the backdrops and shapes. A zero width or height skips the rest of the tick.
3. The resolution is `min(devicePixelRatio, maxPixelRatio)`, read every tick.
4. `options.getFrame(rawDt)` returns the `FrameData`. The slice does all the stepping here.
5. Each layer container gets `layerTransform(spec, view, frame)`. The interaction layer's decor uses `interactionView`, the other layers use `view`. A culled layer is hidden.
6. `applyTargets` (`targets.ts`) calls `targetScreen` once per target, writes the display position, depth scale and visibility, and returns the hit circles. It returns none while `travelling` is true.
7. The cover alpha and the accent alpha are set, then `app.render()`, then `onFrame(circles)`.

Slice, the step before the draw (`apps/garden-of-echoes/src/dev/world/worldRun.ts`, `stepWorldFrame`, called from `worldSession.ts`, `frameData`):
1. `presenceDelta` gives the tracking step its presence time (camera mode only, `stepTracking`).
2. `stepClocks` from marrow gives the presence and session deltas, with the pause, hidden and tracking-hold flags. It is the only place that clamps the frame delta.
3. `stepHeadView` (marrow) runs in both modes. The head driver's value replaces its output while it is on (`headDriver.ts`).
4. The motion level is read from the settings store, and `motionProfile` gives the head multiplier. The target is the head output times that multiplier.
5. `stepGlide` gives the live head from the target.
6. `lockRequested` is true when a dwell owns an active target. The dwell state is the one after the previous frame, so the lock never reads the dwell of the frame it is computing.
7. `stepLock` gives the interaction head (held or live) and the decorative head (always the live head).
8. The reward timer runs on the session clock once both stop-1 targets are selected. At `rewardDelayMs` it calls `startTravel`, and `stepTravel` runs with the session delta (zero in the frame that starts the travel).
9. The two views are built once: `view` with the decorative head and `interactionView` with the interaction head. The shown and active sets follow the stops and the phase of the travel. The result is the `FrameData`.

After the render (`worldRun.ts`, `afterRender`, called from `worldSession.ts`, `afterFrame`): `stepDwell` (marrow) receives the circles of this frame, filtered to the active ids, and the pointers of this frame, with the presence delta. A completed dwell adds the target to `selected` and produces a selection event with the `lanternWarm` token. `worldSession.ts` then calls `setTargetColour`.

Restart (`restartRun`) makes new states and a new generation for the activation ids. The driver, the neutral head and the tracking lifecycle are kept.

### Tuning keys

`packages/world-view/src/core/tuning.ts` holds 31 keys in one frozen object, with `validateTuning(t, marrow)` as the check. Each key carries a `tune` or `rule` label in the interface and in `TUNING`; `tests/world-view-tuning-labels.test.ts` checks the labels. The keys are:

- Parallax and projection: `limitX` (rule), `limitY` (rule), `interactionFactor`, `nearPlane`, `vanishingPointY`, `maxAspect`.
- Layer table and depth scaling: `layersMin` (rule), `layersMax` (rule), `horizonDepth`, `foregroundDepth`, `journeyHorizonMaxMove`, `journeyForegroundMinGrowth`, `doorHorizonMaxMove`, `doorForegroundMinGrowth`.
- Glide and lock: `glideTauMs`, `glideCapPerS`, `glideEpsilon`, `lockEaseMs`.
- Travel: `journeyMinMs`, `journeyMaxMs`, `doorMs`, `arrivalToleranceMs`, `crossFadeMs`, `minFadeMs` (rule).
- Motion profile: `gentleHeadMultiplier`, `gentleTravelMultiplier`, `gentleAmbientAmplitude`, `gentleAmbientSpeed`, `reducedAmbientAmplitude`, `reducedAmbientSpeed`.
- Scene Manager: `maxPixelRatio`.

The number 1 of the Full level and 0 of the Reduced head multiplier are named constants in `motion.ts`, and the frame-delta clamp, the hit radius and the light-ease minimum stay in marrow's `TUNING`.

### The Scene Manager seam

`packages/world-view/src/pixi/ports.ts` defines the seam. The Scene Manager and its tests use only these interfaces:

- `PixiPorts`: `requestFrame`, `cancelFrame`, `devicePixelRatio`, `observeSize(host, callback)` (returns the disconnect), `attachView(host, view)`, `createApplication`, `createContainer`, `createGraphics`.
- `PixiApplicationLike`: `stage`, `canvas`, `init`, `resize`, `render`, `destroy`.
- `ContainerLike`, `GraphicsLike` and `DisplayLike` (the display object of a target: `position.set`, `setDepthScale`, `visible`).
- `HostLike`: `clientWidth`, `clientHeight` and `style.touchAction`. An `HTMLElement` satisfies it.

`packages/world-view/src/pixi/pixiPorts.ts` is the only file that imports `pixi.js` at run time. `sceneManager.test.ts` and `targets.test.ts` use fakes of these interfaces (`fakes.ts`), so no test loads Pixi.

### The slice

The slice is in `apps/garden-of-echoes/src/dev/world`, and reaches the route `?playground=world` through `route.ts` and the dynamic import in `main.tsx`.

- Content and validation: `forestSlice.json` (six layers, two segments, two stops), `worldContent.ts` (`validateWorldContent`, `loadWorldContent`, `frontClearanceIssues`), `sceneSpec.ts` (content and theme to the Scene Manager's layer and target specs), `constants.ts` (the app values).
- Placement: `placementSetup.ts` (`mouseComfort` from marrow's `chooseWholeScreen`, `cameraComfort` from `markAllValid`, `placeStops`).
- Frame logic: `worldRun.ts` (above), `headDriver.ts`, `cameraNeutral.ts` (the neutral head, recorded only from a frame with the nose and both shoulders valid), `debugSnapshot.ts` (the frozen snapshot).
- Browser glue: `worldSession.ts` (the Scene Manager, the Pointer Source and the Camera Source, and the screen state), `WorldPlayground.tsx` (the screens and `window.__worldPlayground`, only under the route), `StartPanel.tsx`, `DebugPanel.tsx`, `world.css`.
- Colours come from `apps/garden-of-echoes/src/ui/theme.ts`.

### Differences from the design

These are the differences found by comparing the code with sections 1 to 8 of `design.md` as it is now. Each one names its file. Sections 9 to 11 of the design were not compared with the code in this pass, so differences there, if any, are not listed.

1. The play area is fixed at 960 by 540 CSS px (`world.css`, `.play-area`), and `worldSession.ts` uses the fixed aspect `DEFAULT_ASPECT` for every projection. The Scene Manager redraws on an aspect change, but the slice never re-runs placement on a change of size. Design 11 item 7 says it re-runs placement on a change of aspect.
2. The theme has a token `lanternGlow` (`#FFE2A0`, `theme.ts`) that the design does not list. The slice uses it for the focus ring: `WorldPlayground.tsx` sets `--slice-glow` from it and `world.css` draws `button:focus-visible` with that outline. Design 11 item 9 lists only the grey ramp, `night` and `lanternWarm`.
3. The session notifies React every frame. `worldSession.ts`, `afterFrame`, calls `notify()` after each frame, and `WorldPlayground.tsx` subscribes with `session.subscribe(rerender)`. So the playground and its debug panel re-render at the frame rate. The design does not say how often the React side is updated.
4. The shape drawing functions differ from design 1.2. `shapes.ts` has `drawBackdrop(graphics, rect, colour)` with no alpha, and `drawShapes(graphics, shapes, aspect, accent)` with a fourth argument. The file draws through the `GraphicsLike` port and imports no `pixi.js` type.
5. `motionRank` in `motion.ts` returns a `number`, the index of the level in the order Reduced, Gentle, Full. Design 1.1 gives its type as `0 | 1 | 2`.
6. `fadeCover` in `travel.ts` reads `maxClockStepMs` from marrow's `TUNING` directly, not from the `tuning` argument that `stepTravel` receives. The design's convention is that every function reads its numbers from the tuning parameter it takes.
7. `stepTravel` in `travel.ts`, stage 4, clamps the eased value to 0..1 with `Math.min` and `Math.max` after `smootherstep`, which already clamps. Design 4.3 has no clamp at that stage.

### Test and check references

- The coverage of the requirements is `.kiro/specs/world-view/coverage.md`, checked by `tests/world-view-coverage.test.ts`.
- The Req 2.2 scan (no `depth - travel` pattern in `src/pixi` or the app) is one of the tests of that file.
