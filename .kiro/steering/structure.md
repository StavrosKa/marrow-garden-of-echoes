---
inclusion: always
---

# Repository structure

```text
.kiro/                     specs, steering, hooks, settings (committed, never ignored)
packages/
  marrow/                  the skeleton
    src/core/              pure logic: frame types, filters, calibration, comfort map,
                           placement, pointers, dwell, tracking lifecycle, head view,
                           presence and session clocks, help policy, tuning
    src/challenges/        content-free primitives: attention round, sequence recall
    src/input/             PoseSource implementations: camera (MediaPipe), pointer, trace
    src/sim/               headless session simulator and synthetic player profiles
    src/react/             shared UI: camera permission, hand choice, calibration screen,
                           pause and tracking-lost overlays, motion and audio settings,
                           per-app settings storage
  world-view/
    src/core/              pure: view, layer depth, projection and its inverse,
                           head parallax, view lock, travel easing
    src/pixi/              small Pixi helpers: scene manager, layer containers, hit circles
apps/
  lantern-garden/          session machine, glades, journeys, forest art, audio, Bloom, save
  whisper-hall/            its own session machine, room, content, ending
templates/
  marrow-app/              neutral runnable reach-and-hold starter
tests/
  traces/                  synthetic input traces only (no recordings of real people)
  e2e/                     Playwright
docs/                      architecture, licenses, measured results, bugs found, Kiro journal
```

## Dependency rules (enforced by lint and by a test)

- These rules govern imports between workspaces. Third-party packages and relative imports inside the same workspace are always allowed.
- `apps/*` and `templates/*` may import from `packages/*` and from no other workspace.
- `apps/lantern-garden` and `apps/whisper-hall` never import from each other, directly or through a shared file outside `packages/`.
- `packages/marrow/src/core`, `src/challenges`, `src/sim` and `packages/world-view/src/core` import no React, PixiJS, DOM or MediaPipe. PixiJS code in `world-view` lives only in `src/pixi`.
- `packages/marrow` does not import `packages/world-view`. `packages/world-view` may import from `marrow/core` (types and pure functions).
- `packages/*` never import from `apps/*` or `templates/*`.
- Nothing in `packages/` mentions lanterns, spirits, glades, the hall, or any other app content. If a name from the story appears in a package, it belongs in an app.
- `packages/` contain no player-facing text. Components in `marrow/react` take every string from a typed `MarrowCopy` object supplied through a provider; each app and the template fill it from their own `copy/` folder.

## Package entry points

`marrow/core`, `marrow/challenges`, `marrow/input`, `marrow/sim`, `marrow/react`, `world-view` (pure) and `world-view/pixi`. Apps and the template import from these seven entry points, never from deep file paths.

## Inside an app

```text
src/
  session/     session state machine and stage order (pure)
  glades/      one folder per stage: rules (pure), content JSON, scene (Pixi)
  scene/       scene manager, layers, ambient motion
  audio/       Web Audio synth
  ui/          React screens and overlays
  copy/        all player-facing text in one place, including the MarrowCopy object
  save/        versioned localStorage (Lantern Garden only)
```

The starter template has the same shape with one screen, so that copying it and filling `glades/` is how a new app begins.
