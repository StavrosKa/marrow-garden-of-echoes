# Art prompts for Leonardo.ai

Prompts for the 42 art files listed in `.kiro/steering/art-and-motion.md` ("Art files"). Written for Leonardo.ai. Features and limits change, so check them in the app before you start.

Only the coloured file is made. The code derives the grey version at load time (steering, "Uncoloured versions"). There are no `-grey` files.

## How to work

1. **Settings.** Use the same model and the same settings for every file. Write them down in `docs/licenses.md` with the plan, the date and the prompt for each file.
2. **Style anchor.** Make `lantern-lit` first. Keep generating until one is right. From then on, give that image to Leonardo as the style reference for every other file, and paste the Common style block into every prompt.
3. **Transparency.** For sprites and other "transparent" files, turn on Leonardo's transparent background option if your plan has it. If not, remove the background with `rembg` or any background remover. The files marked "opaque" have no transparency.
4. **Size.** Leonardo's largest sizes are smaller than the wide strips. Generate at the widest ratio offered, upscale, then crop or extend to the target size. Sizes may be rescaled in the app, so a close match is fine. Do not leave a visible seam.
5. **Check.** Palette and silhouette matter more than detail. Reject any image with painted glow, text, or a frame.
6. **First gate.** After the first coloured forest file exists, check how the code-derived grey version looks. The shapes must stay readable in grey. If they do not, tell me and we change the mapping before you make the rest.
7. **Delivery.** Put the PNG files, with the exact file names below, in `art/incoming/` at the repo root.

## Common style block

Paste this at the start of every prompt:

