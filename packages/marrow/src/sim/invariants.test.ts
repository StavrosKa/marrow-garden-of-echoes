// The invariant log (requirement 19.5): a held check adds a count, a failed one adds its name and detail, and the
// detail is built only for a failure.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkInvariant, startInvariantLog } from './invariants';

describe('the invariant log (invariants.ts)', () => {
  it('19.5 a held invariant adds one check and no violation', () => {
    const log = checkInvariant(startInvariantLog(), 'one transition per stage', true, () => 'never built');
    expect(log).toEqual({ checks: 1, violations: [] });
  });

  it('19.5 a failed invariant adds its name and detail', () => {
    const log = checkInvariant(startInvariantLog(), 'one transition per stage', false, () => 'stage-b activated 2 times');
    expect(log).toEqual({ checks: 1, violations: ['one transition per stage: stage-b activated 2 times'] });
  });

  it('19.4 the detail is built only for a failed check', () => {
    let built = 0;
    const detail = (): string => {
      built++;
      return 'detail';
    };
    const held = checkInvariant(startInvariantLog(), 'held', true, detail);
    expect(built).toBe(0);
    checkInvariant(held, 'failed', false, detail);
    expect(built).toBe(1);
  });

  it('19.5 a check returns a new log and leaves the old one unchanged', () => {
    const before = startInvariantLog();
    const after = checkInvariant(before, 'x', false, () => 'y');
    expect(before).toEqual({ checks: 0, violations: [] });
    expect(after).not.toBe(before);
  });

  it('19.5 violations are exactly the failed names, in order, and checks count every call (300 cases)', () => {
    const steps = fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.boolean()), { minLength: 0, maxLength: 30 });
    fc.assert(
      fc.property(steps, (sequence) => {
        const log = sequence.reduce(
          (current, [name, holds]) => checkInvariant(current, `inv${name}`, holds, () => `detail${name}`),
          startInvariantLog(),
        );
        const expected = sequence.filter(([, holds]) => !holds).map(([name]) => `inv${name}: detail${name}`);
        expect(log.checks).toBe(sequence.length);
        expect(log.violations).toEqual(expected);
      }),
      { numRuns: 300 },
    );
  });
});
