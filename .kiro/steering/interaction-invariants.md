---
inclusion: always
---

# Interaction model and invariants

This file is the source of truth for how input becomes interaction. Numbers marked *(tune)* are starting values that live in `tuning.ts` and will be adjusted with a real camera. The rules themselves do not change without the user's approval.

## 1. Coordinate spaces

| Space | Definition |
|---|---|
| **Camera** | MediaPipe normalized image coordinates, x and y in 0..1, not mirrored |
| **Screen** | Normalized viewport coordinates, x in 0..aspect, y in 0..1, origin top-left. Pointers and hit tests live here |
| **World** | Scene coordinates of a glade: lateral x, height y, depth z along the path |

- Mirroring happens exactly once, at camera -> screen (`x' = 1 - x`). The player's right hand appears on the right side of the screen. MediaPipe "left" landmarks belong to the player's left side.
- Landmarks used: nose 0, shoulders 11 and 12, wrists 15 and 16. Hips are never required.
- A landmark is valid when its visibility is at least 0.5 *(tune)* and it lies inside the frame.

## 2. Pointers

- Each active wrist is one pointer, drawn as a small orb. The player chooses right, left or both. Nothing ever requires both.
- Each pointer has its own One Euro filter (start: minCutoff 1.2 Hz, beta 0.02, dCutoff 1 Hz) *(tune)*. After any tracking gap the filter resets, so positions before and after a gap are never blended.
- Camera -> screen mapping applies a uniform **reach gain** around the centre of the player's comfort region, computed once at calibration and clamped to 1.0-1.6 *(tune)*, so a small comfortable range still covers a usable part of the play area. The comfort grid is queried through the same mapping; gain never makes an unvisited area count as reachable.
- In simulated-input mode the mouse or touch position is one pointer, through the same pipeline from the screen-space stage onward. The head signal follows the pointer's horizontal offset from centre at 30% strength *(tune)* so parallax is visible without a camera.

## 3. Comfort map

- Calibration: the player moves each active hand wherever is comfortable. Nominal 20 s, may finish from 12 s once enough targets can be placed, hard cap 30 s *(tune)*. Then a 2 s calm hold records the neutral head position and the shoulder width.
- The calm hold needs the nose and both shoulders. If they are not visible, show "Keep your face and shoulders in view" and keep waiting. After 5 s also offer "Skip head view", which turns head parallax off for this session only; everything else continues.
- Storage: one low-resolution occupancy grid per wrist in camera space (start 32x24). A cell is valid after 4 valid samples *(tune)*.
- Reachable means sampled. Never treat the bounding box, convex hull or gaps between sampled areas as reachable. The glowing aura shown to the player is a visual smoothing of the grid and never enlarges the valid region.
- A returning player calibrates again. No calibration data is stored between sessions; the early finish at 12 s keeps this short.

## 4. Target placement

- Each stage defines authored candidate **slots** in world space (more slots than targets). Lanterns, spirits and echo objects are placed at runtime into slots, so scene art must not bake a target into a fixed spot.
- A slot is usable when its whole hit circle, expanded by the maximum interaction-layer parallax offset, lies on valid comfort cells of at least one active wrist.
- If fewer usable slots exist than the stage needs, targets are presented one after another in the usable slots. If no slot is usable, show "Retry calibration" and "Try without camera". Never enlarge the comfort map to make a check pass.
- Target hit radius starts at 0.09 of viewport height, range 0.07-0.13 *(tune)*. The visible object may be smaller than its hit area, never larger.

## 5. Dwell selection

- Dwell time 1.5 s *(tune)*, shown as a progress ring on the active target only.
- The first pointer to enter a target owns it. A second pointer inside the same target adds no time and cannot take ownership until the owner has left.
- Each step classifies the owner pointer as exactly one of:
  - **Inside**: valid and inside the hit area. Progress grows by the step's delta.
  - **Outside**: valid and outside the hit area. Progress is frozen. After more than 150 ms of continuous Outside, progress resets to zero and ownership is released.
  - **Invalid**: the owner wrist is not valid. Progress is frozen. After more than 300 ms of continuous Invalid, the hold is cancelled: progress zero, ownership released.
- The Outside and Invalid timers are separate. Each resets when the pointer leaves that state, and time in one never counts toward the other. Progress grows only in Inside steps, so time across a gap is never counted.
- Once ownership is released, any active pointer (including the other hand) may start a new hold from zero.
- One selection per activation. After a selection the pointer must leave the hit area before that target can be selected again.
- Dwell timers run on the presence clock (section 6). A tracking hold therefore never adds progress, because the owner is Invalid throughout it.

## 6. Tracking lifecycle and the two clocks

