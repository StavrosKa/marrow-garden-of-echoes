// Requirement coverage for the marrow-input spec (task 18). Criterion ids come from requirements.md,
// task references from the "- _Requirements: ..._" bullets of tasks.md, and named tests from the table
// of design.md section 10.2. Only the extra name below is written here, as the plan asks for it.
// A name counts as a test only when it is the first argument of an it or test call (including the
// .each, .only and .skip forms), found by parsing the source. Describe titles, comments and other
// strings do not count.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specDir = path.join(repoRoot, '.kiro', 'specs', 'marrow-input');
const TEST_ROOTS = ['packages', 'apps', 'tests'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);
const EXTRA_NAMED_TESTS = ['stale_frame_emits_new_invalid_frame'];
const TEST_METHODS = new Set(['only', 'skip', 'todo', 'concurrent', 'sequential', 'fails']);

interface NamedTest {
  name: string;
  requirement: string;
}

function readLines(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/);
}

/** Ids "N.M": N from the "### Requirement N:" heading, M from the numbered lines under "#### Acceptance Criteria". */
function criterionIds(lines: string[]): string[] {
  const ids: string[] = [];
  let requirement: string | null = null;
  let inCriteria = false;
  for (const line of lines) {
    const heading = /^### Requirement (\d+):/.exec(line);
    if (heading) {
      requirement = heading[1] ?? null;
      inCriteria = false;
      continue;
    }
    if (line.trimEnd() === '#### Acceptance Criteria') {
      inCriteria = requirement !== null;
      continue;
    }
    if (/^#{1,3} /.test(line)) {
      inCriteria = false;
      continue;
    }
    const item = /^(\d+)\. /.exec(line);
    if (inCriteria && item && requirement !== null) ids.push(`${requirement}.${item[1]}`);
  }
  return ids;
}

/** The ids of every real "- _Requirements: ..._" bullet. Prose that mentions the marker does not match. */
function taskReferences(lines: string[]): string[] {
  const refs: string[] = [];
  for (const line of lines) {
    const bullet = /^\s*-\s+_Requirements:\s*(.*?)_\s*$/.exec(line);
    if (!bullet) continue;
    for (const token of (bullet[1] ?? '').split(',')) {
      const id = token.trim();
      if (!/^\d+\.\d+$/.test(id)) {
        throw new Error(`tasks.md: "${id}" on the line "${line.trim()}" is not a criterion id`);
      }
      refs.push(id);
    }
  }
  return refs;
}

/** The rows of the design.md section 10.2 table, in table order. */
function propertyTable(lines: string[]): NamedTest[] {
  const start = lines.findIndex((l) => l.startsWith('### 10.2 '));
  const end = lines.findIndex((l, i) => i > start && l.startsWith('### 10.3 '));
  if (start < 0 || end < 0) throw new Error('design.md: section 10.2 or 10.3 heading not found');
  const rows: NamedTest[] = [];
  for (const line of lines.slice(start, end)) {
    const row = /^\| `([a-z0-9_]+)` \| (\d+\.\d+) \|/.exec(line);
    if (row) rows.push({ name: row[1] ?? '', requirement: row[2] ?? '' });
  }
  return rows;
}

/** The "Property N: `name`" entries of the Correctness Properties list, with their "Validates" line. */
function correctnessList(lines: string[]): NamedTest[] {
  const start = lines.findIndex((l) => l.trimEnd() === '## Correctness Properties');
  const end = lines.findIndex((l, i) => i > start && l.trimEnd() === '## Testing Strategy');
  if (start < 0 || end < 0) throw new Error('design.md: Correctness Properties or Testing Strategy heading not found');
  const list: NamedTest[] = [];
  let pending: string | null = null;
  for (const line of lines.slice(start, end)) {
    const property = /^Property \d+: `([a-z0-9_]+)`$/.exec(line);
    if (property) {
      pending = property[1] ?? null;
      continue;
    }
    const validates = /^\*\*Validates: Requirements? (\d+\.\d+)\*\*$/.exec(line);
    if (validates && pending !== null) {
      list.push({ name: pending, requirement: validates[1] ?? '' });
      pending = null;
    }
  }
  return list;
}

function testFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function isTestRef(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) return expr.text === 'it' || expr.text === 'test';
  return ts.isPropertyAccessExpression(expr) && TEST_METHODS.has(expr.name.text) && isTestRef(expr.expression);
}

function isEachRef(expr: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expr) && expr.name.text === 'each' && isTestRef(expr.expression);
}

/** Titles given as the first argument of an it or test call, parsed from the source. */
function testTitles(file: string): string[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
  const titles: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const first = node.arguments[0];
      const direct = isTestRef(node.expression);
      const each = ts.isCallExpression(node.expression) && isEachRef(node.expression.expression);
      if (first && ts.isStringLiteralLike(first) && (direct || each)) titles.push(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return titles;
}

describe('requirement coverage (marrow-input)', () => {
  const requirements = criterionIds(readLines(path.join(specDir, 'requirements.md')));
  const refs = taskReferences(readLines(path.join(specDir, 'tasks.md')));
  const design = readLines(path.join(specDir, 'design.md'));
  const table = propertyTable(design);
  const list = correctnessList(design);
  const titles = new Set(
    TEST_ROOTS.flatMap((root) => testFiles(path.join(repoRoot, root))).flatMap(testTitles),
  );

  it('reads the criterion ids and the task references from the spec files', () => {
    console.info(`spec coverage: ${requirements.length} criteria, ${refs.length} task references`);
    expect(requirements.length).toBeGreaterThan(0);
    expect(refs.length).toBeGreaterThan(0);
    expect(new Set(requirements).size).toBe(requirements.length);
  });

  it('every acceptance criterion is referenced by at least one task', () => {
    const referenced = new Set(refs);
    expect(requirements.filter((id) => !referenced.has(id))).toEqual([]);
  });

  it('every task reference names an acceptance criterion that exists', () => {
    const exists = new Set(requirements);
    expect(refs.filter((id) => !exists.has(id))).toEqual([]);
  });

  it('the Correctness Properties list matches the section 10.2 table in names, order and requirement numbers', () => {
    expect(table.length).toBeGreaterThan(0);
    expect(list).toEqual(table);
  });

  it('every section 10.2 name and stale_frame_emits_new_invalid_frame is the title of a test', () => {
    const names = [...table.map((row) => row.name), ...EXTRA_NAMED_TESTS];
    expect(names.filter((name) => !titles.has(name))).toEqual([]);
  });
});
