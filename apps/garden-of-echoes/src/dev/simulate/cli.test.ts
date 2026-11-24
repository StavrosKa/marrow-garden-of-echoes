// The command line (requirements 19.2, 19.5). The runner and the printer are injected, so these tests run no session
// except where they say so, and they can set a violation directly.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIM_PROFILES, type RunSummary, type SimProfile } from 'marrow/sim';
import { DEFAULT_RUNS, DEFAULT_SEED, main, parseArgs } from './cli';

type Call = { readonly profile: string; readonly seed: number };

function clean(profile: SimProfile, seed: number): RunSummary {
  return { profile: profile.name, seed, completed: true, helpStepsUsed: 0, violations: [] };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the command line (cli.ts)', () => {
  it('19.2 with no arguments the defaults are seed 42 and 50 runs, the default invocation', () => {
    expect(DEFAULT_SEED).toBe(42);
    expect(DEFAULT_RUNS).toBe(50);
    expect(parseArgs([])).toEqual({ ok: true, args: { seed: 42, runs: 50 } });
  });

  it('19.2 --seed and --runs set the seed and the run count, in either order', () => {
    expect(parseArgs(['--seed', '7', '--runs', '3'])).toEqual({ ok: true, args: { seed: 7, runs: 3 } });
    expect(parseArgs(['--runs', '3', '--seed', '7'])).toEqual({ ok: true, args: { seed: 7, runs: 3 } });
  });

  it('19.2 invalid values exit 2 and run nothing', () => {
    const invalid: readonly (readonly string[])[] = [
      ['--seed', 'abc'],
      ['--runs', '0'],
      ['--runs', '1.5'],
      ['--seed', '-1'],
      ['--seed', '4294967296'],
      ['--seed'],
      ['--bogus', '1'],
    ];
    for (const argv of invalid) {
      const run = vi.fn((profile: SimProfile, seed: number): RunSummary => clean(profile, seed));
      const print = vi.fn();
      expect(main(argv, { run, print })).toBe(2);
      expect(run).not.toHaveBeenCalled();
      expect(print).not.toHaveBeenCalled();
    }
  });

  it('19.2 every profile runs from the base seed, and run k uses seed + k', () => {
    const calls: Call[] = [];
    const run = (profile: SimProfile, seed: number): RunSummary => {
      calls.push({ profile: profile.name, seed });
      return clean(profile, seed);
    };
    main(['--seed', '10', '--runs', '2'], { run, print: () => undefined });
    expect(calls).toHaveLength(SIM_PROFILES.length * 2);
    expect(calls.slice(0, 2)).toEqual([
      { profile: 'baseline', seed: 10 },
      { profile: 'baseline', seed: 11 },
    ]);
  });

  it('19.5 a clean run of every profile prints the report and exits 0', () => {
    const printed: string[] = [];
    const code = main(['--runs', '1'], { run: clean, print: (text) => printed.push(text) });
    expect(code).toBe(0);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain('Exit 0:');
  });

  it('19.5 a violation from a run exits 1, and the report names it', () => {
    const printed: string[] = [];
    const violating = (profile: SimProfile, seed: number): RunSummary => ({
      ...clean(profile, seed),
      violations: ['one transition per stage: bloom activated 2 times'],
    });
    const code = main(['--runs', '1'], { run: violating, print: (text) => printed.push(text) });
    expect(code).toBe(1);
    expect(printed[0]).toContain('violation (baseline, seed 42): one transition per stage: bloom activated 2 times');
    expect(printed[0]).toContain('Exit 1:');
  });

  it('19.5 a run that did not complete exits 1', () => {
    const incomplete = (profile: SimProfile, seed: number): RunSummary => ({ ...clean(profile, seed), completed: false });
    expect(main(['--runs', '1'], { run: incomplete, print: () => undefined })).toBe(1);
  });
});
