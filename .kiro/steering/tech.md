---
inclusion: always
---

# Technology and engineering rules

## Stack

| Technology | Role |
|---|---|
| TypeScript (strict) | Everything |
| npm workspaces | One repo: `packages/*` and `apps/garden-of-echoes` |
| Vite + React | App shell, menus, setup, overlays. One app, one Vite build |
| PixiJS | 2.5D scene rendering |
| MediaPipe Tasks Vision, Pose Landmarker (lite model) | One tracker, one person. No hand, face or segmentation models |
| Web Audio API | Synthesized notes and cues. No audio files |
| localStorage | The versioned garden save and the settings (motion, audio, hands), under keys with one fixed prefix |
| Vitest + fast-check | Unit and property-based tests |
| Playwright | End-to-end critical paths in simulated-input mode |
| Static HTTPS hosting | One deployment, one URL. No backend, no login, no API keys |

Pin exact versions in `package.json` at first install and commit the lockfile. Do not upgrade or add a dependency without asking the user first and saying why.

Target: desktop Chrome and Edge on Windows, webcam at 640x480.

## Architecture rules

1. **Logic is pure and headless.** Dwell, calibration, placement, tracking lifecycle, challenge primitives, stage rules, the session state machine and Bloom plant generation are pure TypeScript: `step(state, input, dtMs) -> { state, events }` or plain functions. They import nothing from React, PixiJS, the DOM or MediaPipe. The renderer reads state and draws it. The simulator runs the same logic with synthetic input.
2. **No wall-clock time in logic.** Never call `Date.now()`, `performance.now()` or `setTimeout` inside logic. Time arrives as `dtMs` from the presence clock or the session clock (interaction-invariants.md section 6). Randomness arrives as a seeded generator passed in.
3. **One input contract.** Camera, pointer simulation and recorded traces all implement the same `PoseSource` interface and emit the same frame type. Game code cannot tell them apart.
4. **PixiJS is imperative.** One scene manager owns the Pixi application and the render loop. Do not use `@pixi/react`. React renders DOM only (home, setup, overlays, buttons) and talks to the scene through a small typed store.
5. **Rendering is decoupled from inference.** The render loop runs on `requestAnimationFrame`. Pose inference runs at its own rate and keeps only the latest frame: if a result is pending, new video frames are dropped, never queued.
6. **Start pose inference on the main thread** behind the `PoseSource` interface. Moving it to a Web Worker is a Stretch item, decided by measurement.
7. **All tunable numbers live in one typed config module per package** (`tuning.ts`), validated at startup. No magic numbers in logic or scenes. Content (stage layouts, target slots, sequences) is JSON validated against a schema at load, with a readable error.
8. **Vendor runtime assets.** The MediaPipe WASM files and the pose model are served from the app's own static files, not from a third-party CDN, so the deployed app keeps working through the judging period. Record their licence and source in `docs/licenses.md`.
9. **Base path is configurable** (`BASE_PATH` env var read in the Vite config) so the app can be hosted under a sub-path.
10. **Privacy.** Video frames never leave the device and are never stored. No raw pose traces are saved. Stop all camera tracks on exit and when the app unmounts.

## Testing rules

- Every invariant listed in `interaction-invariants.md` has a named test. Invariants over ranges of input are property-based tests with fast-check.
- When a property test fails, keep the failing seed as a regression test and note it in `docs/bugs-found.md` (seed, what broke, fix commit). Record only real bugs.
- Playwright tests use simulated-input mode only. They never need a camera.
- A task is done when `npm run typecheck`, `npm run lint` and `npm test` pass. Say so explicitly with the output; if something fails or was skipped, say that instead.

## Root scripts (keep these names)

`dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `simulate`.

## Working style for the agent

- Read the relevant spec and steering before editing. Stay inside the current task; do not implement later tasks early.
- Prefer the smallest change that satisfies the task. No speculative abstractions, no extra features, no new files outside the structure in `structure.md`.
- If a requirement conflicts with steering, or is ambiguous, stop and ask instead of guessing.
- Never weaken, skip or delete a failing test to make it pass. Fix the code, or explain why the test is wrong and wait for approval.
- Report measured numbers only. Do not write that something is fast, accessible or verified unless a test or measurement in this repo shows it.
