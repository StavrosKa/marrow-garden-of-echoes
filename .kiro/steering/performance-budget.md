---
inclusion: fileMatch
fileMatchPattern: ["apps/**/scene/**", "apps/**/stages/**", "apps/**/journeys/**", "packages/world-view/**", "packages/marrow/src/input/**"]
---

# Performance budget

Targets on the reference computer (recorded in `docs/measured-results.md` with its CPU, GPU, browser and camera). These are goals to measure, not facts, until that file says otherwise.

| Metric | Target |
|---|---|
| Rendering | 30 fps or more during play and travel |
| Pose inference | 15-20 Hz |
| Wrist-to-orb latency | Not perceptibly laggy; measure and record it |
| First interactive (simulated input) | Under 5 s on a normal connection |
| App bundle (excluding the pose model and WASM) | Report the size after each build |

## Rules

- A debug overlay behind `?debug=1` shows render fps, inference Hz, pointer validity, the comfort grid and all hit areas. It works on every screen, including the input playground.
- Never keep more than one video frame waiting for inference. Drop frames, do not queue them.
- No per-frame allocation in the render loop for things that can be reused (points, arrays, graphics objects).
- Redraw a procedural texture only when its inputs change. Static silhouettes are drawn once and cached.
- Layers: 5-6. Stay inside the ambient limits in `art-and-motion.md`.
- Canvas resolution: the device pixel ratio used for rendering is capped at 2 *(tune)*. Hit testing works in screen space and never depends on it.
- When the budget is missed, reduce in this order: particles, reveal mask resolution (only once the Stretch reveal mask exists), number of ambient groups, fog patch sets. Never change dwell time, tolerance windows or any other interaction timing to gain speed.
- Dwell and all other timing run on the presence and session clocks (interaction-invariants.md section 6), never on wall-clock time, so a slow frame makes the game slower, never easier or harder.
- Move inference to a Web Worker only if measured rendering falls below target with inference on the main thread, and only after asking the user.
