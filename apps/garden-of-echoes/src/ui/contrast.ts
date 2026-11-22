// The WCAG contrast ratio of two solid colours (WCAG 2.x relative luminance). Used by the tests only.
// The text threshold is a WCAG rule (1.4.3), not a tuning value, so it is named here.

/** The least contrast ratio of text against its background (WCAG 1.4.3, level AA). */
export const WCAG_TEXT_MIN_RATIO = 4.5;

const HEX_LENGTH = 7;
const HEX_RADIX = 16;
const CHANNEL_SCALE = 255;
const LINEAR_CUTOFF = 0.03928;
const LINEAR_DIVISOR = 12.92;
const GAMMA_OFFSET = 0.055;
const GAMMA_SCALE = 1.055;
const GAMMA = 2.4;
const RED_WEIGHT = 0.2126;
const GREEN_WEIGHT = 0.7152;
const BLUE_WEIGHT = 0.0722;
const CONTRAST_OFFSET = 0.05;
const CHANNEL_SHIFTS = [1, 3, 5] as const;

/** The relative luminance of a colour written as #RRGGBB. */
export function relativeLuminance(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex) || hex.length !== HEX_LENGTH) {
    throw new Error(`not a #RRGGBB colour: ${hex}`);
  }
  const [red, green, blue] = CHANNEL_SHIFTS.map((shift) => {
    const channel = Number.parseInt(hex.slice(shift, shift + 2), HEX_RADIX) / CHANNEL_SCALE;
    return channel <= LINEAR_CUTOFF ? channel / LINEAR_DIVISOR : ((channel + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA;
  }) as [number, number, number];
  return RED_WEIGHT * red + GREEN_WEIGHT * green + BLUE_WEIGHT * blue;
}

/** The contrast ratio of two #RRGGBB colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + CONTRAST_OFFSET) / (Math.min(x, y) + CONTRAST_OFFSET);
}
