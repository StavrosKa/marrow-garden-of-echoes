// The setup stylesheet (requirements 24.1, 24.3). The test reads the file as text, so it runs under Node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(new URL('./setup.css', import.meta.url), 'utf8');

describe('setup stylesheet (requirements 24.1, 24.3)', () => {
  it('24.1: the buttons show a focus ring in the focus colour of the theme', () => {
    expect(CSS).toMatch(/\.garden-button:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--marrow-color-focus\)/);
  });

  it('24.3: the button text is at least 16 px', () => {
    const button = /\.garden-button\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(button).toMatch(/font-size:\s*1rem/);
  });
});
