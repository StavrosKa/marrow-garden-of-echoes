// The requirement coverage of world-view (Req 15.7; design 9.5). Each test asserts one group of problems
// found by tests/world-view-coverage.check.ts, so a failure lists every problem of that group at once.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkCoverage, readCoverageInputs, type Group, type Problem } from './world-view-coverage.check';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The eight titles of Req 15.1, exactly as requirements.md writes them. */
const REQUIRED_TITLES = [
  'projection round trip',
  'hit circle equals rendered target position',
  'hit area inside reachable region for all head offsets',
  'lock holds interaction layer, decorative layers move',
  'travel arrives exactly once and never while paused',
  'no layer edge exposed',
  'glide per-frame limits at 7 pose frames per second',
  'travel across motion level changes',
];

const problems: readonly Problem[] = checkCoverage(readCoverageInputs(ROOT, REQUIRED_TITLES));

function messagesOf(...groups: readonly Group[]): string[] {
  return problems.filter((problem) => groups.includes(problem.group)).map((problem) => problem.message);
}

describe('world-view requirement coverage (Req 15.7)', () => {
  it('every criterion id of requirements.md has a coverage row, and every row names a known id (Req 15.7)', () => {
    expect(messagesOf('format', 'missing', 'unknown')).toEqual([]);
  });

  it('every test row names a literal it or test title, or a describe title with an it inside (Req 15.7)', () => {
    expect(messagesOf('test')).toEqual([]);
  });

  it('every manual row names a step of the manual list in tasks.md (Req 15.5)', () => {
    expect(messagesOf('manual')).toEqual([]);
  });

  it('every reason row is a sentence a reviewer can check (Req 15.7)', () => {
    expect(messagesOf('reason')).toEqual([]);
  });

  it('the eight titles of Req 15.1 exist as literal it titles (Req 15.1)', () => {
    expect(messagesOf('titles')).toEqual([]);
  });

  it('docs/licenses.md records pixi.js 8.22.0 (Req 16.2)', () => {
    expect(messagesOf('licences')).toEqual([]);
  });

  it('every seed regression test named in docs/bugs-found.md exists (Req 15.3)', () => {
    expect(messagesOf('bugs')).toEqual([]);
  });

  it('no depth - travel pattern in src/pixi or the app (Req 2.2)', () => {
    expect(messagesOf('scan')).toEqual([]);
  });
});
