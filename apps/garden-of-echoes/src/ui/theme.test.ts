// The theme tokens against art-and-motion.md (design 11 item 9).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { colourNumber, GREY_TOKENS, SHAPE_TOKENS, theme, type ThemeToken } from './theme';

/** The line of art-and-motion.md that gives each token group (1-based, as an editor counts). */
const SOURCE_LINE: Record<ThemeToken, number> = {
  grey0: 51,
  grey1: 51,
  grey2: 51,
  grey3: 51,
  grey4: 51,
  grey5: 51,
  grey6: 51,
  grey7: 51,
  night: 41,
  lanternWarm: 43,
  lanternGlow: 43,
};

/** The focus ring rule of art-and-motion.md: 3 px of the glow outside a 2 px night gap (1-based). */
const FOCUS_RING_LINE = 58;
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** From apps/garden-of-echoes/src/ui to the repository root. */
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');

describe('theme tokens', () => {
  it('theme hex values come from art-and-motion.md', () => {
    const lines = readFileSync(path.join(REPO_ROOT, '.kiro', 'steering', 'art-and-motion.md'), 'utf8').split(/\r?\n/);
    for (const [token, hex] of Object.entries(theme)) {
      const line = lines[SOURCE_LINE[token as ThemeToken] - 1] ?? '';
      expect(line.toUpperCase()).toContain(hex.toUpperCase());
    }
  });

  it('the grey ramp has eight steps, darkest first, and the shapes use only the ramp and lanternWarm', () => {
    expect(GREY_TOKENS).toHaveLength(8);
    expect(SHAPE_TOKENS).toEqual([...GREY_TOKENS, 'lanternWarm']);
    const values = GREY_TOKENS.map((token) => colourNumber(token));
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('the focus ring colour is the glow of art-and-motion.md (line 58)', () => {
    const lines = readFileSync(path.join(REPO_ROOT, '.kiro', 'steering', 'art-and-motion.md'), 'utf8').split(/\r?\n/);
    expect((lines[FOCUS_RING_LINE - 1] ?? '').toUpperCase()).toContain(theme.lanternGlow.toUpperCase());
  });

  it('colourNumber reads the hex value of a token', () => {
    expect(colourNumber('lanternWarm')).toBe(Number.parseInt(theme.lanternWarm.slice(1), 16));
  });
});
