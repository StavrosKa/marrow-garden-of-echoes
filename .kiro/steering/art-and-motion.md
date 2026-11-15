---
inclusion: fileMatch
fileMatchPattern: ["apps/**/scene/**", "apps/**/glades/**", "packages/world-view/**"]
---

# Art direction and ambient motion

> Palette, shapes and composition are finalized from the approved mockups. Until the "Palette" section below is filled in, build every scene from flat placeholder shapes in neutral greys with one accent colour, and keep all colours in a single palette module so they can be swapped in one place.

## Look

- Night forest garden that begins almost colourless and gains colour, light and music as the player succeeds. Friendly spirits, candles and lanterns. Never frightening.
- Procedural silhouettes and a small set of reusable sprites. Five base colours plus derived brightness steps, defined once in the palette module.
- 5-6 depth layers: sky, far hills, far trees, main scene with the interaction layer, foreground foliage, fog.
- Targets (lanterns, spirits, echo objects) are separate sprites placed into runtime slots. Scene art never fixes a target to one position, and never draws a foreground object across a slot.
- External assets only with a verified CC0 licence, logged in `docs/licenses.md` with source URL and date. AI-generated mockups are visual reference only and are not shipped as assets.

## Palette

_To be filled from the mockups: five base colours with hex values, their roles (night, foliage, lantern warm, spirit blue, spirit gold), and the grey ramp for the uncoloured state._

## Colour reveal

- Core: each completed target fades in a coloured patch around itself (pre-coloured region, eased alpha). Progress, once revealed, never goes back.
- Stretch: low-resolution reveal mask between an uncoloured and a coloured render of the same geometry, updated only when progress changes, never redrawn per frame while idle.

## Forward travel

- Three finite, pre-designed path segments join the four glades. Shared plants, palette, path direction and lighting make them read as one place.
- The next glade appears gradually from behind trees and fog. Fog may soften the join; it must not replace the journey with a fade (except in Reduced motion).
- No level menu between stages.

## Ambient motion budget (upper limits per scene)

| Element | Motion | Limit | Tier |
|---|---|---|---|
| Branch and leaf groups | Slow periodic rotation with different phases | 12 groups | Core |
| Grass | Small sway near the ground | 4 foreground groups | Core |
| Fog | Slow drift of translucent patches | 2 sets of patches, inside the single fog layer | Core |
| Lanterns and candles | Brightness variation of at most 15%, cycles of 1.5 s or longer | Visible ones only | Core |
| Fireflies | Slow curves around lit points | 16 | Core, added after the end-to-end gate |
| Falling leaves | Slow fall with slight rotation | 8 at once | Core, added after the end-to-end gate |

- One shared animation clock driven by the session clock, different rates and phases per group. No physics engine, no per-leaf animation.
- Pause, hidden tab and tracking hold freeze ambient motion along with everything else.

## Audio

- Web Audio oscillators with short envelopes, pentatonic notes, one soft pad at most. No audio files.
- Each lantern has its own note; sequences in the memory stage are heard as well as seen.
- Nothing sudden or loud. Master gain is limited and ramps, never jumps.
