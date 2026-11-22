// Every text and background pair of the Setup UI and the playground reaches WCAG 4.5:1 (Req 24.6). The values
// are read from theme.css, the stylesheet the app sets, and the pairs follow marrow.css (design section 10.4).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, WCAG_TEXT_MIN_RATIO } from './contrast';

const CSS = readFileSync(new URL('./theme.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The value of a custom property in theme.css, which must be a #RRGGBB colour. */
function colourOf(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(CSS);
  if (match?.[1] === undefined) throw new Error(`${name} is not set in theme.css`);
  const value = match[1].trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(value)) throw new Error(`${name} is not a #RRGGBB colour: ${value}`);
  return value;
}

/** The text and background pairs that the Setup UI and the playground draw, with where each one is used. */
const PAIRS: { label: string; text: string; background: string }[] = [
  { label: 'panel text on the panel fill', text: '--marrow-color-text', background: '--marrow-color-surface' },
  { label: 'muted text on the panel fill (labels, legends)', text: '--marrow-color-text-muted', background: '--marrow-color-surface' },
  { label: 'primary button text on the accent fill', text: '--marrow-color-accent-text', background: '--marrow-color-accent' },
  { label: 'secondary button text on its fill', text: '--marrow-color-text', background: '--marrow-color-surface-2' },
  {
    label: 'disabled button text on the secondary fill (commit 1ebd50d)',
    text: '--marrow-color-text-muted',
    background: '--marrow-color-surface-2',
  },
  { label: 'screen text on the screen background', text: '--marrow-color-text', background: '--marrow-color-bg' },
  { label: 'muted text on the screen background', text: '--marrow-color-text-muted', background: '--marrow-color-bg' },
];

describe('the contrast helper', () => {
  it('gives 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6);
    expect(contrastRatio('#C9CDD8', '#C9CDD8')).toBeCloseTo(1, 6);
  });
});

describe('ui_contrast_pairs (Req 24.6)', () => {
  it('reads every pair from theme.css and reaches the WCAG text minimum', () => {
    expect(WCAG_TEXT_MIN_RATIO).toBe(4.5);
    for (const pair of PAIRS) {
      const ratio = contrastRatio(colourOf(pair.text), colourOf(pair.background));
      expect(ratio, `${pair.label}: ${colourOf(pair.text)} on ${colourOf(pair.background)}`).toBeGreaterThanOrEqual(
        WCAG_TEXT_MIN_RATIO,
      );
    }
  });
});
