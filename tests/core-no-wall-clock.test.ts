// core_no_wall_clock (Req 16.8): no non-test file under packages/marrow/src/core
// reads the time or schedules a callback; the core gets time only as clock deltas
// from its caller. The files are parsed with the TypeScript parser, so a name in a
// comment or a string does not count.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreDirs = [
  path.join(repoRoot, 'packages', 'marrow', 'src', 'core'),
  path.join(repoRoot, 'packages', 'world-view', 'src', 'core'),
];

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
// Found wherever the name appears: setTimeout(...), window.setTimeout, and so on.
const SCHEDULERS = new Set(['setTimeout', 'setInterval', 'requestAnimationFrame']);
// Found through their `now`: Date.now, performance.now, globalThis.performance.now.
const CLOCKS = new Set(['Date', 'performance']);

const rel = (file: string): string => path.relative(repoRoot, file).split(path.sep).join('/');

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [full] : [];
  });
}

/** The clock an expression ends in: `Date` for `Date` or `globalThis.Date`, else undefined. */
function clockName(expression: ts.Expression): string | undefined {
  const name = ts.isIdentifier(expression)
    ? expression.text
    : ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : undefined;
  return name !== undefined && CLOCKS.has(name) ? name : undefined;
}

/** Every use of a clock or a scheduler in the source text, as "<line>: <name>". */
function findWallClockUses(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const uses: string[] = [];
  const add = (node: ts.Node, name: string): void => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    uses.push(`${line + 1}: ${name}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && SCHEDULERS.has(node.text)) {
      add(node, node.text);
    } else if (ts.isPropertyAccessExpression(node) && node.name.text === 'now') {
      const clock = clockName(node.expression);
      if (clock !== undefined) add(node, `${clock}.now`);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'now'
    ) {
      const clock = clockName(node.expression);
      if (clock !== undefined) add(node, `${clock}.now`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return uses;
}

it('core_no_wall_clock', () => {
  const files = coreDirs.flatMap(listFiles);
  // The scan reaches the core, so a wrong path cannot pass by finding nothing.
  expect(files.map(rel)).toContain('packages/marrow/src/core/clocks.ts');
  const uses = files.flatMap((file) =>
    findWallClockUses(file, fs.readFileSync(file, 'utf8')).map((use) => `${rel(file)}:${use}`),
  );
  expect(uses).toEqual([]);
});

it('the wall-clock scan finds all five names and skips comments and strings', () => {
  const sample = [
    '// Date.now() and setTimeout in a comment do not count.',
    "const text = 'performance.now() in a string does not count';",
    'const a = Date.now();',
    'const b = globalThis.performance.now();',
    'setTimeout(() => a, 0);',
    'window.setInterval(() => b, 0);',
    'requestAnimationFrame(() => text);',
  ].join('\n');
  expect(findWallClockUses('sample.ts', sample)).toEqual([
    '3: Date.now',
    '4: performance.now',
    '5: setTimeout',
    '6: setInterval',
    '7: requestAnimationFrame',
  ]);
});
