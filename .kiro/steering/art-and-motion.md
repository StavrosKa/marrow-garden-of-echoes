---
inclusion: fileMatch
fileMatchPattern: ["apps/**/scene/**", "apps/**/stages/**", "apps/**/journeys/**", "apps/**/ui/**", "packages/world-view/**"]
---

# Art direction, interface theme and ambient motion

> Palette, shapes, typography and composition are finalized from the approved mockups. Until the "Palette and type" section below is filled in, build every scene and screen from flat placeholder shapes in neutral greys with one accent colour, and keep all colours and fonts in a single theme module so they can be swapped in one place.

## Look

- A haunted night garden that begins dead and almost colourless, and gains colour, light and music as the player succeeds. Haunting and beautiful, never frightening: fog, candlelight, quiet, friendly spirits.
- Two settings that read as one place:
  - **Level 1, Lantern Garden**: open night forest, cool moonlight, deep space, wide parallax.
  - **Level 2, Whisper Hall**: the inside of an old hall in the same forest, warm candlelight, close walls, small parallax, the forest visible through windows and the back door.
  - **Bloom**: the garden behind the hall, where the two palettes meet.
- Procedural silhouettes and a small set of reusable sprites. Five base colours plus derived brightness steps, defined once in the theme module.
- Depth layers, 5-6 per scene. Forest: sky, far hills, far trees, main scene with the interaction layer, foreground foliage, fog. Hall: back wall with windows, mid furniture and columns, main scene with the interaction layer, foreground arch or drapes, dust and candle haze.
- Targets (lanterns, spirits, echo objects) are separate sprites placed into runtime slots. Scene art never fixes a target to one position, and never draws a foreground object across a slot.
- External assets only with a verified CC0 licence, logged in `docs/licenses.md` with source URL and date. AI-generated mockups are visual reference only and are not shipped as assets.

## The interface is part of the costume

Follow the "Category fit" table in `product.md`. In particular:

- The pointer is a will-o'-the-wisp: a small soft light with a short trail (no trail in Reduced motion).
- Dwell progress is the wisp's light flowing into the target as a ring of flame around it. It must stay readable as a progress ring at a glance.
- Home, setup, calibration, pause, tracking-lost and settings are candle-lit panels over the live, dimmed scene, sharing one set of theme tokens (colours, radii, shadows, spacing, type). No default browser styling anywhere.
- State changes are shown by light, not by pop-ups: pausing dims the world, tracking loss dims it and holds it still, success lets light and colour spread.
- Level titles ("Lantern Garden", "Whisper Hall") fade in over the scene for about 3 s and fade out. They are never a menu.
- Usability limits from `accessibility-and-copy.md` always win over atmosphere.

## Palette and type

_To be filled from the mockups: five base colours with hex values and their roles (night, foliage, lantern warm, spirit blue, spirit gold), the grey ramp for the uncoloured state, the hall's warm variant, the title font and the UI font._

## Colour reveal

- Core: each completed target fades in a coloured patch around itself (pre-coloured region, eased alpha). In the hall, each completed echo lights more candles and warms the room. Progress, once revealed, never goes back.
- Stretch: low-resolution reveal mask between an uncoloured and a coloured render of the same geometry, updated only when progress changes, never redrawn per frame while idle.

## Travel

- Finite, pre-designed segments: journey A (Lantern Glade to Whisper Glade), journey B (Whisper Glade to the hall door), the hall threshold (door opens, the view moves inside), the garden threshold (back door opens, the view moves out to Bloom).
- Shared plants, palette, path direction and lighting make the segments read as one place. The hall is visible in the distance during journey B; the garden is visible through the back door during the Echo challenge.
- The next stage appears gradually from behind trees, fog or an opening door. Fog may soften a join; it must not replace the journey with a fade (except in Reduced motion).
- No level menu between stages.

## Ambient motion budget (upper limits per scene)

| Element | Motion | Limit | Tier |
|---|---|---|---|
| Branch and leaf groups | Slow periodic rotation with different phases | 12 groups | Core |
| Grass | Small sway near the ground | 4 foreground groups | Core |
| Fog | Slow drift of translucent patches | 2 sets of patches, inside the single fog layer | Core |
| Lanterns and candles | Brightness variation of at most 15%, cycles of 1.5 s or longer | Visible ones only | Core |
| Hall drapes or cobwebs | Very slow sway | 4 groups | Core |
| Fireflies | Slow curves around lit points | 16 | Core, added after the end-to-end gate |
| Falling leaves | Slow fall with slight rotation | 8 at once | Core, added after the end-to-end gate |
| Dust and candle motes in the hall | Slow drift in light shafts | 16 | Core, added after the end-to-end gate |

- One shared animation clock driven by the session clock, different rates and phases per group. No physics engine, no per-leaf animation.
- Pause, hidden tab and tracking hold freeze ambient motion along with everything else.

## Audio

- Web Audio oscillators with short envelopes, pentatonic notes, one soft pad at most. No audio files.
- Each lantern and each echo object has its own note; sequences in the Echo challenge are heard as well as seen. The hall adds a longer, softer tail to notes so it sounds like a large room.
- Nothing sudden or loud. Master gain is limited and ramps, never jumps.
