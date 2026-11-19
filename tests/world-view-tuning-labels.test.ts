// Tuning of the world-view package (Req 1.3, 1.4, 1.6, 1.7): the shipped object passes
// validation and every key carries its label in the source of tuning.ts; each rule of
// design 5.2 (and each rule added there) rejects its bad value with a message that names
// the key, the value and the allowed range; and the code under packages/world-view/src/core
// holds no numeric literal outside TUNING and a few named constants. It lives in tests/
// because it reads source files, and packages/world-view is type-checked without Node types.
// It follows tests/tuning-labels.test.ts, which is bound to marrow's file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { TUNING as MARROW_TUNING } from 'marrow/core';
import { TUNING, formatIssues, validateTuning, type Tuning } from 'world-view';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = path.join(repoRoot, 'packages', 'world-view', 'src', 'core');
const tuningFile = path.join(coreDir, 'tuning.ts');
const RULE = "rule: change only with the user's approval";
// In the interface: "// <starting value> <label> (<source>)".
const INTERFACE_COMMENT = /^\/\/\s*\S+\s+(tune|rule: change only with the user's approval)\s+\(.+\)\s*$/;
// In TUNING: "// <label>".
const VALUE_COMMENT = /^\/\/\s*(tune|rule: change only with the user's approval)\s*$/;
// The keys design 5.1 labels as rules. Every other key is tune.
const RULE_KEYS = ['limitX', 'limitY', 'layersMin', 'layersMax', 'minFadeMs'];

// The boundaries of the rules ("<= 0", "below 1") are derived from tuning, not written as literals.
const ZERO = TUNING.nearPlane - TUNING.nearPlane;
const ONE = TUNING.nearPlane / TUNING.nearPlane;
const TWO = ONE + ONE;

interface LabelledKey {
  key: string;
  label: string | null;
}

/** Reads each key of the Tuning interface and of TUNING with the label on its line. */
function readLabels(): { interfaceKeys: LabelledKey[]; valueKeys: LabelledKey[] } {
  const text = fs.readFileSync(tuningFile, 'utf8');
  const source = ts.createSourceFile(tuningFile, text, ts.ScriptTarget.Latest, true);
  // The first comment after pos on the same line, or '' if there is none.
  const commentAfter = (pos: number): string => {
    const range = ts.getTrailingCommentRanges(text, pos)?.[0];
    return range ? text.slice(range.pos, range.end) : '';
  };
  const labelIn = (comment: string, pattern: RegExp): string | null => pattern.exec(comment)?.[1] ?? null;
  let interfaceKeys: LabelledKey[] = [];
  let valueKeys: LabelledKey[] = [];
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === 'Tuning') {
      // A member's end includes its semicolon, so its comment starts right after.
      interfaceKeys = statement.members.map((member) => ({
        key: member.name?.getText(source) ?? '',
        label: labelIn(commentAfter(member.end), INTERFACE_COMMENT),
      }));
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'TUNING') continue;
      const object = init && ts.isCallExpression(init) ? init.arguments[0] : undefined;
      if (!object || !ts.isObjectLiteralExpression(object)) {
        throw new Error('TUNING is expected to be Object.freeze<Tuning>({ ... })');
      }
      // A property's end is before its comma, so skip the comma first.
      valueKeys = object.properties.map((property) => {
        const comma = /^[ \t]*,/.exec(text.slice(property.end))?.[0].length ?? 0;
        return {
          key: property.name?.getText(source) ?? '',
          label: labelIn(commentAfter(property.end + comma), VALUE_COMMENT),
        };
      });
    }
  }
  return { interfaceKeys, valueKeys };
}

describe('world-view tuning.ts', () => {
  it('tuning shipped valid and labelled', () => {
    expect(validateTuning(TUNING)).toEqual([]);
    const { interfaceKeys, valueKeys } = readLabels();
    const keys = Object.keys(TUNING);
    // The interface and TUNING list the keys of the shipped object, in its order.
    expect(interfaceKeys.map((k) => k.key)).toEqual(keys);
    expect(valueKeys.map((k) => k.key)).toEqual(keys);
    // Every key has a label on its own line, in both places.
    expect(interfaceKeys.filter((k) => k.label === null).map((k) => k.key)).toEqual([]);
    expect(valueKeys.filter((k) => k.label === null).map((k) => k.key)).toEqual([]);
    // Both places give each key the same label.
    expect(valueKeys.filter((k, i) => k.label !== interfaceKeys[i]?.label).map((k) => k.key)).toEqual([]);
    // The rule keys are exactly those of design 5.1.
    expect(
      interfaceKeys
        .filter((k) => k.label === RULE)
        .map((k) => k.key)
        .sort(),
    ).toEqual([...RULE_KEYS].sort());
  });

  it('tuning is frozen', () => {
    expect(Object.isFrozen(TUNING)).toBe(true);
  });
});

