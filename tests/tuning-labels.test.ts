// tuning_shipped_valid_and_labelled (Req 1.7): the shipped tuning object passes
// validation, and every key carries its label in the source of tuning.ts, in the
// Tuning interface and again in TUNING. It lives in tests/ because it reads a
// source file, and packages/marrow is type-checked without Node types.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { TUNING, validateTuning } from 'marrow/core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tuningFile = path.join(repoRoot, 'packages', 'marrow', 'src', 'core', 'tuning.ts');

const RULE = "rule: change only with the user's approval";
// In the interface: "// <starting value> <label> (<source>)".
const INTERFACE_COMMENT = /^\/\/\s*\S+\s+(tune|rule: change only with the user's approval)\s+\(.+\)\s*$/;
// In TUNING: "// <label>".
const VALUE_COMMENT = /^\/\/\s*(tune|rule: change only with the user's approval)\s*$/;

// The keys design section 4 labels as rules: steering values not marked (tune),
// including the camera size from tech.md. Every other key is tune.
const RULE_KEYS = [
  'headEaseToCentreMs',
  'calmHoldMs',
  'skipHeadViewAfterMs',
  'outsideWindowMs',
  'invalidWindowMs',
  'maxClockStepMs',
  'oneWristHintMs',
  'trackingHoldAfterMs',
  'trackingOverlayAfterMs',
  'difficultiesBeforeHelp',
  'cameraWidth',
  'cameraHeight',
  'uiMinTextPx',
  'uiMinButtonTextPx',
  'uiMinLightEaseMs',
];

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

describe('tuning.ts', () => {
  it('tuning_shipped_valid_and_labelled', () => {
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
    // The rule keys are exactly those of design section 4.
    expect(
      interfaceKeys
        .filter((k) => k.label === RULE)
        .map((k) => k.key)
        .sort(),
    ).toEqual([...RULE_KEYS].sort());
  });
});
