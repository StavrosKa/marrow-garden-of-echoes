// theme.css against the tokens of theme.ts (Req 24.2, 24.5). The test reads the stylesheet as text, so it runs under Node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { theme, type ThemeToken } from './theme';

const CSS = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** The fixed map from each colour property to the token it takes (design section 8, art-and-motion.md). */
const COLOUR_TOKENS: Record<string, ThemeToken> = {
  '--marrow-color-bg': 'grey0',
  '--marrow-color-surface': 'grey2',
  '--marrow-color-surface-2': 'grey3',
  '--marrow-color-border': 'grey4',
  '--marrow-color-text': 'grey7',
  '--marrow-color-text-muted': 'grey6',
  '--marrow-color-accent': 'lanternWarm',
  '--marrow-color-accent-text': 'grey0',
  '--marrow-color-focus': 'lanternGlow',
  '--marrow-color-aura': 'grey5',
  '--marrow-color-progress': 'lanternWarm',
  '--marrow-color-progress-track': 'grey4',
};

const FONT_STACKS: Record<string, string> = {
  '--marrow-font-title': "Georgia, 'Times New Roman', serif",
  '--marrow-font-ui': "'Segoe UI', system-ui, sans-serif",
};

/** The declarations of the .garden-theme rule, as a map from property to value. */
function declarations(): Map<string, string> {
  const block = /\.garden-theme\s*\{([^}]*)\}/.exec(CSS_NO_COMMENTS)?.[1] ?? '';
  const map = new Map<string, string>();
  for (const line of block.split(';')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    map.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return map;
}

describe('theme.css and the tokens of theme.ts', () => {
  it('takes every colour from its token, value for value', () => {
    const values = declarations();
    for (const [property, token] of Object.entries(COLOUR_TOKENS)) {
      expect(values.get(property), property).toBe(theme[token].toUpperCase());
    }
  });

  it('gives the scrim the grey0 token at 0.6 opacity', () => {
    expect(declarations().get('--marrow-color-scrim')).toBe('rgba(10, 12, 20, 0.6)');
    expect(theme.grey0).toBe('#0A0C14');
  });

  it('gives the fonts the fallback stacks of art-and-motion.md', () => {
    const values = declarations();
    for (const [property, stack] of Object.entries(FONT_STACKS)) {
      expect(values.get(property), property).toBe(stack);
    }
  });

  it('declares no colour property that the tokens do not cover', () => {
    const declared = [...declarations().keys()].filter((name) => name.startsWith('--marrow-color-'));
    expect(declared.sort()).toEqual([...Object.keys(COLOUR_TOKENS), '--marrow-color-scrim'].sort());
  });

  it('sets its values on .garden-theme only, never on :root', () => {
    expect(CSS_NO_COMMENTS).not.toMatch(/:root/);
  });
});

describe('the focus ring (Req 24.2)', () => {
  it('no rule in theme.css removes an outline', () => {
    expect(CSS_NO_COMMENTS).not.toMatch(/outline\s*:\s*(none|0)\b/i);
    expect(CSS_NO_COMMENTS).not.toMatch(/outline-style\s*:\s*none/i);
    expect(CSS_NO_COMMENTS).not.toMatch(/outline-width\s*:\s*0/i);
  });
});
