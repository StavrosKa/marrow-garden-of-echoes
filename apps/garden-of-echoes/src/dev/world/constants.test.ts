// The app constants: the cover colour comes from the theme module (design 8.3, Req 13.5).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { colourNumber, theme } from '../../ui/theme';
import { COVER_COLOUR, COVER_COLOUR_TOKEN, REWARD_DELAY_MS } from './constants';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('app constants', () => {
  it('the cover colour is the darkest grey, taken from theme.ts', () => {
    expect(COVER_COLOUR_TOKEN).toBe('grey0');
    expect(theme.grey0).toBe('#0A0C14');
    expect(COVER_COLOUR).toBe(colourNumber(COVER_COLOUR_TOKEN));
    const source = readFileSync(path.join(HERE, 'constants.ts'), 'utf8');
    expect(source).toContain("from '../../ui/theme'");
    expect(source).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });

  it('the reward delay is the Appendix B value', () => {
    expect(REWARD_DELAY_MS).toBe(1500);
  });
});
