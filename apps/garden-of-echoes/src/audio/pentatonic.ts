// The lantern notes (garden-level design 2.10; requirements 4.2, 18.1; art-and-motion.md "Audio"). One note per lantern,
// from the C major pentatonic scale (C, D, E, G, A). The frequency comes from equal temperament with A4 at 440 Hz. No
// audio file is used: the note is an oscillator at this frequency.
export const LANTERN_NOTES = ['C4', 'D4', 'E4', 'G4'] as const;

export type LanternNote = (typeof LANTERN_NOTES)[number];

/** The concert pitch of A4 in hertz. The standard reference of equal temperament. */
export const A4_HZ = 440;

/** The pitch class of each letter of the pentatonic scale, in semitones above C. */
const SEMITONES_ABOVE_C: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, G: 7, A: 9 };

/** A4 is MIDI note 69. The octave of a note name is its second character, as in "C4". */
const MIDI_OF_A4 = 69;
const SEMITONES_PER_OCTAVE = 12;
const MIDI_OF_C0 = 12;

/** The frequency in hertz of a note name such as C4, in equal temperament. */
export function noteHz(name: LanternNote): number {
  const letter = name.charAt(0);
  const octave = Number(name.charAt(1));
  const semitones = SEMITONES_ABOVE_C[letter] ?? 0;
  const midi = MIDI_OF_C0 + octave * SEMITONES_PER_OCTAVE + semitones;
  return A4_HZ * 2 ** ((midi - MIDI_OF_A4) / SEMITONES_PER_OCTAVE);
}
