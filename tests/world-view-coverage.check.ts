// The requirement coverage check of world-view (Req 15.7; design 9.5). It reads requirements.md, the rows
// of coverage.md, the manual steps of tasks.md, docs/licenses.md, docs/bugs-found.md, the test files and the
// source files that the Req 2.2 scan reads, and returns every problem it finds, in groups. The test file
// (tests/world-view-coverage.test.ts) asserts each group, so one failure lists all the problems of its group.
// This file is a helper: it holds no test, and it runs under node with the TypeScript parser.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type Group = 'format' | 'missing' | 'unknown' | 'test' | 'manual' | 'reason' | 'titles' | 'licences' | 'bugs' | 'scan';

export interface Problem {
  readonly group: Group;
  readonly message: string;
}

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

export interface CoverageInputs {
  readonly requirements: string;
  readonly tasks: string;
  readonly coverage: string;
  readonly licences: string;
  readonly bugs: string;
  /** The test files, whose literal titles the rows may name. */
  readonly tests: readonly SourceFile[];
  /** The files that the depth - travel scan reads (src/pixi and the app). */
  readonly scanned: readonly SourceFile[];
  /** The eight titles of Req 15.1, which must exist exactly as literal it titles. */
  readonly requiredTitles: readonly string[];
}

const KINDS: readonly string[] = ['test', 'manual', 'reason'];
const REQUIREMENT_HEADING = /^### Requirement (\d+):/;
const NUMBERED_CRITERION = /^(\d+)\. /;
const MANUAL_STEP = /^\s*-\s+(M\d+)\.\s/;
const DEPTH_TRAVEL = /depth\s*-\s*travel/;
const PIXI_LICENCE_ROW = /^\|\s*pixi\.js\s*\|\s*8\.22\.0\s*\|/m;
const BACKTICK_SPAN = /`([^`]+)`/g;
const MIN_REASON_WORDS = 5;

/** The criterion ids of requirements.md: each top-level numbered item under `### Requirement N`, as `N.M`. */
export function criterionIds(requirements: string): string[] {
  const ids: string[] = [];
  let requirement: number | undefined;
  for (const line of requirements.split(/\r?\n/)) {
    if (line.startsWith('## ')) requirement = undefined;
    const heading = REQUIREMENT_HEADING.exec(line);
    if (heading) requirement = Number(heading[1]);
    const item = NUMBERED_CRITERION.exec(line);
    if (requirement !== undefined && item) ids.push(`${requirement}.${item[1]}`);
  }
  return ids;
}

/** The step ids of the manual list in the Notes of tasks.md (`- M1. ...`). */
export function manualIds(tasks: string): string[] {
  const ids: string[] = [];
  for (const line of tasks.split(/\r?\n/)) {
    const step = MANUAL_STEP.exec(line);
    if (step?.[1] !== undefined) ids.push(step[1]);
  }
  return ids;
}

export interface CoverageRow {
  readonly id: string;
  readonly kind: string;
  readonly reference: string;
  readonly line: number;
}

/** The rows of the table `| id | kind | reference |`. A line that is not a row of three cells is a format problem. */
export function parseCoverage(coverage: string, problems: Problem[]): CoverageRow[] {
  const rows: CoverageRow[] = [];
  coverage.split(/\r?\n/).forEach((text, index) => {
    const line = text.trim();
    if (!line.startsWith('|')) return;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells[0] === 'id' || cells.every((cell) => /^-+$/.test(cell))) return;
    if (cells.length !== 3) {
      problems.push({ group: 'format', message: `coverage.md line ${index + 1}: a row needs three cells (id, kind, reference)` });
      return;
    }
    rows.push({ id: cells[0] ?? '', kind: cells[1] ?? '', reference: cells[2] ?? '', line: index + 1 });
  });
  return rows;
}

/** A title found in a test file: an it or test call, or a describe call. `hasTest` is true when a describe holds one. */
export interface TitleEntry {
  readonly kind: 'it' | 'describe';
  readonly hasTest: boolean;
  readonly file: string;
}

function callKind(callee: ts.Expression): 'it' | 'describe' | undefined {
  if (ts.isIdentifier(callee)) {
    if (callee.text === 'describe') return 'describe';
    if (callee.text === 'it' || callee.text === 'test') return 'it';
    return undefined;
  }
  // The Playwright form `test.describe(...)`.
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'test' && callee.name.text === 'describe') {
    return 'describe';
  }
  return undefined;
}

