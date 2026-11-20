// The theme tokens of the app (art-and-motion.md, "Palette and type"; design 11 item 9). Every hex
// value is copied from the line of art-and-motion.md named in its comment. Scene and screen code
// takes its colours from this module, so a later theme pass changes values here and no call site.
// Token names are fixed here; the journal records them.

export const theme = Object.freeze({
  // Grey ramp, darkest to lightest (art-and-motion.md line 51).
  grey0: '#0A0C14',
  grey1: '#12151F',
  grey2: '#1D2130',
  grey3: '#2E3344',
  grey4: '#474D61',
  grey5: '#6B7186',
  grey6: '#9AA0B2',
  grey7: '#C9CDD8',
  // Base colours (art-and-motion.md line 41 for night, line 43 for lanternWarm).
  night: '#0B1030',
  lanternWarm: '#F0A840',
});

export type ThemeToken = keyof typeof theme;

/** The eight steps of the grey ramp, darkest first. */
export const GREY_TOKENS = ['grey0', 'grey1', 'grey2', 'grey3', 'grey4', 'grey5', 'grey6', 'grey7'] as const;

/** The tokens a placeholder shape may use: the grey ramp and the one accent (art-and-motion.md, "Art direction"). */
export const SHAPE_TOKENS = [...GREY_TOKENS, 'lanternWarm'] as const satisfies readonly ThemeToken[];

const HEX_RADIX = 16;
const HEX_PREFIX_LENGTH = 1;

/** A token as the 0xRRGGBB number that the drawing code takes. */
export function colourNumber(token: ThemeToken): number {
  return Number.parseInt(theme[token].slice(HEX_PREFIX_LENGTH), HEX_RADIX);
}
