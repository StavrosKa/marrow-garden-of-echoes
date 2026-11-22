import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TUNING } from 'marrow/core';

// Requirements 24.2, 24.3 and 24.4: the stylesheet holds the --marrow-* defaults, the minimum sizes,
// a focus ring that nothing removes, and no colour outside the custom-property defaults. The tests
// read the stylesheet and the component sources as text, so they run under Node.

const REACT_DIR = fileURLToPath(new URL('../packages/marrow/src/react/', import.meta.url));
const CSS = readFileSync(join(REACT_DIR, 'marrow.css'), 'utf8');

/** The CSS with its comments removed. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const STYLE = withoutComments(CSS);
const ROOT_BLOCK = /:root\s*\{([^}]*)\}/.exec(STYLE)?.[1] ?? '';
const RULES = STYLE.replace(/:root\s*\{[^}]*\}/, '');

// Every custom property design section 8 names.
const DESIGN_PROPERTIES = [
  '--marrow-color-bg',
  '--marrow-color-surface',
  '--marrow-color-surface-2',
  '--marrow-color-border',
  '--marrow-color-text',
  '--marrow-color-text-muted',
  '--marrow-color-accent',
  '--marrow-color-accent-text',
  '--marrow-color-focus',
  '--marrow-color-aura',
  '--marrow-color-progress',
  '--marrow-color-progress-track',
  '--marrow-color-scrim',
  '--marrow-font-title',
  '--marrow-font-ui',
  '--marrow-font-size-ui',
  '--marrow-font-size-button',
  '--marrow-font-size-instruction',
  '--marrow-radius-panel',
  '--marrow-radius-control',
  '--marrow-space-xs',
  '--marrow-space-sm',
  '--marrow-space-md',
  '--marrow-space-lg',
  '--marrow-space-xl',
];

// A colour in CSS or in a component source: a hex code, a functional colour or a basic colour name.
const COLOUR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:white|black|gray|grey|red|green|blue|yellow|orange|purple|silver|navy|teal|maroon|olive|lime|aqua|fuchsia|pink|brown)\b/i;

function pxOf(name: string): number {
  const match = new RegExp(`${name}:\\s*(\\d+)px`).exec(ROOT_BLOCK);
  if (match?.[1] === undefined) throw new Error(`${name} has no px default in :root`);
  return Number(match[1]);
}

describe('the --marrow-* defaults (design section 8)', () => {
  it('declare every custom property the design names, each once, in :root', () => {
    for (const name of DESIGN_PROPERTIES) {
      const declarations = ROOT_BLOCK.split(';').filter((d) => d.trim().startsWith(`${name}:`));
      expect(declarations, `${name} in :root`).toHaveLength(1);
    }
  });

  it('use no name outside the design list', () => {
    const declared = [...ROOT_BLOCK.matchAll(/(--marrow-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...DESIGN_PROPERTIES].sort());
  });
});

describe('minimum text sizes (Req 24.3)', () => {
  it('defaults the UI text to at least the tuned minimum', () => {
    expect(pxOf('--marrow-font-size-ui')).toBeGreaterThanOrEqual(TUNING.uiMinTextPx);
    expect(pxOf('--marrow-font-size-ui')).toBe(TUNING.uiMinTextPx);
  });

  it('defaults the button text to at least the tuned button minimum', () => {
    expect(pxOf('--marrow-font-size-button')).toBeGreaterThanOrEqual(TUNING.uiMinButtonTextPx);
    expect(pxOf('--marrow-font-size-button')).toBe(TUNING.uiMinButtonTextPx);
  });

  it('gives every text size in the rules a custom property, never a fixed number', () => {
    const sizes = [...RULES.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]?.trim() ?? '');
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toMatch(/^var\(--marrow-font-size-[a-z]+\)$/);
  });

  it('gives the button rule the button text size', () => {
    const button = /\.marrow-button\s*\{([^}]*)\}/.exec(RULES)?.[1] ?? '';
    expect(button).toMatch(/font-size:\s*var\(--marrow-font-size-button\)/);
  });
});

describe('the focus ring (Req 24.2)', () => {
  it('draws a visible outline in the focus colour on keyboard focus', () => {
    const focus = /([^{}]*):focus-visible\s*\{([^}]*)\}/.exec(RULES);
    expect(focus, 'a :focus-visible rule').not.toBeNull();
    expect(focus?.[2]).toMatch(/outline:\s*3px solid var\(--marrow-color-focus\)/);
  });

  it('is never removed: no outline is set to none, zero or a style of none', () => {
    expect(STYLE).not.toMatch(/outline\s*:\s*(none|0)\b/i);
    expect(STYLE).not.toMatch(/outline-style\s*:\s*none/i);
    expect(STYLE).not.toMatch(/outline-width\s*:\s*0/i);
  });
});

describe('no colour outside the custom-property defaults (Req 24.4)', () => {
  it('uses no colour value in the rules, only var() references to the colour properties', () => {
    expect(RULES).not.toMatch(COLOUR);
  });

  it('gives a colour in :root only on a --marrow-color-* line', () => {
    for (const line of ROOT_BLOCK.split(';')) {
      if (!COLOUR.test(line)) continue;
      expect(line.trim().startsWith('--marrow-color-'), `colour outside a colour property: ${line.trim()}`).toBe(true);
    }
  });

  it('holds no colour, style attribute or font stack in any component source', () => {
    const sources = readdirSync(REACT_DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = withoutComments(readFileSync(join(REACT_DIR, file), 'utf8'));
      expect(text, `${file} holds a colour`).not.toMatch(COLOUR);
      expect(text, `${file} sets a style`).not.toMatch(/\bstyle=\{/);
      expect(text, `${file} sets a font`).not.toMatch(/fontFamily|font-family/);
    }
  });
});
/** The custom property a `var(--name)` value names, or a readable failure. */
function varName(value: string | undefined): string {
  const match = /^var\((--[a-z0-9-]+)\)$/.exec(value?.trim() ?? '');
  if (match?.[1] === undefined) throw new Error(`not a plain var() value: ${value ?? 'missing'}`);
  return match[1];
}
/** The value a custom property has in the :root defaults. */
function rootValue(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(ROOT_BLOCK);
  if (match?.[1] === undefined) throw new Error(`${name} has no default in :root`);
  return match[1].trim().toLowerCase();
}
/**
 * The background and text colour a disabled button of one variant ends with, under the cascade:
 * rules of a higher specificity win, and between equal ones the later rule wins.
 */
