// The input playground route (Req 26.1, 26.2): only ?playground=1 selects it, and main.tsx loads the
// playground module only behind that check, after the world check that stays first.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPlaygroundRoute } from './playgroundRoute';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.join(HERE, '..', 'main.tsx');
const WORLD_GUARD = 'if (isWorldRoute(';
const PLAYGROUND_GUARD = 'else if (isPlaygroundRoute(';
const PLAYGROUND_IMPORT = "import('./dev/playground')";

describe('playground route', () => {
  it('isPlaygroundRoute is true only for playground=1', () => {
    expect(isPlaygroundRoute('?playground=1')).toBe(true);
    expect(isPlaygroundRoute('?playground=world')).toBe(false);
    expect(isPlaygroundRoute('?playground=10')).toBe(false);
    expect(isPlaygroundRoute('?playground=1x')).toBe(false);
    expect(isPlaygroundRoute('')).toBe(false);
  });

  it('main.tsx checks the world route first, then loads the playground behind its own guard', () => {
    const source = readFileSync(MAIN, 'utf8');
    const world = source.indexOf(WORLD_GUARD);
    const guard = source.indexOf(PLAYGROUND_GUARD);
    const load = source.indexOf(PLAYGROUND_IMPORT);
    expect(world).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(world);
    expect(load).toBeGreaterThan(guard);
    expect(source.split(PLAYGROUND_IMPORT).length - 1).toBe(1);
  });
});
