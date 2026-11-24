// The report and the exit code (requirements 19.4, 19.5).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exitCodeFor, formatReport, type RunSummary } from './report';
import type { ProfileName } from './tuning';

const run = (profile: ProfileName, seed: number, completed: boolean, helpStepsUsed = 0, violations: string[] = []): RunSummary => ({
  profile,
  seed,
  completed,
  helpStepsUsed,
  violations,
});

const clean = (profile: ProfileName, seed: number): RunSummary => run(profile, seed, true);

describe('the report (report.ts)', () => {
  it('19.4 formatReport prints completion, help steps, violations and failing seeds (golden text)', () => {
    const runs = [
      clean('baseline', 42),
      clean('baseline', 43),
      run('slow', 42, false),
      run('slow', 43, true, 2, ['one transition per stage: stage-b activated 2 times']),
    ];
    const row = (cells: readonly [string, string, string, string, string]): string =>
      `${cells[0].padEnd(20)}${cells[1].padEnd(12)}${cells[2].padEnd(12)}${cells[3].padEnd(12)}${cells[4]}`;
    const expected = [
      'Simulator: seed 42, 2 runs per profile (seeds 42 to 43).',
      row(['profile', 'completed', 'help steps', 'violations', 'failing seeds']),
      row(['baseline', '2 / 2', '0', '0', 'none']),
      row(['slow', '1 / 2', '2', '1', '42, 43']),
      '  violation (slow, seed 43): one transition per stage: stage-b activated 2 times',
      'Exit 1: 1 violation, 1 run not completed, 4 runs in all.',
    ].join('\n');
    expect(formatReport(runs, 42)).toBe(expected);
  });

  it('19.4 formatReport ends with exit 0 when every run completed with no violation', () => {
    const text = formatReport([clean('baseline', 42), clean('adversarial', 42)], 42);
    expect(text.split('\n').at(-1)).toBe('Exit 0: every run completed and no invariant was violated.');
  });

  it('19.5 exitCodeFor is 0 when every run completed with no violation', () => {
    expect(exitCodeFor([clean('baseline', 42), clean('jitter', 42)])).toBe(0);
  });

  it('19.5 exitCodeFor is 1 when a run did not complete', () => {
    expect(exitCodeFor([clean('baseline', 42), run('jitter', 42, false)])).toBe(1);
  });

  it('19.5 exitCodeFor is 1 when a violation is present', () => {
    expect(exitCodeFor([clean('baseline', 42), run('jitter', 42, true, 0, ['x: y'])])).toBe(1);
  });

  it('19.5 exitCodeFor of no runs is 1', () => {
    expect(exitCodeFor([])).toBe(1);
  });

  it('19.5 exitCodeFor is 0 exactly when every run completed with no violation (300 cases)', () => {
    const runArb = fc.record({
      profile: fc.constant<ProfileName>('baseline'),
      seed: fc.integer({ min: 0, max: 4294967295 }),
      completed: fc.integer({ min: 0, max: 9 }).map((n) => n < 8),
      helpStepsUsed: fc.integer({ min: 0, max: 5 }),
      violations: fc.array(fc.constant('x: y'), { maxLength: 1 }),
    });
    let zeros = 0;
    let ones = 0;
    fc.assert(
      fc.property(fc.array(runArb, { minLength: 1, maxLength: 6 }), (runs) => {
        const expected = runs.every((r) => r.completed && r.violations.length === 0) ? 0 : 1;
        const code = exitCodeFor(runs);
        expect(code).toBe(expected);
        if (code === 0) zeros++;
        else ones++;
      }),
      { numRuns: 300 },
    );
    expect(zeros).toBeGreaterThanOrEqual(20);
    expect(ones).toBeGreaterThanOrEqual(20);
  });
});
