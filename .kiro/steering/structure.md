---
inclusion: always
---

# Repository structure

```text
.kiro/                     specs, steering, hooks, settings (committed, never ignored)
packages/
  marrow/                  the input engine (content-free)
    src/core/              pure logic: frame types, filters, calibration, comfort map,
                           placement, pointers, dwell, tracking lifecycle, head view,
                           presence and session clocks, help policy, tuning
    src/challenges/        content-free primitives: attention round, sequence recall
    src/input/             PoseSource implementations: camera (MediaPipe), pointer, trace
    src/sim/               headless session simulator and synthetic player profiles
    src/react/             shared UI: camera permission, hand choice, calibration screen,
                           pause and tracking-lost overlays, motion and audio settings,
                           settings storage
  world-view/
    src/core/              pure: view, layer depth, projection and its inverse,
                           head parallax, view lock, travel easing
    src/pixi/              small Pixi helpers: scene manager, layer containers, hit circles
apps/
  garden-of-echoes/        the one app: session machine, both levels, Bloom, art, audio, save
tests/
  traces/                  synthetic input traces only (no recordings of real people)
  e2e/                     Playwright
docs/                      architecture, licenses, measured results, bugs found, Kiro journal
```

There is one app. Do not create a second app or a `templates/` folder.

## Dependency rules (enforced by lint and by a test)

- These rules govern imports between workspaces. Third-party packages and relative imports inside the same workspace are always allowed.
- `apps/garden-of-echoes` may import from `packages/*` and from no other workspace.
- `packages/marrow/src/core`, `src/challenges`, `src/sim` and `packages/world-view/src/core` import no React, PixiJS, DOM or MediaPipe. PixiJS code in `world-view` lives only in `src/pixi`.
- `packages/marrow` does not import `packages/world-view`. `packages/world-view` may import from `marrow/core` (types and pure functions).
- `packages/*` never import from `apps/*`.
- Nothing in `packages/` mentions lanterns, spirits, glades, the hall, or any other story content. If a name from the story appears in a package, it belongs in the app. This keeps the engine testable without the game.
- `packages/` contain no player-facing text. Components in `marrow/react` take every string from a typed `MarrowCopy` object supplied through a provider; the app fills it from its `copy/` folder.

## Package entry points

`marrow/core`, `marrow/challenges`, `marrow/input`, `marrow/sim`, `marrow/react`, `world-view` (pure) and `world-view/pixi`. The app imports from these seven entry points, never from deep file paths.

## Inside the app

```text
apps/garden-of-echoes/src/
  session/     session state machine and stage order (pure)
  stages/      one folder per stage: rules (pure), content JSON, scene (Pixi)
    lantern-glade/   level 1
    whisper-glade/   level 1
    whisper-hall/    level 2 (the Echo challenge)
    bloom/           finale
  journeys/    travel segments: A, B, hall threshold, garden threshold
  scene/       scene manager, layers, ambient motion, palette
  audio/       Web Audio synth
  ui/          React screens and overlays, theme tokens
  copy/        all player-facing text in one place, including the MarrowCopy object
  save/        versioned localStorage for the garden
  dev/         the input playground screen (reachable only with ?playground=1)
```

Stage ids used everywhere (code, content, URLs, tests): `lantern-glade`, `whisper-glade`, `whisper-hall`, `bloom`.
