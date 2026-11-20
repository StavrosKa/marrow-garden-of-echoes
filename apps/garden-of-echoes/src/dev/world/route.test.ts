// The world route (Req 11.1, 15.4): only ?playground=world selects the playground, and main.tsx loads
// the playground module only behind that check.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isWorldRoute } from './route';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.join(HERE, '..', '..', 'main.tsx');
const GUARD = 'if (isWorldRoute(';
const DYNAMIC = "import('./dev/world/WorldPlayground')";

describe('world route', () => {
  it('isWorldRoute is true only for playground=world', () => {
    expect(isWorldRoute('?playground=world')).toBe(true);
    expect(isWorldRoute('?playground=1')).toBe(false);
    expect(isWorldRoute('?playground=worlds')).toBe(false);
    expect(isWorldRoute('')).toBe(false);
  });

  it('main.tsx loads the playground only through a dynamic import behind the route check', () => {
    const source = readFileSync(MAIN, 'utf8');
    expect(source.split(DYNAMIC).length - 1).toBe(1);
    expect(source).not.toMatch(/^import .*WorldPlayground/m);
    const guard = source.indexOf(GUARD);
    expect(guard).toBeGreaterThan(-1);
    expect(source.indexOf(DYNAMIC)).toBeGreaterThan(guard);
  });
});
