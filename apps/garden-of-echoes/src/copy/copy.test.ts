// The banned-word list of accessibility-and-copy.md applies to every player-facing string of copy/.
// The 8-word limit applies to every MarrowCopy string except the camera explanation (Req 21.7).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copy } from './index';
import { GARDEN_COPY, hasCopyKey, type GardenCopyKey } from './garden';
import { gardenMarrowCopy } from './gardenMarrowCopy';
import { TITLE_OF } from '../session/stageOrder';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEERING = path.join(HERE, '..', '..', '..', '..', '.kiro', 'steering', 'accessibility-and-copy.md');
const REQUIREMENTS = path.join(HERE, '..', '..', '..', '..', '.kiro', 'specs', 'garden-level', 'requirements.md');
const NEVER_USE = 'Never use:';
// The word limit of an instruction (Req 21.7). It is a wording rule, not a tuning value.
const MAX_INSTRUCTION_WORDS = 8;
// The word limit of Requirement 14.2: every line is about eight words or fewer, one instruction at a time. This is the
// named constant that the garden copy checks use; it is the approved exception to the no-literals rule.
const COPY_MAX_WORDS = 8;
// The rows of the Requirement 14 table (14.4): 33 keys. The garden copy must hold exactly these keys.
const REQUIREMENT_14_ROWS = 33;
// Strings of gardenMarrowCopy: MarrowCopy has 50 string fields (design 2.11).
const MARROW_COPY_STRINGS = 50;
// The camera explanation may run longer (Req 14.2). camera.explanation in marrow/react is the same text.
const LONG_OK = ['camera.why', 'camera.explanation'];
// Positive claims of therapy, rehabilitation, diagnosis or clinical benefit (Req 14.5, steering wording). Docs may
// say what the project is not; the player-facing copy may not claim any of these.
const CLAIM_WORDS = /\b(?:therap(?:y|eutic|ist)|rehab(?:ilitation)?|diagnos(?:is|e|es|ed|tic|ing)|clinical|medical|treatment|cure[sd]?|heal(?:s|ing)?|recovery|benefit)\b/i;
// The camera explanation is one sentence, not an instruction (Req 21.5).
const EXPLANATION = 'camera.explanation';

/** The words of the "Never use:" line, without the parenthesised notes and the final full stop. */
function bannedWords(steering: string): string[] {
  const line = steering.split('\n').find((text) => text.includes(NEVER_USE));
  if (line === undefined) throw new Error('accessibility-and-copy.md has no "Never use:" line');
  const list = line.slice(line.indexOf(NEVER_USE) + NEVER_USE.length);
  return list
    .split(',')
    .map((entry) => entry.replace(/\(.*?\)/g, '').replace(/\.\s*$/, '').trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** Every string value of an object tree. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

/** Every string of an object tree with its dotted path, such as "camera.useCamera". */
function leaves(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix === '' ? key : `${prefix}.${key}`));
  }
  return [];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

describe('copy', () => {
  it('copy_banned_words_and_length', () => {
    const banned = bannedWords(readFileSync(STEERING, 'utf8'));
    expect(banned.length).toBeGreaterThan(0);
    const found = strings(copy).flatMap((text) =>
      banned
        .filter((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(text))
        .map((word) => `"${text}" contains "${word}"`),
    );
    expect(found).toEqual([]);

    const tooLong = leaves(copy.marrow)
      .filter(([key]) => key !== EXPLANATION)
      .filter(([, text]) => wordCount(text) > MAX_INSTRUCTION_WORDS)
      .map(([key, text]) => `${key}: "${text}" has ${wordCount(text)} words`);
    expect(tooLong).toEqual([]);

    const explanation = leaves(copy.marrow).find(([key]) => key === EXPLANATION)?.[1] ?? '';
    expect(explanation.match(/[.!?]/g)?.length, 'one sentence').toBe(1);
    expect(explanation.endsWith('.')).toBe(true);
  });
});

/** The value at a dotted path of an object tree, or undefined. */
function valueAt(root: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>(
    (node, key) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined),
    root,
  );
}

