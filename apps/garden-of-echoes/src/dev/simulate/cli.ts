// The command line of the simulator (garden-level design 5.4; requirements 19.2, 19.5). main reads the arguments,
// checks the profile table, runs every profile `--runs` times starting from `--seed` (run k uses seed + k), prints the
// report and returns the exit code: 0 when every run completed with no violation, 1 when a run did not complete or a
// violation was found, and 2 for invalid arguments or an invalid profile table. Nothing runs when the exit code is 2.
import { exitCodeFor, formatReport, SIM_PROFILES, validateSimTuning, type RunSummary, type SimProfile } from 'marrow/sim';
import { runSession } from './runSession';

/** The seed and the run count of the default invocation, `npm run simulate -- --seed 42 --runs 50`. */
export const DEFAULT_SEED = 42;
export const DEFAULT_RUNS = 50;
/** The step budget of one run (garden-level design 5.2 step 6). */
export const MAX_STEPS = 20000;
/** Seeds are read as unsigned 32-bit integers (marrow/challenges seedRng). */
const MAX_SEED = 4294967295;
const USAGE = 'usage: npm run simulate -- [--seed N] [--runs N]';
const WHOLE_NUMBER = /^\d+$/;

export interface CliArgs {
  readonly seed: number;
  readonly runs: number;
}

export type ParseResult = { readonly ok: true; readonly args: CliArgs } | { readonly ok: false; readonly message: string };

function fail(message: string): ParseResult {
  return { ok: false, message };
}

/** The arguments `--seed N` and `--runs N`, in either order. A missing flag takes its default. */
export function parseArgs(argv: readonly string[]): ParseResult {
  let seed = DEFAULT_SEED;
  let runs = DEFAULT_RUNS;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--seed' && flag !== '--runs') return fail(`unknown argument ${String(flag)}`);
    const value = argv[i + 1];
    if (value === undefined) return fail(`${flag} needs a value`);
    i++;
    if (!WHOLE_NUMBER.test(value)) return fail(`${flag} must be a whole number, found ${value}`);
    const number = Number(value);
    if (flag === '--seed') {
      if (number > MAX_SEED) return fail(`--seed must be at most ${MAX_SEED}, found ${value}`);
      seed = number;
    } else {
      if (number < 1) return fail(`--runs must be at least 1, found ${value}`);
      runs = number;
    }
  }
  return { ok: true, args: { seed, runs } };
}

export interface CliDeps {
  /** Runs one profile from one seed. The default is runSession. */
  readonly run?: (profile: SimProfile, seed: number, options: { readonly maxSteps: number }) => RunSummary;
  /** Prints the report. The default writes to the console. */
  readonly print?: (text: string) => void;
}

/** Runs the simulator for the arguments and returns the exit code. */
export function main(argv: readonly string[], deps: CliDeps = {}): 0 | 1 | 2 {
  const run = deps.run ?? runSession;
  const print = deps.print ?? ((text: string) => console.log(text));
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    console.error(`${parsed.message}\n${USAGE}`);
    return 2;
  }
  const problems = validateSimTuning(SIM_PROFILES);
  if (problems.length > 0) {
    console.error(['The simulator profile table is invalid:', ...problems.map((problem) => `- ${problem}`)].join('\n'));
    return 2;
  }
  const { seed, runs } = parsed.args;
  const results: RunSummary[] = [];
  for (const profile of SIM_PROFILES) {
    for (let k = 0; k < runs; k++) {
      results.push(run(profile, seed + k, { maxSteps: MAX_STEPS }));
    }
  }
  print(formatReport(results, seed));
  return exitCodeFor(results);
}