- Two clocks, both advanced by clamped frame deltas (max 100 ms per step):
  - **Presence clock** stops only on Pause and hidden tab. Dwell timers and tracking timers run on it.
  - **Session clock** also stops during a tracking hold. Everything else that takes time runs on it: playback, presentation and let-pass windows, celebration, travel, ambient motion, help timers.
- Head landmarks lost, wrists valid: the view eases back to centre over about 0.5 s and play continues.
- One active wrist invalid while another active wrist is valid: no tracking hold. A hold owned by the invalid wrist follows the Invalid rule in section 5. After 1 s a small hint appears.
- No valid active wrist for more than 300 ms: **tracking hold** begins and the session clock stops. After 1 s without a valid active wrist, the "Step back into view" overlay appears with Recover, Try without camera and Exit. Play resumes after 1 s of continuous valid tracking of at least one active wrist *(tune)*.
- Pause and tracking hold are suspension flags on top of the current stage. They never change which stage is active.

## 7. Session state machine

`SETUP -> CALIBRATING -> ENTERING -> PLAYING -> CELEBRATING -> TRAVELLING -> PLAYING ... -> BLOOM -> SAVED`

- Exactly one transition per completed stage. A repeated or late completion event never starts a second journey.
- Travel starts 1-2 s after the completion reward and lasts 5-7 s with ease-in and ease-out *(tune)*.
- During TRAVELLING, CELEBRATING, playback and any suspension: dwell cannot select, drawing is off, no gameplay completion can occur. Targets become active only after travel has fully stopped at the next glade.

## 8. View: projection, head parallax, view lock

- There is exactly one function `worldToScreen(point, view)` and its inverse, in `world-view`. Rendering and hit testing both use it with the same `view` value in the same frame. Nothing else converts between world and screen.
- `view` holds the travel distance along the path and the head offset. Depth scaling: an object's scale and screen position depend on its depth minus the travel distance; near groups grow and exit past the screen edges, the horizon stays almost still. A single flat image zoom is not acceptable.
- Head offset: nose position minus the calibrated neutral nose, divided by the calibrated shoulder width, dead zone 0.05, clamped, smoothed *(tune)*. Do not subtract the current shoulder centre each frame: moving the whole upper body should move the view.
- Direction (window effect): when the player's head moves to the right of the screen, near layers shift left, far layers barely move.
- Limits at the nearest layer: +/-3% of viewport width, +/-2% of height. No roll, no head-driven zoom. Layers are drawn with overscan so no edge is ever exposed.
- Targets live in the world and take part in parallax, on an interaction layer whose factor is 0.2 of the nearest layer *(tune)*.
- **View lock:** while any dwell is in progress on a target, and during a Bloom stroke, the interaction layer's head offset is held at the value it had when the hold or stroke began. It eases back when the hold ends. Decorative layers keep moving. The player's own reaching must never push the target out from under their hand.
- A foreground object may reveal things behind it but never covers a required target.
- Motion settings *(tune)*:
  - **Full**: everything as specified in this file and in art-and-motion.md.
  - **Gentle**: head offsets x0.5, ambient amplitude and speed x0.5, travel duration x1.3 (the 5-7 s travel range applies to Full only).
  - **Reduced**: no head parallax, no particles (fireflies, falling leaves), leaf sway and fog drift at x0.25 amplitude, steady lantern and candle light (no flicker), no travel scaling: each journey becomes a 1.5 s cross-fade to the next glade, with the path brightening to show progress.
  - If the browser reports `prefers-reduced-motion`, start in Reduced. The setting can change at any time and takes effect within one frame.

## 9. Help and adaptation

- Two axes: motor (target radius and tolerance, inside the comfort region) and cognitive (sequence length, amount of guidance).
- At most one axis changes, and only at a round boundary. Never during an active dwell or playback.
- After two difficulties in a round, offer or apply gentle help. Player-facing wording follows the banned list in accessibility-and-copy.md.
- "Continue with help" reveals the next step and always allows progress.

## 10. Invariants that must each have a named test

1. Dwell never counts time twice, never selects on invalid input, respects ownership between two pointers, and requires re-entry after a selection.
2. Every placed target and its full hit area stay inside the reachable region for every allowed head offset.
3. For any view (travel distance and head offset), `screenToWorld(worldToScreen(p))` returns `p`, and the rendered target position equals the hit-test position.
4. Exactly one transition per stage; no gameplay completion while travelling, celebrating, in playback, paused or in tracking hold.
5. Losing only the head never cancels a valid wrist hold; after more than 300 ms with no valid active wrist the session clock stops (not before), and it restarts only after 1 s of continuous valid tracking.
6. At most one adaptation axis changes per round boundary; every help path reaches completion in a bounded number of steps.
7. A stroke never connects across a tracking gap; save then reload reproduces the same plant; a corrupted or unknown-version save is ignored with a safe reset.
8. Camera denied -> simulated input -> full completion, in both apps. Reduced motion and mute leave every stage completable.