> Original storybook illustration of a haunted night garden. Soft rounded silhouettes, gentle painterly shading, flat colour areas with subtle gradients. Calm, friendly and beautiful, never scary. Palette only: deep midnight blue (#0B1030, #142257, #1F4B8A), moon blue (#2A86C8), foliage green (#3F7A55, shadow #1D3A32, lit #7FB069), warm lantern amber (#F0A840, pale #FFE2A0), spirit blue (#4FC3F0), spirit gold (#F7D774), violet (#B48CF2), pink (#EE98C4), bone white (#F3EBDD). No text or letters, no painted glow, halo or light rays, no lens flare. No character, creature or building from any existing game, film, book or illustration.

## Negative prompt

Paste this in the negative prompt field if the model has one:

> text, letters, watermark, logo, signature, glow, halo, light rays, lens flare, photorealistic, 3D render, frame, border, vignette, scary, gore, ghost face, existing characters

## Sprite rules

For files 1 to 6 and 39 to 40: transparent background, one object only, centred, front view, at least 15% empty margin on every side, no ground, no shadow on the ground.

## Order

Make files 1 to 19 first (first glade), then 20 to 30, then the hall (31 to 40), then Bloom (41 to 42).

## Targets (512x512 unless noted, transparent)

1. `lantern-unlit.png`: A small unlit garden lantern: pointed roof, four dark glass panes, a short wooden post. The panes are dark and dull, no light inside.
2. `lantern-lit.png`: The same lantern as `lantern-unlit`, now lit: the four panes are warm amber (#F0A840) with a pale inner colour (#FFE2A0). Same shape and size. Do not paint a glow outside the lantern.
3. `spirit-blue.png`: A friendly spirit: a soft round body of light in spirit blue (#4FC3F0), two small dot eyes, and a clear water-drop symbol on the body. Original design. No arms, no legs, no mouth.
4. `spirit-gold.png`: The same spirit shape as `spirit-blue`, in spirit gold (#F7D774), with a clear leaf symbol on the body instead of the drop. Same size and eyes.
5. `echo-orb.png`: An empty glass orb on no stand, clear glass with a faint cool rim light, a soft highlight on one side, empty inside.
6. `echo-swirl.png`: A violet (#B48CF2) swirl of soft mist, designed to sit inside a glass orb, centred, with no outline and no orb.

## Forest, shared

7. `forest-sky.png` (3840x1440, opaque): A night sky with a calm full moon in moon blue, soft clouds in the three midnight blues, a few small stars. No trees, no ground. Smooth gradient from deep midnight at the top to lighter blue near the bottom.
8. `forest-hills.png` (3840x700, transparent): A long strip of distant rolling hills in dark blue-green tones, soft rounded tops, nothing in the sky above them. The bottom edge is solid and extends to the edge of the image.
9. `forest-fartrees-a.png` (3840x900, transparent): A long strip of distant round-topped trees in dark blue-green, soft and simple, standing on a solid base that runs to the bottom edge. No ground texture.
10. `fog-1.png` (1600x500, transparent): A soft, wide patch of night fog in pale blue tones, very soft edges, nothing sharp.
11. `fog-2.png` (1600x500, transparent): A second fog patch with a different shape from `fog-1`.
12. `foliage-1.png` (1200x800, transparent): Branches with rounded leaves hanging down from the top edge. The branches touch the top edge and run past it. Dark green with a few lit leaves.
13. `foliage-2.png` (1200x800, transparent): A different branch arrangement, same style as `foliage-1`.
14. `foliage-3.png` (1200x800, transparent): A third branch arrangement, same style.
15. `grass-1.png` (800x300, transparent): Tufts of tall grass with soft rounded blades, dark green with a few lit tips. The bottom touches the edge and runs past it.
16. `grass-2.png` (800x300, transparent): A second grass arrangement, different from `grass-1`.

## Lantern Glade

17. `glade1-ground.png` (3840x900, transparent): Forest floor seen straight on, with a stone path that starts wide at the bottom centre and narrows toward a point a little above the centre of the image. Moss, grass and stepping stones along the edges. The middle band beside the path is clear and open. The bottom edge runs to the edge of the image.
18. `glade1-trunk-left.png` (900x2160, transparent): One big twisted tree trunk with round bark knots and a few roots, standing at the left edge and running past the top and bottom edges. The right side is free, with no branches reaching into the middle.
19. `glade1-trunk-right.png` (900x2160, transparent): A different big twisted trunk, for the right edge. The left side is free. Not a mirror image of file 18.

## Whisper Glade

20. `glade2-ground.png` (3840x900, transparent): A different clearing from `glade1-ground`: the same kind of stone path from the bottom centre toward a point above the centre, with different stones, flowers and moss. The middle band is clear.
21. `forest-fartrees-b.png` (3840x900, transparent): A second strip of distant trees, taller and thinner than `forest-fartrees-a`, same palette.
22. `glade2-trunk-left.png` (900x2160, transparent): A twisted trunk for the left edge, a variation on file 18 with a hollow in the bark.
23. `glade2-trunk-right.png` (900x2160, transparent): A twisted trunk for the right edge, a variation on file 19, with a bracket mushroom on the bark.

## Journeys A and B

24. `stones-1.png` (600x400, transparent): A small group of mossy stones to stand beside a path. Soft, rounded, dark with lit tops.
25. `stones-2.png` (600x400, transparent): A second group of stones, different shape.
26. `mushrooms-1.png` (600x400, transparent): A small group of mushrooms with round caps, pink (#EE98C4) and bone white caps, on short stems. No faces.
27. `mushrooms-2.png` (600x400, transparent): A second group of mushrooms, different arrangement, one cap violet (#B48CF2).
28. `hall-exterior.png` (1600x1000, transparent): A moss-roofed old stone hall seen from far away at night, with warm amber windows and a closed wooden door, standing among a few trees. Original design, not any real or fictional building.
29. `hall-door-frame.png` (1000x1400, transparent): A tall arched stone door frame, seen straight on, with an empty opening and no door leaf. Moss on the stones.
30. `hall-door-leaf.png` (1000x1400, transparent): A tall arched wooden door leaf, seen straight on, dark wood with iron bands, sized to fit the opening of `hall-door-frame`.

## Whisper Hall (warm variant: wall shadow #1A120C, wood #3D2B14, lit wood #6B4423, plaster #8A5A38, drapes #4A1830)

31. `hall-wall.png` (3840x1440, opaque): The back wall of an old hall seen straight on: plaster in candlelight, wooden beams, tall windows that show the night forest in blue tones. No furniture, no candles, no door.
32. `hall-columns.png` (600x1800, transparent): A stone column with a simple carved capital, seen straight on, running past the top and bottom edges.
33. `hall-furniture.png` (1200x900, transparent): A few old pieces of furniture standing together: a low table, a chair and a chest. Dark wood. Nothing on top.
34. `hall-arch.png` (3840x1440, transparent): A stone arch in the foreground, framing the image. The centre is fully open (transparent). The arch runs past the left, right and top edges.
35. `hall-drape-left.png` (900x2160, transparent): A heavy drape in deep wine (#4A1830) hanging at the left edge, running past the top edge, soft folds.
36. `hall-drape-right.png` (900x2160, transparent): A drape for the right edge. A different arrangement of folds, not a mirror image.
37. `hall-backdoor-frame.png` (1000x1400, transparent): A tall arched wooden door frame for the back of the hall, an empty opening, warm wood.
38. `hall-backdoor-leaf.png` (1000x1400, transparent): The door leaf that fits `hall-backdoor-frame`, warm wood with iron bands.
39. `candle-unlit.png` (256x512, transparent): A tall cream candle in a small holder, unlit, with a dark wick.
40. `candle-lit.png` (256x512, transparent): The same candle, lit, with a small amber flame (#F0A840 with pale centre #FFE2A0). No painted glow around it.

## Bloom

41. `bloom-backdrop.png` (3840x1440, opaque): The garden behind the hall, at night: a deep midnight sky with a few stars and a calm moon, the back of the old hall far away on one side, trees in both cool and warm tones. No plants in the front, no flowers, no ground.
42. `bloom-ground.png` (3840x900, transparent): Open garden ground with soft grass and moss and a faint stone path, no plants or flowers on it (the code adds them). The bottom edge runs to the edge of the image.

## Licence log

For each file, add to `docs/licenses.md`: file name, tool and model, plan (free or paid), date, the prompt used, and that the image was generated for this project. Leonardo's free plan makes images public and leaves ownership with Leonardo, so read its current terms before publishing the images in the repository under an open licence.