// One row per rule. `overrides` is applied to the shipped tuning; `paths` are the keys that
// must fail, in key order; `range` is the allowed range printed for `key` (the first path
// unless `key` is given).
interface Rejection {
  rule: string;
  overrides: Partial<Tuning>;
  paths: (keyof Tuning)[];
  range: string;
  key?: keyof Tuning;
}

const T = TUNING;
const zeroOrBelow = (key: keyof Tuning): Partial<Tuning>[] => [{ [key]: ZERO }, { [key]: -T[key] }];

/** The rows of rules that exclude 0: one row for 0 and one for a negative value. */
function positiveRows(rule: string, key: keyof Tuning): Rejection[] {
  return zeroOrBelow(key).map((overrides) => ({
    rule,
    overrides,
    paths: [key],
    range: `(${ZERO}, Infinity)`,
  }));
}

/** The rows of rules that allow 0 and exclude a negative value. */
function nonNegativeRows(rule: string, key: keyof Tuning): Rejection[] {
  return [{ rule, overrides: { [key]: -T[key] }, paths: [key], range: `[${ZERO}, Infinity)` }];
}

const REJECTIONS: Rejection[] = [
  // Rules of Req 1.4 that concern the tuning object.
  { rule: 'parallax factor above 1', overrides: { interactionFactor: ONE + T.interactionFactor }, paths: ['interactionFactor'], range: `[${ZERO}, ${ONE}]` },
  { rule: 'parallax factor below 0', overrides: { interactionFactor: -T.interactionFactor }, paths: ['interactionFactor'], range: `[${ZERO}, ${ONE}]` },
  ...positiveRows('nearPlane <= 0', 'nearPlane'),
  ...positiveRows('glide time constant <= 0', 'glideTauMs'),
  ...positiveRows('glide cap <= 0', 'glideCapPerS'),
  ...positiveRows('cross-fade duration <= 0', 'crossFadeMs').map((row) => ({ ...row, paths: ['crossFadeMs', 'minFadeMs'] as (keyof Tuning)[], key: 'crossFadeMs' as const })),
  ...nonNegativeRows('multiplier below 0 (gentleAmbientAmplitude)', 'gentleAmbientAmplitude'),
  ...nonNegativeRows('multiplier below 0 (gentleAmbientSpeed)', 'gentleAmbientSpeed'),
  ...nonNegativeRows('multiplier below 0 (reducedAmbientSpeed)', 'reducedAmbientSpeed'),
  { rule: 'multiplier below 0 (gentleHeadMultiplier)', overrides: { gentleHeadMultiplier: -T.gentleHeadMultiplier }, paths: ['gentleHeadMultiplier'], range: `[${ZERO}, ${ONE}]` },
  { rule: 'multiplier below 0 (reducedAmbientAmplitude)', overrides: { reducedAmbientAmplitude: -T.reducedAmbientAmplitude }, paths: ['reducedAmbientAmplitude'], range: `[${ZERO}, ${ONE}]` },
  ...positiveRows('multiplier below 0 (gentleTravelMultiplier)', 'gentleTravelMultiplier'),
  { rule: 'minFadeMs below 2 x uiMinLightEaseMs', overrides: { minFadeMs: TWO * MARROW_TUNING.uiMinLightEaseMs - ONE }, paths: ['minFadeMs'], range: `[${TWO * MARROW_TUNING.uiMinLightEaseMs}, ${T.crossFadeMs}]` },
  { rule: 'minFadeMs above crossFadeMs', overrides: { minFadeMs: T.crossFadeMs + ONE }, paths: ['minFadeMs'], range: `[${TWO * MARROW_TUNING.uiMinLightEaseMs}, ${T.crossFadeMs}]` },
  ...nonNegativeRows('arrivalToleranceMs < 0', 'arrivalToleranceMs'),
  // Rules added in design 5.2 so that every function stays defined.
  { rule: 'limitX = 0', overrides: { limitX: ZERO }, paths: ['limitX'], range: `(${ZERO}, ${ONE}]` },
  { rule: 'limitX above 1', overrides: { limitX: ONE + T.limitX }, paths: ['limitX'], range: `(${ZERO}, ${ONE}]` },
  { rule: 'limitY = 0', overrides: { limitY: ZERO }, paths: ['limitY'], range: `(${ZERO}, ${ONE}]` },
  { rule: 'limitY above 1', overrides: { limitY: ONE + T.limitY }, paths: ['limitY'], range: `(${ZERO}, ${ONE}]` },
  { rule: 'vanishingPointY = 0', overrides: { vanishingPointY: ZERO }, paths: ['vanishingPointY'], range: `(${ZERO}, ${ONE})` },
  { rule: 'vanishingPointY = 1', overrides: { vanishingPointY: ONE }, paths: ['vanishingPointY'], range: `(${ZERO}, ${ONE})` },
  { rule: 'maxAspect < 1', overrides: { maxAspect: ONE - T.limitX }, paths: ['maxAspect'], range: `[${ONE}, Infinity)` },
  { rule: 'layersMin above layersMax', overrides: { layersMin: T.layersMax + ONE }, paths: ['layersMin', 'layersMax'], range: `[${ONE}, ${T.layersMax}] (integers only)` },
  { rule: 'layersMin not a whole number', overrides: { layersMin: T.layersMin + T.interactionFactor }, paths: ['layersMin'], range: `[${ONE}, ${T.layersMax}] (integers only)` },
  { rule: 'layersMax below layersMin', overrides: { layersMax: T.layersMin - ONE }, paths: ['layersMin', 'layersMax'], range: `[${T.layersMin}, Infinity) (integers only)`, key: 'layersMax' },
  { rule: 'horizonDepth not above foregroundDepth', overrides: { horizonDepth: T.foregroundDepth }, paths: ['horizonDepth', 'foregroundDepth'], range: `(${T.foregroundDepth}, Infinity)` },
  { rule: 'foregroundDepth not above nearPlane', overrides: { foregroundDepth: T.nearPlane }, paths: ['foregroundDepth'], range: `(${T.nearPlane}, ${T.horizonDepth})` },
  ...positiveRows('journeyHorizonMaxMove <= 0', 'journeyHorizonMaxMove'),
  ...positiveRows('doorHorizonMaxMove <= 0', 'doorHorizonMaxMove'),
  { rule: 'journeyForegroundMinGrowth < 1', overrides: { journeyForegroundMinGrowth: ONE - T.limitX }, paths: ['journeyForegroundMinGrowth'], range: `[${ONE}, Infinity)` },
  { rule: 'doorForegroundMinGrowth < 1', overrides: { doorForegroundMinGrowth: ONE - T.limitX }, paths: ['doorForegroundMinGrowth'], range: `[${ONE}, Infinity)` },
  ...positiveRows('glideEpsilon <= 0', 'glideEpsilon'),
  ...positiveRows('lockEaseMs <= 0', 'lockEaseMs'),
  ...positiveRows('doorMs <= 0', 'doorMs'),
  { rule: 'journeyMinMs above journeyMaxMs', overrides: { journeyMinMs: T.journeyMaxMs + ONE }, paths: ['journeyMinMs', 'journeyMaxMs'], range: `(${ZERO}, ${T.journeyMaxMs}]` },
  { rule: 'journeyMinMs = 0', overrides: { journeyMinMs: ZERO }, paths: ['journeyMinMs'], range: `(${ZERO}, ${T.journeyMaxMs}]` },
  { rule: 'journeyMaxMs below journeyMinMs', overrides: { journeyMaxMs: T.journeyMinMs - ONE }, paths: ['journeyMinMs', 'journeyMaxMs'], range: `[${T.journeyMinMs}, Infinity)`, key: 'journeyMaxMs' },
  { rule: 'maxPixelRatio < 1', overrides: { maxPixelRatio: ONE - T.limitX }, paths: ['maxPixelRatio'], range: `[${ONE}, Infinity)` },
  { rule: 'gentleHeadMultiplier above 1', overrides: { gentleHeadMultiplier: ONE + T.limitX }, paths: ['gentleHeadMultiplier'], range: `[${ZERO}, ${ONE}]` },
  { rule: 'reducedAmbientAmplitude above 1', overrides: { reducedAmbientAmplitude: ONE + T.limitX }, paths: ['reducedAmbientAmplitude'], range: `[${ZERO}, ${ONE}]` },
];

