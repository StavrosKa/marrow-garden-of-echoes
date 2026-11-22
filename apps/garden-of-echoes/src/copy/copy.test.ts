// The banned-word list of accessibility-and-copy.md applies to every player-facing string of copy/.
// The 8-word limit applies to every MarrowCopy string except the camera explanation (Req 21.7).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copy } from './index';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEERING = path.join(HERE, '..', '..', '..', '..', '.kiro', 'steering', 'accessibility-and-copy.md');
const NEVER_USE = 'Never use:';
// The word limit of an instruction (Req 21.7). It is a wording rule, not a tuning value.
const MAX_INSTRUCTION_WORDS = 8;
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
