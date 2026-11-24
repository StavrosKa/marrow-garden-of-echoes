import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// help_levels_at_placement (Requirement 12.1): the app reads the motor level and the cognitive level only
// where a round is placed. The only file that reads them is session/roundSnapshot.ts, and its test may
// read them too. The scan parses every .ts and .tsx file of the app with the TypeScript parser, as
// noTimingLiterals.test.ts does. So a comment or a string never counts, and the match is on the syntax.
//
// What counts as a read: a property access (x.motorLevel), an element access with a string literal
// (x['motorLevel']), and a destructuring element (const { motorLevel } = x, or with a rename). Writes
// through a property access are counted too, because the app writes no level.
// What does not count: comments; string literals that are not element keys; type positions (HelpState
// mentions, property signatures such as `readonly motorLevel: number`, indexed types such as
// HelpState['motorLevel']); object-literal properties such as the fixture { motorLevel: 1 }.
// A read through a computed key that is not a literal (help[key]) is not found. The scan matches names,
// so a field with the same name on another type (RoundSnapshot.motorLevel) is also found outside the
// allowed files. Consumers therefore read snapshot.radius only.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = path.join(repoRoot, 'apps', 'garden-of-echoes', 'src');
const LEVELS: ReadonlySet<string> = new Set(['motorLevel', 'cognitiveLevel']);
const ALLOWED: ReadonlySet<string> = new Set(
  ['session/roundSnapshot.ts', 'session/roundSnapshot.test.ts'].map((rel) => path.join(appSrc, ...rel.split('/'))),
);

interface Read {
  readonly line: number;
  readonly name: string;
}

/** The reads of a level in the source: each with its line and the name of the level. */
function levelReads(fileName: string, text: string): Read[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const found: Read[] = [];
  const flag = (node: ts.Node, name: string): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    found.push({ line, name });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && LEVELS.has(node.name.text)) {
      flag(node.name, node.name.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      LEVELS.has(node.argumentExpression.text)
    ) {
      flag(node.argumentExpression, node.argumentExpression.text);
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if ((ts.isIdentifier(key) || ts.isStringLiteral(key)) && LEVELS.has(key.text)) flag(key, key.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every .ts and .tsx file under a directory, recursively, in a stable order. */
function sourcesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourcesUnder(full));
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

const rel = (file: string): string => path.relative(repoRoot, file).split(path.sep).join('/');

describe('help levels are read only at placement', () => {
  it('help_levels_at_placement: the app reads motorLevel and cognitiveLevel only in roundSnapshot.ts and its test', () => {
    const offending = sourcesUnder(appSrc)
      .filter((file) => !ALLOWED.has(file))
      .flatMap((file) =>
        levelReads(file, fs.readFileSync(file, 'utf8')).map((read) => `${rel(file)}:${read.line}: ${read.name}`),
      );
    expect(offending).toEqual([]);
  });

  it('the scan reaches roundSnapshot.ts and finds its read of both levels', () => {
    const snapshot = path.join(appSrc, 'session', 'roundSnapshot.ts');
    expect(sourcesUnder(appSrc)).toContain(snapshot);
    const names = levelReads(snapshot, fs.readFileSync(snapshot, 'utf8')).map((read) => read.name);
    expect(names).toEqual(['motorLevel', 'cognitiveLevel']);
  });

  it('finds property access, element access and destructuring reads', () => {
    const sample = [
      'const a = help.motorLevel;', // line 1: property access
      "const b = help['cognitiveLevel'];", // line 2: element access
      'const { motorLevel } = help;', // line 3: destructuring
      'const { cognitiveLevel: c } = help;', // line 4: destructuring with a rename
    ].join('\n');
    expect(levelReads('sample.ts', sample)).toEqual([
      { line: 1, name: 'motorLevel' },
      { line: 2, name: 'cognitiveLevel' },
      { line: 3, name: 'motorLevel' },
      { line: 4, name: 'cognitiveLevel' },
    ]);
  });

  it('ignores comments, strings, type mentions and fixture literals', () => {
    const sample = [
      '// help.motorLevel in a comment does not count',
      "const label = 'motorLevel and cognitiveLevel in a string';",
      "import type { HelpState } from 'marrow/core';",
      'interface View { readonly motorLevel: number; readonly cognitiveLevel: number }',
      "type Motor = HelpState['motorLevel'];",
      'const fixture = { motorLevel: 1, cognitiveLevel: 0 };',
      'const second = { motorLevel: 2 } as const;',
    ].join('\n');
    expect(levelReads('sample.ts', sample)).toEqual([]);
  });
});