describe('tuning rejects', () => {
  for (const row of REJECTIONS) {
    it(`tuning rejects ${row.rule}`, () => {
      const bad: Tuning = { ...TUNING, ...row.overrides };
      const issues = validateTuning(bad);
      expect(issues.map((issue) => issue.path)).toEqual(row.paths);
      const key = row.key ?? row.paths[0];
      const issue = issues.find((candidate) => candidate.path === key);
      expect(issue).toBeDefined();
      // The message names the key, the value and the allowed range.
      expect(issue?.value).toBe(bad[key as keyof Tuning]);
      expect(issue?.message).toBe(`${key} = ${bad[key as keyof Tuning]} is out of range ${row.range}`);
    });
  }

  it('tuning rejects a value that is not finite, for every key', () => {
    for (const key of Object.keys(TUNING) as (keyof Tuning)[]) {
      for (const value of [NaN, Infinity, -Infinity]) {
        const issues = validateTuning({ ...TUNING, [key]: value });
        const own = issues.find((issue) => issue.path === key);
        expect(own?.message.startsWith(`${key} = ${value} is out of range `)).toBe(true);
      }
    }
  });

  it('tuning rejects with one issue per failing key, in key order', () => {
    const bad: Tuning = { ...TUNING, maxPixelRatio: -T.maxPixelRatio, glideCapPerS: -T.glideCapPerS, limitX: ZERO };
    const issues = validateTuning(bad);
    expect(issues.map((issue) => issue.path)).toEqual(['limitX', 'glideCapPerS', 'maxPixelRatio']);
    expect(issues.find((issue) => issue.path === 'glideCapPerS')?.message).toBe(
      `glideCapPerS = ${-T.glideCapPerS} is out of range (${ZERO}, Infinity)`,
    );
  });

  it('tuning rejects a lower bound of minFadeMs that is read from marrow, not written here', () => {
    const lower = TWO * MARROW_TUNING.uiMinLightEaseMs;
    expect(validateTuning({ ...TUNING, minFadeMs: lower })).toEqual([]);
    expect(validateTuning({ ...TUNING, minFadeMs: lower - ONE }).map((issue) => issue.path)).toEqual(['minFadeMs']);
    expect(TUNING.minFadeMs).toBe(lower);
  });

  it('formatIssues gives the title and one line per issue, and nothing for no issue', () => {
    const issues = validateTuning({ ...TUNING, glideCapPerS: -T.glideCapPerS, doorMs: ZERO });
    const title = 'Tuning is invalid:';
    expect(formatIssues(title, issues)).toBe(
      [title, ...issues.map((issue) => `- ${issue.message}`)].join('\n'),
    );
    expect(formatIssues(title, [])).toBe('');
  });
});

