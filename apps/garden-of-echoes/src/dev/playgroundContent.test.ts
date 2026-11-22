// The playground content validator (design section 14.4, Req 26.3): the shipped file passes, and each kind of bad
// field fails with a message that names it.
import { describe, expect, it } from 'vitest';
import { readPlaygroundContent } from './playgroundContent';
import shipped from './playground-content.json';

/** A valid file, copied for each test that makes one field bad. */
function validFile(): { targetCount: number; slots: { x: number; y: number }[] } {
  return {
    targetCount: 3,
    slots: Array.from({ length: 15 }, (_, i) => ({ x: 0.1 + i * 0.01, y: 0.5 })),
  };
}

function messageOf(value: unknown): string {
  const result = readPlaygroundContent(value);
  if (result.ok) throw new Error('expected the content to be rejected');
  return result.message;
}

describe('playground-content.json', () => {
  it('the shipped file is valid: 15 slots in order and a target count of 3', () => {
    const result = readPlaygroundContent(shipped);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.targetCount).toBe(3);
    expect(result.content.slots).toHaveLength(15);
  });

  it('accepts a valid object built in code', () => {
    expect(readPlaygroundContent(validFile()).ok).toBe(true);
  });

  it('names a missing field', () => {
    const file: Partial<ReturnType<typeof validFile>> = validFile();
    delete file.targetCount;
    expect(messageOf(file)).toBe('playground-content.json: targetCount is missing');

    const slot: Record<string, unknown> = { x: 0.2 };
    expect(messageOf({ targetCount: 3, slots: [slot] })).toBe('playground-content.json: slots[0].y is missing');
  });

  it('names a wrong type', () => {
    expect(messageOf({ targetCount: 3, slots: [{ x: '0.2', y: 0.5 }] })).toBe(
      'playground-content.json: slots[0].x must be a number, got string',
    );
    expect(messageOf({ targetCount: 3.5, slots: [{ x: 0.2, y: 0.5 }] })).toBe(
      'playground-content.json: targetCount = 3.5 must be an integer of at least 1',
    );
  });

  it('names the first out-of-range value, with its range', () => {
    const file = validFile();
    file.slots[7] = { x: 0.5, y: 1.4 };
    expect(messageOf(file)).toBe('playground-content.json: slots[7].y = 1.4 is out of range [0, 1]');
    expect(messageOf({ targetCount: 3, slots: [{ x: -0.1, y: 0.5 }] })).toBe(
      'playground-content.json: slots[0].x = -0.1 is out of range [0, Infinity]',
    );
  });

  it('names an extra property', () => {
    const file: Record<string, unknown> = validFile();
    file['note'] = 'extra';
    expect(messageOf(file)).toBe('playground-content.json: (root) has an extra property "note"');

    const slot = { x: 0.2, y: 0.5, z: 1 };
    expect(messageOf({ targetCount: 3, slots: [slot] })).toBe(
      'playground-content.json: slots[0] has an extra property "z"',
    );
  });

  it('rejects a slot list outside 1 to 64 items', () => {
    expect(messageOf({ targetCount: 3, slots: [] })).toBe(
      'playground-content.json: slots has 0 items, but it needs from 1 to 64',
    );
  });
});
