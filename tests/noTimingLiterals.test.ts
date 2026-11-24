import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// no_timing_literals (requirement 6.10): the attention logic and the resting band read every number from the
// tuning module. Only 0 and 1 may appear as numeric literals in these files. The files are parsed with the
// TypeScript parser, so a number in a comment or a string does not count. It lives in tests/ because it reads
// source files, and packages/marrow is type-checked without Node types (as in tests/tuning-labels.test.ts).
// placementBand.ts arrives in task 5; a file that does not exist yet is skipped, as in
// tests/garden-tuning-labels.test.ts.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const challengesDir = path.join(repoRoot, 'packages', 'marrow', 'src', 'challenges');
const SCANNED = ['attention.ts', 'placementBand.ts'].map((name) => path.join(challengesDir, name));
const ALLOWED = new Set<number>([0, 1]);

interface Literal {
  readonly line: number;
  readonly text: string;
}

/** Every numeric literal in the source that is not 0 or 1, with its line. */
function literalsOutside01(fileName: string, text: string): Literal[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: Literal[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNumericLiteral(node) && !ALLOWED.has(Number(node.text))) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      found.push({ line, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('timing literals (challenges)', () => {
  it('no_timing_literals: attention.ts and placementBand.ts use no number other than 0 and 1', () => {
    const scanned = SCANNED.filter((file) => fs.existsSync(file));
    // The scan reaches attention.ts, so a wrong path cannot pass by finding nothing.
    expect(scanned.map((file) => path.basename(file))).toContain('attention.ts');
    const found = scanned.flatMap((file) =>
      literalsOutside01(file, fs.readFileSync(file, 'utf8')).map((l) => `${path.basename(file)}:${l.line}: ${l.text}`),
    );
    expect(found).toEqual([]);
  });

  // Fixture test: without it, a scanner that finds nothing would pass the test above.
  it('the literal check finds a number other than 0 and 1, and skips comments and strings', () => {
    const sample = [
      '// 2500 in a comment does not count',
      "const label = 'dwell 1500 in a string does not count';",
      'const ok = [0, 1];',
      'const minMs = 2500;',
      'const hex = 0x10;',
    ].join('\n');
    expect(literalsOutside01('sample.ts', sample)).toEqual([
      { line: 4, text: '2500' },
      { line: 5, text: '16' },
    ]);
  });
});
