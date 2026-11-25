// no_image_files_added (garden-level requirement 22.1): this spec creates no PNG, SVG, JPG or WebP file under
// apps/garden-of-echoes. The allowlist is the image files already tracked at the commit where the spec's placeholder art
// began (9243e22), read with git ls-tree. Any other image file under the app, tracked or not yet ignored by git, fails
// with its path.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_COMMIT = '9243e22';
const APP_DIR = 'apps/garden-of-echoes';
/** The image types the spec forbids. JPEG is the same format as JPG, so it is covered too. */
const IMAGE_FILE = /\.(png|svg|jpe?g|webp)$/i;

/** The lines a git command prints, run without a shell, from the repository root. */
function gitLines(args: readonly string[]): string[] {
  return execFileSync('git', [...args], { cwd: repoRoot, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((line) => line !== '');
}

/**
 * Throws a readable error when the base commit is not in this checkout. A shallow clone (the CI checkout's default) lacks
 * older commits, so the raw git error would not say what to do.
 */
function assertCommitPresent(commit: string): void {
  const probe = spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: repoRoot });
  if (probe.status !== 0) {
    throw new Error(`${commit} is not in this checkout; fetch full history (git fetch --unshallow, or fetch-depth: 0 in CI)`);
  }
}

/** The image files under the app that a commit tracks. */
function imagesAt(commit: string): string[] {
  assertCommitPresent(commit);
  return gitLines(['ls-tree', '-r', '--name-only', commit, '--', APP_DIR]).filter((file) => IMAGE_FILE.test(file));
}

/** The image files under the app in the index and in the working tree (tracked, or new and not ignored). */
function imagesNow(): string[] {
  const files = gitLines(['ls-files', '--cached', '--others', '--exclude-standard', '--', APP_DIR]);
  return [...new Set(files)].filter((file) => IMAGE_FILE.test(file));
}

describe('no image files added by garden-level (requirement 22.1)', () => {
  it('no PNG, SVG, JPG or WebP file under apps/garden-of-echoes beyond the ones tracked at 9243e22', () => {
    const allowed = new Set(imagesAt(BASE_COMMIT));
    const added = imagesNow().filter((file) => !allowed.has(file));
    expect(added, `image files added under ${APP_DIR} since ${BASE_COMMIT}`).toEqual([]);
  });

  it('the file types it forbids are PNG, SVG, JPG, JPEG and WebP, in any letter case', () => {
    for (const file of ['a.png', 'b.SVG', 'c.jpg', 'd.jpeg', 'e.WebP', 'nested/f.Png']) {
      expect(IMAGE_FILE.test(file), file).toBe(true);
    }
    for (const file of ['g.ts', 'h.json', 'i.pngx', 'j.gif', 'k.png.txt']) {
      expect(IMAGE_FILE.test(file), file).toBe(false);
    }
  });
});
