// The banned-word list of accessibility-and-copy.md applies to every player-facing string of copy/.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copy } from './index';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEERING = path.join(HERE, '..', '..', '..', '..', '.kiro', 'steering', 'accessibility-and-copy.md');
const NEVER_USE = 'Never use:';

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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('copy', () => {
  it('no word of the banned list in copy', () => {
    const banned = bannedWords(readFileSync(STEERING, 'utf8'));
    expect(banned.length).toBeGreaterThan(0);
    const found = strings(copy).flatMap((text) =>
      banned
        .filter((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(text))
        .map((word) => `"${text}" contains "${word}"`),
    );
    expect(found).toEqual([]);
  });
});
