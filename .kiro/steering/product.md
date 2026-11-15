---
inclusion: always
---

# Product: Marrow - Garden of Echoes

Entry for Kiroween 2026, category **Skeleton Crew**: one lean skeleton (Marrow) and two distinct apps built on it.

## The three deliverables

| Deliverable | Is | Is not |
|---|---|---|
| **Marrow** (`packages/marrow`, `packages/world-view`, `templates/marrow-app`) | A skeleton for webcam body-input apps: pose input, filtering, comfort map, up to two wrist pointers, dwell selection, tracking lifecycle, head-view signal, content-free challenge primitives, help policy, headless simulation, shared setup/pause UI | Game rules, story, forest content |
| **Lantern Garden** (`apps/lantern-garden`) | The full adventure: Lantern Glade -> Whisper Glade -> Echo Glade -> Bloom, joined by three forward journeys through one continuous forest, ending in a personal garden that is saved | Anything from Whisper Hall |
| **Whisper Hall** (`apps/whisper-hall`) | A separate 2-3 minute attention-and-recall session in a single candle-lit room, with its own home screen, rules, state and ending | The forest, travel, drawing, saving |

"Garden of Echoes" is the presentation name of the whole project. The two apps never import from each other. Each has its own build and URL.

## Who it is for

People who want to play with their body in front of a laptop webcam but cannot or do not want to stand, jump or use both arms: seated players, one-handed players, players with a small comfortable range of motion. The game measures the player's comfortable reach first and only ever places targets inside it.

Never claim therapy, rehabilitation, diagnosis or clinical benefit, in UI copy, code comments, README or docs.

## Experience rules (these override convenience)

- Every required action can be done seated and with one hand. Nothing requires two hands at once.
- Progress is shown in the world: colour, light, music, an opening path, plants. No numeric score, no countdown pressure, no failure screen.
- A mistake never removes progress. It repeats the step with a hint.
- "Continue with help" is always available and always leads to completion in a finite number of steps.
- The whole experience can be completed without a camera, using a mouse or touch pointer, clearly labelled "Simulated input".
- Friendly spirits and candles. Atmospheric, never frightening: no jump scares, gore, or sudden loud sounds.
- First session target: 6-8 minutes for Lantern Garden, 2-3 minutes for Whisper Hall.

## Player journey (Lantern Garden)

Home -> Start -> camera permission -> choose hand(s) -> comfort map -> enter forest -> Lantern Glade -> journey A -> Whisper Glade -> path choice -> journey B -> Echo Glade -> journey C -> Bloom -> save -> stay in the blooming garden.

On a return visit the saved garden is visible from Home with "Visit my garden" and "Start a new journey". A new journey replays the glades from the start, including the colour reveal; saved plants are kept. A returning player calibrates again before interacting.

## Scope tiers

Build order:
1. **Core** items, except those marked *(after gate)*, until the **end-to-end gate** passes: Home to saved garden in simulated-input mode, in the deployed build.
2. Core items marked *(after gate)*.
3. **Stretch** items, only when the user names one. If the user names one out of the listed order, point out the order once, then do what the user decides.

**Feature freeze: 2026-12-01, end of day, Athens time.** After it, only bug fixes, tuning values, copy, docs and the demo.

**Core**
- Marrow: pose input, pointer simulation, filtering, comfort map, placement inside comfort region, dwell with ownership, tracking lifecycle, head-view signal, presence and session clocks, help policy, simulation.
- Starter template: one neutral reach-and-hold screen.
- Lantern Garden: four stages, three forward journeys, head parallax, path choice (see below), colour reveal by patches, gentle leaf sway and fog, synthesized audio, Bloom drawing, save/reload, motion settings Full / Gentle / Reduced.
- Lantern Garden *(after gate)*: fireflies and falling leaves.
- Whisper Hall: two attention blocks with a rule switch demonstration between them, two recall rounds (lengths 2 and 3), own home and ending.

**Path choice.** Before journey B two targets appear: left to the fireflies, right to the candles. Any active pointer can select either target; the choice is never tied to one hand. Both options use the same journey B geometry and rejoin at Echo Glade. The choice changes only the dressing along journey B: candles beside the path, or small glowing lights (static glowing dots until fireflies exist, fireflies after).

**Stretch (in this order, one at a time, each finished and tested before the next starts)**
1. Second layout for journey B (different geometry, not only different dressing).
2. Low-resolution reveal mask instead of patches.
3. Torso-lean path choice (wrist choice stays as the equal alternative).
4. Jitter-driven target sizing.
5. Pose inference in a Web Worker (only if measured render rate is below budget).

No Stretch item starts after the feature freeze.

**Out of scope**
Finger or face models, gesture classification, walking, free 3D navigation, physics engine, 3D models, endless forest, multiple endings, drawing recognition, backend, accounts, multiplayer, LLM or API keys, reports or exports, mobile-first layout, custom MCP server.