// core_reads_numbers_from_tuning (Req 1.6): no numeric literal in the core except the
// named constants below and the starting values inside the TUNING object itself. Found
// with the TypeScript parser, so a number in a comment or a string does not count.
const ALLOWED_NAMES = new Set(['ZERO', 'ONE', 'HALF', 'SMOOTHERSTEP_A', 'SMOOTHERSTEP_B', 'SMOOTHERSTEP_C', 'MS_PER_SECOND']);
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const TESTGEN_FILE = /^testgen\.[cm]?[jt]sx?$/;

const rel = (file: string): string => path.relative(repoRoot, file).split(path.sep).join('/');

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    const skipped = TEST_FILE.test(entry.name) || TESTGEN_FILE.test(entry.name);
    return SOURCE_FILE.test(entry.name) && !skipped ? [full] : [];
  });
}

/** True if the literal is the initializer of one of the allowed constants, or lies inside TUNING. */
function isAllowedPlace(node: ts.Node): boolean {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    // A number in a type (for example `0 | 1 | 2`) is not a value.
    if (ts.isLiteralTypeNode(parent)) return true;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      const name = parent.name.text;
      if (name === 'TUNING') return true;
      if (ALLOWED_NAMES.has(name) && parent.initializer === node) return true;
    }
  }
  return false;
}

/** Every numeric literal outside the allowed places, as "<line>: <text>". */
function findNumericLiterals(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) && !isAllowedPlace(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      found.push(`${line + 1}: ${node.getText(source)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('core reads numbers from tuning', () => {
  it('core reads numbers from tuning', () => {
    const files = listFiles(coreDir);
    // The scan reaches the core, so a wrong path cannot pass by finding nothing.
    expect(files.map(rel)).toContain('packages/world-view/src/core/tuning.ts');
    expect(files.map(rel)).toContain('packages/world-view/src/core/ease.ts');
    const found = files.flatMap((file) =>
      findNumericLiterals(file, fs.readFileSync(file, 'utf8')).map((use) => `${rel(file)}:${use}`),
    );
    expect(found).toEqual([]);
  });

  it('the literal scan finds a number in code and skips the allowed places', () => {
    const positive = [
      'const gain = 3;',
      'const half = x * 0.5;',
      'const first = list[0];',
      'const neg = -2;',
      'const ONES = 1;',
      'const perSecond = dtMs / 1000;',
    ].join('\n');
    expect(findNumericLiterals('positive.ts', positive)).toEqual([
      '1: 3',
      '2: 0.5',
      '3: 0',
      '4: 2',
      '5: 1',
      '6: 1000',
    ]);
    const negative = [
      '// 7 in a comment, "8" in a string below',
      "const text = '9 in a string';",
      'const ZERO = 0;',
      'const ONE = 1;',
      'const HALF = 0.5;',
      'const MS_PER_SECOND = 1000;',
      'const perSecond = dtMs / MS_PER_SECOND;',
      'const SMOOTHERSTEP_A = 6;',
      'type Rank = 0 | 1 | 2;',
      'export const TUNING = Object.freeze({ a: 4, b: [5, 6] });',
      'const y = ZERO + ONE * HALF;',
    ].join('\n');
    expect(findNumericLiterals('negative.ts', negative)).toEqual([]);
  });
});
