---
inclusion: always
---

# Product: Marrow - Garden of Echoes

Entry for Kiroween 2026, category **Costume Contest**: one app with a haunting, polished interface where the spooky design is what makes the app work.

## What it is

**Garden of Echoes** is one browser game, played with the body in front of a webcam. The player wakes a dark, colourless forest garden by reaching for lanterns, watching spirits, remembering echoes and drawing plants in the air. It is one continuous journey in two levels:

| Level | Setting | Stages |
|---|---|---|
| **1. Lantern Garden** | Night forest | Lantern Glade (reach and hold) -> journey A -> Whisper Glade (attention, rule switch) -> path choice -> journey B to the door of an old hall in the forest |
| **2. Whisper Hall** | Candle-lit interior | The door opens and the view moves inside -> Echo challenge (memory, three echo objects) -> the back door opens |
| **Finale: Bloom** | The garden behind the hall | Draw plants in the air, save the garden, stay in it |

**Marrow** is the name of the input engine underneath (`packages/marrow`, `packages/world-view`): pose input, filtering, comfort map, wrist pointers, dwell selection, tracking lifecycle, head-view signal, content-free challenge primitives, help policy, simulation, shared setup UI. It is an internal, content-free library, kept separate so it can be tested headlessly. It is not a separate deliverable.

There is exactly one app, one build and one URL.

## Category fit: the spooky design is the interface

Every haunting element carries a function. Nothing spooky is decoration only, and no function is shown with a plain widget when a world element can show it.

| Function | Shown as |
|---|---|
| Pointer (the player's wrist) | A will-o'-the-wisp that follows the hand |
| Selection progress (dwell) | The wisp's light flowing into the lantern or candle as a ring of flame |
| Progress | Colour and light returning to a dead, grey world; no score, no bars |
| Reachable area (comfort map) | A glowing aura the player paints in the dark |
| Attention stimuli | Friendly spirits with a symbol (blue drop, gold leaf) |
| Memory sequence | Echoes: lights and notes that the hall repeats back |
| Guidance and transitions | Fog that parts, a path that lights up, a door that opens |
| Tracking lost | The world dims and holds its breath until the player returns |
| Menus, setup, pause | Candle-lit panels in the same visual language as the world |

Tone: haunting and beautiful, never frightening. Eerie quiet, fog, candlelight, friendly spirits. No jump scares, gore, or sudden loud sounds.

## Who it is for

People who want to play with their body in front of a laptop webcam but cannot or do not want to stand, jump or use both arms: seated players, one-handed players, players with a small comfortable range of motion. The game measures the player's comfortable reach first and only ever places targets inside it.

Never claim therapy, rehabilitation, diagnosis or clinical benefit, in UI copy, code comments, README or docs.

## Experience rules (these override convenience)

- Every required action can be done seated and with one hand. Nothing requires two hands at once.
- Progress is shown in the world: colour, light, music, an opening path, plants. No numeric score, no countdown pressure, no failure screen.
- A mistake never removes progress. It repeats the step with a hint.
- "Continue with help" is always available and always leads to completion in a finite number of steps.
- The whole experience can be completed without a camera, using a mouse or touch pointer, clearly labelled "Simulated input".
- The two levels are one continuous place. No level-select menu. Each level is announced by a short in-world title that fades in and out ("Lantern Garden", "Whisper Hall").
- First session target: 6-8 minutes.

## Player journey

Home -> Start -> camera permission -> choose hand(s) -> comfort map -> enter forest -> Lantern Glade -> journey A -> Whisper Glade -> path choice -> journey B -> hall door opens, threshold -> Echo challenge in Whisper Hall -> back door opens, threshold -> Bloom -> save -> stay in the blooming garden.

On a return visit the saved garden is visible from Home with "Visit my garden" and "Start a new journey". A new journey replays both levels from the start, including the colour reveal; saved plants are kept. A returning player calibrates again before interacting.

## Scope tiers

Build order:
1. **Core** items, except those marked *(after gate)*, until the **end-to-end gate** passes: Home to saved garden in simulated-input mode, in the deployed build.
2. Core items marked *(after gate)*.
3. **Stretch** items, only when the user names one. If the user names one out of the listed order, point out the order once, then do what the user decides.

**Feature freeze: 2026-12-01, end of day, Athens time.** After it, only bug fixes, tuning values, copy, docs and the demo.

**Core**
- Marrow: pose input, pointer simulation, filtering, comfort map, placement inside comfort region, dwell with ownership, tracking lifecycle, head-view signal, presence and session clocks, help policy, simulation, and a neutral playground screen for testing input.
- Level 1: Lantern Glade, Whisper Glade, journeys A and B, head parallax, path choice (see below), colour reveal by patches, gentle leaf sway and fog.
- Level 2: the hall door and threshold, the hall interior, the Echo challenge (two rounds, lengths 2 and 3), the back door and threshold.
- Bloom: drawing, plant generation, save/reload, the saved garden on Home.
- Throughout: synthesized audio, motion settings Full / Gentle / Reduced, level titles.
- *(after gate)*: the themed interface pass (Home, setup, calibration, pause and overlays in the candle-lit visual language), fireflies and falling leaves, candle and dust motes in the hall.

**Path choice.** Before journey B two targets appear: left to the fireflies, right to the candles. Any active pointer can select either target; the choice is never tied to one hand. Both options use the same journey B geometry and both arrive at the hall door. The choice changes only the dressing along journey B: candles beside the path, or small glowing lights (static glowing dots until fireflies exist, fireflies after).

**Stretch (in this order, one at a time, each finished and tested before the next starts)**
1. A second challenge in Whisper Hall: one attention block with the hall's own stimuli.
2. Second layout for journey B (different geometry, not only different dressing).
3. Low-resolution reveal mask instead of patches.
4. Torso-lean path choice (wrist choice stays as the equal alternative).
5. Jitter-driven target sizing.
6. Pose inference in a Web Worker (only if measured render rate is below budget).

No Stretch item starts after the feature freeze.

**Out of scope**
A second app or starter template, finger or face models, gesture classification, walking, free 3D navigation, physics engine, 3D models, endless forest, multiple endings, drawing recognition, backend, accounts, multiplayer, LLM or API keys, reports or exports, mobile-first layout, custom MCP server.
