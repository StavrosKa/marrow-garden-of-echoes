---
inclusion: fileMatch
fileMatchPattern: ["apps/**", "packages/marrow/src/react/**"]
---

# Accessibility and wording

## Interaction

- Every menu, overlay and settings control is a real DOM element (button, radio, slider) layered over the canvas, reachable by mouse, touch and keyboard, with a visible focus ring and an accessible name. Nothing essential exists only inside the canvas.
- The haunting theme never costs usability. Themed controls stay real controls: styling does not remove focus rings, accessible names, hit size or contrast, and decorative fonts are used for titles only, never for instructions or buttons.
- `Escape` opens Pause from anywhere after Home. `Enter` or `Space` activates the focused control. Bloom's Stop/Finish works by large button and by keyboard.
- The current instruction is also exposed in an `aria-live="polite"` region.
- Colour is never the only signal. Spirits and symbols always pair colour with shape (blue + drop, gold + leaf). Every sound cue has a visual equivalent, and the game is fully playable muted.
- No flashing or strobing. Light changes are eased over at least 300 ms. Candle and lantern flicker: brightness varies by at most 15% either way, with cycles of 1.5 s or longer; steady light in Reduced motion.
- UI text and controls meet WCAG AA contrast against their actual background. Minimum UI text size 16 px; in-world instructions larger.
- Honour the motion setting everywhere (see `interaction-invariants.md` section 8). New motion effects must define their Gentle and Reduced behaviour when they are added.
- Audio starts only after an explicit user action. Mute is always one click away.

## Camera and privacy wording

- Ask for the camera only after the player presses Start, with one sentence explaining why: the camera is used to follow your hands and head, video stays on this device and is never recorded or sent anywhere.
- Camera denied, camera missing and model failed to load each get a calm message with two actions: Retry and Try without camera.
- Simulated-input mode shows a persistent small label: "Simulated input".
- The camera preview during setup is small and mirrored. During play there is no camera preview.

## Wording

- All player-facing text is English and lives in the app's `copy/` folder. Shared components in `marrow/react` receive their text through the typed `MarrowCopy` object, which the app fills from `copy/`.
- One instruction at a time, at most about eight words, present tense, calm: "Hold your light on the lantern."
- Never use: fail, failed, wrong, incorrect, error (to the player), lose, lost (about the player), score, points, time's up, hurry, patient, therapy, rehab, exercise, diagnosis, tremor.
- The banned list applies to player-facing text only. Code, tests and developer docs may use words such as "error" in their technical sense. Docs may state what the project is not ("This is not a medical or therapy tool"); what is banned everywhere is claiming such a benefit.
- After a mistake, describe what to do next, not what went wrong: "Let's watch the lights again."
- Help is offered, not imposed in words: "Want a hint?" / "Continue with help".
- Tracking loss: "Step back into view" with a simple picture, not a technical message.
- Storage unavailable or full: "Your garden couldn't be saved on this browser. It stays here until you leave."
- Save confirmation appears only after the write has succeeded and been read back.
- Reset garden asks for confirmation once, in plain words.

## Limits of what we claim

Automated checks cover contrast of DOM text and the banned-word list in `copy/` folders. They do not certify canvas content or overall accessibility; do not write that they do.
