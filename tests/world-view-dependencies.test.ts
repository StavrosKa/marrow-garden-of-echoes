// world-view depends on pixi.js only (Req 16.1, 16.7; design 10). The manifests and the lockfile
// are read as text, so a new dependency in any package fails here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The dependency sections of a package manifest. */
const SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

interface Manifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

function readManifest(relative: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8')) as Manifest;
}

/** Every manifest of the repository: the root, the packages and the app. */
const MANIFESTS = [
  'package.json',
  'packages/marrow/package.json',
  'packages/world-view/package.json',
  'apps/garden-of-echoes/package.json',
];

/** Every dependency name listed in any section of a manifest. */
function listedNames(manifest: Manifest): string[] {
  return SECTIONS.flatMap((section) => Object.keys(manifest[section] ?? {}));
}

describe('world-view depends on pixi.js only', () => {
  it('world-view depends on pixi.js only', () => {
    const worldView = readManifest('packages/world-view/package.json');
    expect(worldView.dependencies).toEqual({ 'pixi.js': '8.22.0' });
    for (const section of SECTIONS.slice(1)) {
      expect(worldView[section] ?? {}, `packages/world-view/package.json ${section}`).toEqual({});
    }
  });

  it('no other workspace lists pixi.js or an @pixi package', () => {
    const others = MANIFESTS.filter((file) => file !== 'packages/world-view/package.json');
    for (const file of others) {
      const names = listedNames(readManifest(file));
      expect(names.filter((name) => name === 'pixi.js' || name.startsWith('@pixi/')), file).toEqual([]);
    }
  });

  it('the lockfile pins pixi.js at 8.22.0', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
    };
    expect(lock.packages['node_modules/pixi.js']?.version).toBe('8.22.0');
    expect(lock.packages['packages/world-view']?.dependencies).toEqual({ 'pixi.js': '8.22.0' });
  });
});
