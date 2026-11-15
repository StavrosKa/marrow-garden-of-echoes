import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

describe('marrow', () => {
  it('runs a test and a property test', () => {
    expect(1 + 1).toBe(2);
    fc.assert(fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a));
  });
});