function disabledButton(variant: 'primary' | 'secondary'): { background: string | undefined; color: string | undefined } {
  const selectors =
    variant === 'primary'
      ? ['.marrow-button', '.marrow-button--primary', '.marrow-button:disabled']
      : ['.marrow-button', '.marrow-button:disabled'];
  const declarations: { order: number; specificity: number; prop: string; value: string }[] = [];
  let order = 0;
  for (const rule of RULES.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = (rule[1] ?? '').trim();
    if (!selectors.includes(selector)) continue;
    const specificity = (selector.match(/\./g)?.length ?? 0) + (selector.match(/:/g)?.length ?? 0);
    for (const declaration of (rule[2] ?? '').split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      declarations.push({
        order: order++,
        specificity,
        prop: declaration.slice(0, colon).trim(),
        value: declaration.slice(colon + 1).trim(),
      });
    }
  }
  declarations.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  const resolved = new Map<string, string>();
  for (const d of declarations) resolved.set(d.prop, d.value);
  return { background: resolved.get('background'), color: resolved.get('color') };
}
describe('a disabled button stays readable (Req 22.4, 24.6)', () => {
  for (const variant of ['primary', 'secondary'] as const) {
    it(`a disabled ${variant} button never uses the same custom property for its text and its fill`, () => {
      const { background, color } = disabledButton(variant);
      expect(varName(background)).not.toBe(varName(color));
    });
    it(`a disabled ${variant} button has text and fill that differ in value at the defaults`, () => {
      const { background, color } = disabledButton(variant);
      expect(rootValue(varName(background))).not.toBe(rootValue(varName(color)));
    });
  }
});
