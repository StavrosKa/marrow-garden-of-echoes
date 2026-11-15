---
inclusion: fileMatch
fileMatchPattern: ["apps/**/scene/**", "apps/**/stages/**", "apps/**/journeys/**", "apps/**/ui/**", "packages/world-view/**"]
---

# Art direction, interface theme and ambient motion

> The palette and type below are final as tokens. The themed interface pass and the final art are scheduled after the end-to-end gate (`product.md`). Before that pass, build every scene and screen from flat placeholder shapes using only the grey ramp and `lanternWarm` as the single accent. Take every colour and font from the theme module from the first scene on, so the later pass changes values, not call sites.

## Look

- A haunted night garden that begins dead and almost colourless, and gains colour, light and music as the player succeeds. Haunting and beautiful, never frightening: fog, candlelight, quiet, friendly spirits.
- Two settings that read as one place:
  - **Level 1, Lantern Garden**: open night forest, cool moonlight, deep space, wide parallax.
  - **Level 2, Whisper Hall**: the inside of an old hall in the same forest, warm candlelight, close walls, small parallax, the forest visible through windows and the back door.
  - **Bloom**: the garden behind the hall, where the two palettes meet.
- Procedural silhouettes and a small set of reusable sprites. Seven base colours plus derived brightness steps, defined once in the theme module (see "Palette and type").
- Depth layers, 5-6 per scene. Forest: sky, far hills, far trees, main scene with the interaction layer, foreground foliage, fog. Hall: back wall with windows, mid furniture and columns, main scene with the interaction layer, foreground arch or drapes, dust and candle haze.
- Targets (lanterns, spirits, echo objects) are separate sprites placed into runtime slots. Scene art never fixes a target to one position, and never draws a foreground object across a slot.
- External assets only with a verified CC0 licence, or SIL OFL 1.1 for the two fonts named below, logged in `docs/licenses.md` with source URL and date. The mockups are visual reference only: they are never shipped, traced or committed, and no character, creature or building from an existing game, film or illustration is reproduced.

## The interface is part of the costume

Follow the "Category fit" table in `product.md`. In particular:

- The pointer is a will-o'-the-wisp: a small soft light with a short trail (no trail in Reduced motion).
- Dwell progress is the wisp's light flowing into the target as a ring of flame around it. It must stay readable as a progress ring at a glance.
- Home, setup, calibration, pause, tracking-lost and settings are candle-lit panels over the live, dimmed scene, sharing one set of theme tokens (colours, radii, shadows, spacing, type). No default browser styling anywhere.
- State changes are shown by light, not by pop-ups: pausing dims the world, tracking loss dims it and holds it still, success lets light and colour spread.
- Level titles ("Lantern Garden", "Whisper Hall") fade in over the scene for about 3 s and fade out. They are never a menu.
- Usability limits from `accessibility-and-copy.md` always win over atmosphere.

## Palette and type

Set from the approved mockups on 2026-11-16. Token names are the names used in the theme module.

**Base colours**

| Token | Hex | Role |
|---|---|---|
| `night` | `#0B1030` | Sky, deep shadow, panel background. Steps: `night2` `#142257`, `night3` `#1F4B8A`, `moon` `#2A86C8` (moonlight, fog highlights) |
| `foliage` | `#3F7A55` | Leaves, moss, grass. Shadow `#1D3A32`, lit `#7FB069` |
| `lanternWarm` | `#F0A840` | Lanterns, candles, the wisp's halo, the dwell ring, primary buttons. Glow `#FFE2A0`, ember `#C27A2C` |
| `spiritBlue` | `#4FC3F0` | The blue spirit (always with a drop), cool magic light |
| `spiritGold` | `#F7D774` | The gold spirit (always with a leaf). Paler and yellower than `lanternWarm` |
| `echoViolet` | `#B48CF2` | Echo objects, glowing blossoms, the garden's magic |
| `bloomPink` | `#EE98C4` | Flowers in Bloom and in revealed patches only |

Neutral for text and light cores: `bone` `#F3EBDD`; secondary text `boneMuted` `#B9B4C7`.

**Grey ramp (the uncoloured world).** Blue-tinted, never pure grey: `#0A0C14`, `#12151F`, `#1D2130`, `#2E3344`, `#474D61`, `#6B7186`, `#9AA0B2`, `#C9CDD8`. The dead world uses only this ramp plus a faint `night2` wash; the only warm light in it is the wisp. Each reveal adds base colours; by Bloom all seven are on screen.

**Hall warm variant.** Wall shadow `#1A120C`, wood `#3D2B14`, lit wood `#6B4423`, plaster in candlelight `#8A5A38`, drapes `#4A1830`. Candles use `lanternWarm`. Windows and the back door show the forest in `night3` and `moon`, so the cool palette stays visible inside.

**Interface tokens**

- Panels: `night` at 0.9 opacity or more over the dimmed scene, 1 px border of `lanternWarm` at 35%, radius 16 px, soft outer glow in `lanternWarm` at low alpha. Text `bone`, secondary text `boneMuted`.
- Primary button: `lanternWarm` fill with `night` text. Secondary button: `night2` fill, `bone` text, `lanternWarm` border. Focus ring: 3 px `#FFE2A0` outside a 2 px `night` gap; never removed.
- The in-world instruction line and level titles sit on a soft band of `night` at 0.8 opacity or more, never directly on the scene.
- The wisp: `bone` core, `lanternWarm` halo, thin `night` outline so it stays visible over bright Bloom colours. The dwell ring runs from `lanternWarm` to its glow over a track of `bone` at 25%.
- Measured contrast (WCAG ratio, solid colours): `bone` on `night` 15.7, on `night2` 12.7, on hall wall 15.6; `boneMuted` on `night` 9.2; `night` on `lanternWarm` 9.2; `bone` on the 0.8 band over white 8.6. Canvas content is not covered by these numbers.
- Shared components in `marrow/react` hold no palette values. They read colours, fonts, radii and spacing from CSS custom properties named `--marrow-*`, with neutral grey defaults; the app sets them from its theme module.

**Type**

- Titles (game title, level titles, panel headings): Cormorant Garamond, weight 600, generous letter spacing. Fallback `Georgia, 'Times New Roman', serif`.
- Everything else (instructions, buttons, settings, labels): Atkinson Hyperlegible, 400 and 700. Fallback `'Segoe UI', system-ui, sans-serif`. Minimum 16 px, buttons 18 px, in-world instruction 28 px or more.
- Both fonts are self-hosted as woff2 (Latin subset), never loaded from a CDN. Before adding the files, confirm each font's SIL OFL 1.1 licence from its official source and log it in `docs/licenses.md`. If a licence cannot be confirmed, use the fallback stack and say so.

**Shapes and composition**

- Storybook silhouettes with rounded forms: twisted trunks, round mushroom caps, stepping stones.
- Forest composition: a stone path runs from bottom centre to a vanishing point a little above centre. Large trunks frame both edges in the foreground layer. Lanterns flank the path and shrink with depth; each lit lantern throws a warm pool on the ground. Slots sit in the middle band, clear of the framing trunks.
- Lanterns: pointed roof, four panes, on a short post or hanging from a branch.
- Spirits: an original design, a soft round body of light with two dot eyes and its symbol.
- Echo objects: glass orbs with a slow inner swirl in `echoViolet`.
- The hall from outside (journey B): a moss-roofed stone hall with warm windows among the trees.
- Light: soft additive radial glows, cool rim light from the moon, warm pools from lanterns and candles, fog in the `night` steps.

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