/** The Requirement 14 table: each key of the draft table with its text, read from requirements.md (section 14 only). */
function requirement14Rows(): Map<string, string> {
  const text = readFileSync(REQUIREMENTS, 'utf8');
  const start = text.indexOf('### Requirement 14:');
  const end = text.indexOf('### Requirement 15:');
  const rows = new Map<string, string>();
  for (const line of text.slice(start, end).split('\n')) {
    const match = /^\| `([^`]+)` \| (.+?) \|\s*$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) rows.set(match[1], match[2]);
  }
  return rows;
}

// The ten fields of gardenMarrowCopy that take their text from GARDEN_COPY (design 2.11), each with its key.
const MAPPED: readonly [string, GardenCopyKey][] = [
  ['start.start', 'home.start'],
  ['camera.explanation', 'camera.why'],
  ['camera.tryWithout', 'home.noCamera'],
  ['simulatedInputLabel', 'label.simulated'],
  ['tracking.stepBackIn', 'tracking.step'],
  ['pause.resume', 'pause.resume'],
  ['pause.recalibrate', 'pause.recalibrate'],
  ['pause.exit', 'pause.exit'],
  ['settings.motion', 'pause.motion'],
  ['settings.sound', 'pause.sound'],
];

describe('garden copy (garden-level 4.3)', () => {
  it('the ten mapped fields of gardenMarrowCopy take their text from GARDEN_COPY', () => {
    for (const [field, key] of MAPPED) {
      expect(hasCopyKey(key), key).toBe(true);
      expect(valueAt(gardenMarrowCopy, field), field).toBe(valueAt(GARDEN_COPY, key));
    }
  });

  it('every other field equals copy.marrow at the same path, and start.title is the app name', () => {
    const mapped = new Set(MAPPED.map(([field]) => field));
    const mismatches = leaves(gardenMarrowCopy)
      .map(([field]) => field)
      .filter((field) => !mapped.has(field) && field !== 'start.title')
      .filter((field) => valueAt(gardenMarrowCopy, field) !== valueAt(copy.marrow, field))
      .map((field) => `${field}: not the copy.marrow text`);
    expect(mismatches).toEqual([]);
    expect(gardenMarrowCopy.start.title).toBe(copy.appName);
  });

  it('gardenMarrowCopy has the same string paths as copy.marrow, and the MarrowCopy string count', () => {
    const garden = leaves(gardenMarrowCopy).map(([field]) => field);
    const marrow = leaves(copy.marrow).map(([field]) => field);
    expect(garden).toEqual(marrow);
    expect(garden).toHaveLength(MARROW_COPY_STRINGS);
  });

  it('the banned words are absent from every string of GARDEN_COPY and gardenMarrowCopy', () => {
    const banned = bannedWords(readFileSync(STEERING, 'utf8'));
    const texts = [...strings(GARDEN_COPY), ...strings(gardenMarrowCopy)];
    const found = texts.flatMap((text) =>
      banned
        .filter((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(text))
        .map((word) => `"${text}" contains "${word}"`),
    );
    expect(found).toEqual([]);
  });

  it('every line of GARDEN_COPY and gardenMarrowCopy is at most COPY_MAX_WORDS words, except camera.why', () => {
    const tooLong = [...leaves(GARDEN_COPY), ...leaves(gardenMarrowCopy)]
      .filter(([field]) => !LONG_OK.includes(field))
      .filter(([, text]) => wordCount(text) > COPY_MAX_WORDS)
      .map(([field, text]) => `${field}: "${text}" has ${wordCount(text)} words`);
    expect(tooLong).toEqual([]);
  });

  it('the copy claims no therapy, rehabilitation, diagnosis or clinical benefit', () => {
    const claims = [...strings(GARDEN_COPY), ...strings(gardenMarrowCopy)].filter((text) => CLAIM_WORDS.test(text));
    expect(claims).toEqual([]);
  });

  it('GARDEN_COPY holds exactly the keys of the Requirement 14 table, with the same texts', () => {
    const rows = requirement14Rows();
    expect(rows.size).toBe(REQUIREMENT_14_ROWS);
    const keys = leaves(GARDEN_COPY).map(([key]) => key);
    expect([...keys].sort()).toEqual([...rows.keys()].sort());
    for (const [key, text] of rows) {
      expect(valueAt(GARDEN_COPY, key), key).toBe(text);
    }
  });

  it('every title of TITLE_OF has a title key', () => {
    for (const title of Object.values(TITLE_OF)) {
      expect(hasCopyKey(`title.${title}`), `title.${title}`).toBe(true);
    }
  });

  it('reports the number of keys and strings it checked', () => {
    const keyCount = leaves(GARDEN_COPY).length;
    const stringCount = leaves(gardenMarrowCopy).length;
    console.info(`garden copy: ${keyCount} GARDEN_COPY keys, ${stringCount} gardenMarrowCopy strings checked`);
    expect(keyCount).toBe(REQUIREMENT_14_ROWS);
    expect(stringCount).toBe(MARROW_COPY_STRINGS);
  });
});
