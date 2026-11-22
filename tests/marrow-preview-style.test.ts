import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Requirement 22.5: the camera preview is at most 320 CSS px wide, border included. The width attribute sets the
// content width, so the box is only that wide when the border is part of the box (box-sizing: border-box).
const REACT_DIR = fileURLToPath(new URL('../packages/marrow/src/react/', import.meta.url));
const CSS = readFileSync(join(REACT_DIR, 'marrow.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (match?.[1] === undefined) throw new Error(`no rule for ${selector}`);
  return match[1];
}

describe('the camera preview box (Req 22.5)', () => {
  it('counts the border inside the box, so the width attribute is the whole width', () => {
    expect(ruleBody('.marrow-camera-preview')).toMatch(/box-sizing:\s*border-box/);
  });

  it('still shrinks to the space that is available', () => {
    expect(ruleBody('.marrow-camera-preview')).toMatch(/max-width:\s*100%/);
  });
});