/** True when a call to it or test is somewhere inside `node`. */
function holdsTestCall(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(child) && callKind(child.expression) === 'it') {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/**
 * Every literal title in the files, by title. A title built at run time (a template with a substitution, or a
 * variable) is not a literal and is not collected, so a row that names it cannot be found.
 */
export function collectTitles(files: readonly SourceFile[]): Map<string, TitleEntry[]> {
  const titles = new Map<string, TitleEntry[]>();
  for (const file of files) {
    const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const kind = callKind(node.expression);
        const first = node.arguments[0];
        if (kind !== undefined && first !== undefined && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
          const entry: TitleEntry = {
            kind,
            hasTest: kind === 'describe' && holdsTestCall(node),
            file: file.path,
          };
          const list = titles.get(first.text) ?? [];
          list.push(entry);
          titles.set(first.text, list);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return titles;
}

/**
 * The spans of docs/bugs-found.md that name a seed regression test: backticked text that says `regression` or
 * `docs/bugs-found.md`. Each must be (part of) a literal it title.
 */
export function bugTitles(bugs: string): string[] {
  const spans: string[] = [];
  for (const match of bugs.matchAll(BACKTICK_SPAN)) {
    const span = match[1];
    if (span !== undefined && (span.includes('regression') || span.includes('docs/bugs-found.md'))) spans.push(span);
  }
  return spans;
}

/** Every problem of the coverage in the inputs, in groups. An empty list means the coverage is complete. */
export function checkCoverage(inputs: CoverageInputs): Problem[] {
  const problems: Problem[] = [];
  const rows = parseCoverage(inputs.coverage, problems);
  const ids = criterionIds(inputs.requirements);
  const manual = manualIds(inputs.tasks);
  const titles = collectTitles(inputs.tests);
  const rowIds = new Set(rows.map((row) => row.id));

  for (const id of ids) {
    if (!rowIds.has(id)) problems.push({ group: 'missing', message: `criterion ${id} has no row in coverage.md` });
  }
  const known = new Set(ids);
  for (const row of rows) {
    if (!known.has(row.id)) problems.push({ group: 'unknown', message: `coverage.md line ${row.line}: "${row.id}" is not a criterion of requirements.md` });
    if (!KINDS.includes(row.kind)) {
      problems.push({ group: 'format', message: `coverage.md line ${row.line}: kind "${row.kind}" is not test, manual or reason` });
      continue;
    }
    if (row.kind === 'test') {
      const problem = titleProblem(row, titles);
      if (problem !== undefined) problems.push({ group: 'test', message: `coverage.md line ${row.line} (${row.id}): ${problem}` });
    } else if (row.kind === 'manual') {
      if (!manual.includes(row.reference)) {
        problems.push({ group: 'manual', message: `coverage.md line ${row.line} (${row.id}): "${row.reference}" is not a manual step of tasks.md` });
      }
    } else if (row.reference.split(/\s+/).filter((word) => word.length > 0).length < MIN_REASON_WORDS) {
      problems.push({ group: 'reason', message: `coverage.md line ${row.line} (${row.id}): the reason is not a sentence` });
    }
  }

  for (const title of inputs.requiredTitles) {
    const entries = titles.get(title) ?? [];
    if (!entries.some((entry) => entry.kind === 'it')) {
      problems.push({ group: 'titles', message: `Req 15.1 title "${title}" is not a literal it title` });
    }
  }

  if (!PIXI_LICENCE_ROW.test(inputs.licences)) {
    problems.push({ group: 'licences', message: 'docs/licenses.md has no row for pixi.js at 8.22.0' });
  }

  for (const span of bugTitles(inputs.bugs)) {
    const named = [...titles.keys()].some((title) => title.includes(span) && (titles.get(title) ?? []).some((entry) => entry.kind === 'it'));
    if (!named) problems.push({ group: 'bugs', message: `docs/bugs-found.md names "${span}", which is not a literal it title` });
  }

  for (const file of inputs.scanned) {
    file.text.split(/\r?\n/).forEach((line, index) => {
      if (DEPTH_TRAVEL.test(line)) problems.push({ group: 'scan', message: `${file.path}:${index + 1} holds a depth - travel pattern (Req 2.2)` });
    });
  }
  return problems;
}

/** Why a test row does not name a literal title, or undefined when it does. */
function titleProblem(row: CoverageRow, titles: Map<string, TitleEntry[]>): string | undefined {
  if (row.reference.length === 0) return 'the test row names no title';
  const entries = titles.get(row.reference) ?? [];
  if (entries.some((entry) => entry.kind === 'it')) return undefined;
  const describes = entries.filter((entry) => entry.kind === 'describe');
  if (describes.length > 0) {
    if (describes.some((entry) => entry.hasTest)) return undefined;
    return `"${row.reference}" is a describe title with no it or test inside it`;
  }
  return `"${row.reference}" is not a literal title of an it, test or describe call`;
}

const TEST_FILE = /\.(test|spec)\.tsx?$/;
const TEXT_FILE = /\.(tsx?|jsx?|mjs|cjs|json|css|html|md)$/;

/** The files under a directory, skipping node_modules and dist, that the keep test accepts (relative to root). */
function walk(root: string, dir: string, keep: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(root, full, keep);
    return keep(entry.name) ? [path.relative(root, full).split(path.sep).join('/')] : [];
  });
}

function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** Reads the inputs of the check from a repository root (the workspace folders and the spec's files). */
export function readCoverageInputs(root: string, requiredTitles: readonly string[]): CoverageInputs {
  const tests = ['packages', 'apps', 'tests']
    .flatMap((dir) => walk(root, path.join(root, dir), (name) => TEST_FILE.test(name)))
    .map((rel) => ({ path: rel, text: read(root, rel) }));
  const scanned = ['packages/world-view/src/pixi', 'apps/garden-of-echoes/src']
    .flatMap((dir) => walk(root, path.join(root, dir), (name) => TEXT_FILE.test(name)))
    .map((rel) => ({ path: rel, text: read(root, rel) }));
  return {
    requirements: read(root, '.kiro/specs/world-view/requirements.md'),
    tasks: read(root, '.kiro/specs/world-view/tasks.md'),
    coverage: read(root, '.kiro/specs/world-view/coverage.md'),
    licences: read(root, 'docs/licenses.md'),
    bugs: read(root, 'docs/bugs-found.md'),
    tests,
    scanned,
    requiredTitles,
  };
}
