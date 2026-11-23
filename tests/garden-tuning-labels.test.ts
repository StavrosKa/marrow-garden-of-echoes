// tuning_labels_garden (Req 23.3): every tuning.ts in the pure folders of the
// garden-level spec labels each key in the form of tests/tuning-labels.test.ts.
// An interface member needs "// <starting value> <label> (<source>)"; an object
// literal property needs "// <label>". The folders are marrow's challenges and sim
// folders and the app's session folder. A folder that does not exist yet is
// skipped. The two label patterns are copied from tests/tuning-labels.test.ts,
// which does not export them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tuningDirs = [
  path.join(repoRoot, 'packages', 'marrow', 'src', 'challenges'),
  path.join(repoRoot, 'packages', 'marrow', 'src', 'sim'),
  path.join(repoRoot, 'apps', 'garden-of-echoes', 'src', 'session'),
];

// Same as in tests/tuning-labels.test.ts.
const INTERFACE_COMMENT = /^\/\/\s*\S+\s+(tune|rule: change only with the user's approval)\s+\(.+\)\s*$/;
const VALUE_COMMENT = /^\/\/\s*(tune|rule: change only with the user's approval)\s*$/;

const rel = (file: string): string => path.relative(repoRoot, file).split(path.sep).join('/');

/** The tuning.ts files that exist in the three folders. */
function tuningFiles(): string[] {
  return tuningDirs
    .filter((dir) => fs.existsSync(dir))
    .map((dir) => path.join(dir, 'tuning.ts'))
    .filter((file) => fs.existsSync(file));
}

/** "<line>: <key>" for every interface member or object property without its label. */
function unlabelledKeys(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const missing: string[] = [];
  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  // The first comment on the same line after the node. A comma after an object property
  // is skipped first. An interface member's end already includes its semicolon.
  const commentAt = (end: number): string => {
    const skip = /^[ \t]*[,;]/.exec(text.slice(end))?.[0].length ?? 0;
    const range = ts.getTrailingCommentRanges(text, end + skip)?.[0];
    return range ? text.slice(range.pos, range.end) : '';
  };
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node)) {
      for (const member of node.members) {
        if (!INTERFACE_COMMENT.test(commentAt(member.end))) {
          missing.push(`${lineOf(member)}: ${member.name?.getText(source) ?? '?'}`);
        }
      }
    } else if (ts.isPropertyAssignment(node)) {
      if (!VALUE_COMMENT.test(commentAt(node.end))) {
        missing.push(`${lineOf(node)}: ${node.name.getText(source)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return missing;
}

describe('tuning labels in the garden-level folders', () => {
  it('tuning_labels_garden: every key of every tuning.ts carries its label', () => {
    const missing = tuningFiles().flatMap((file) =>
      unlabelledKeys(file, fs.readFileSync(file, 'utf8')).map((key) => `${rel(file)}:${key}`),
    );
    expect(missing).toEqual([]);
  });

  it('the label check reports a key without a label and accepts both label forms', () => {
    const fixture = [
      'export interface DemoTuning {',
      '  stepMs: number; // 1500 tune (design section 4)',
      '  missingMs: number;',
      "  capCount: number; // 3 rule: change only with the user's approval (requirements 7.1)",
      '}',
      'export const DEMO_TUNING = Object.freeze({',
      '  stepMs: 1500, // tune',
      "  capCount: 3, // rule: change only with the user's approval",
      '  missingRowCount: 3,',
      '});',
    ].join('\n');
    expect(unlabelledKeys('fixture.ts', fixture)).toEqual(['3: missingMs', '9: missingRowCount']);
  });
});
