// The report of a simulator run (garden-level design 2.5 and 5.4; requirement 19.4, 19.5). formatReport returns
// the text and exitCodeFor the exit code. The app script prints the text; this file prints nothing.
import type { ProfileName } from './tuning';

/** The result of one run of one profile. */
export interface RunSummary {
  readonly profile: ProfileName;
  readonly seed: number;
  readonly completed: boolean;
  readonly helpStepsUsed: number;
  readonly violations: readonly string[];
}

const COLUMN = 20;

function pad(text: string, width: number): string {
  return text.padEnd(width);
}

/** The count and the word, with an s after the word unless the count is 1. */
function counted(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** The runs of each profile, in the order each profile first appears. */
function byProfile(runs: readonly RunSummary[]): Map<ProfileName, RunSummary[]> {
  const groups = new Map<ProfileName, RunSummary[]>();
  for (const run of runs) {
    const group = groups.get(run.profile);
    if (group === undefined) groups.set(run.profile, [run]);
    else group.push(run);
  }
  return groups;
}

/**
 * The report: one row per profile with the runs that completed, the help steps used, the violations and the seeds
 * of the failing runs, then one line per violation. `baseSeed` is the seed the run started from (requirement 19.4).
 */
export function formatReport(runs: readonly RunSummary[], baseSeed: number): string {
  const groups = byProfile(runs);
  const perProfile = Math.max(0, ...[...groups.values()].map((group) => group.length));
  const lines: string[] = [
    `Simulator: seed ${baseSeed}, ${perProfile} runs per profile (seeds ${baseSeed} to ${baseSeed + perProfile - 1}).`,
    `${pad('profile', COLUMN)}${pad('completed', 12)}${pad('help steps', 12)}${pad('violations', 12)}failing seeds`,
  ];
  for (const [profile, group] of groups) {
    const completed = group.filter((run) => run.completed).length;
    const helpSteps = group.reduce((sum, run) => sum + run.helpStepsUsed, 0);
    const violations = group.reduce((sum, run) => sum + run.violations.length, 0);
    const failing = group.filter((run) => !run.completed || run.violations.length > 0).map((run) => run.seed);
    lines.push(
      `${pad(profile, COLUMN)}${pad(`${completed} / ${group.length}`, 12)}${pad(String(helpSteps), 12)}${pad(String(violations), 12)}${failing.length === 0 ? 'none' : failing.join(', ')}`,
    );
  }
  for (const run of runs) {
    for (const violation of run.violations) {
      lines.push(`  violation (${run.profile}, seed ${run.seed}): ${violation}`);
    }
  }
  const code = exitCodeFor(runs);
  if (code === 0) {
    lines.push('Exit 0: every run completed and no invariant was violated.');
  } else {
    const notCompleted = runs.filter((run) => !run.completed).length;
    const violations = runs.reduce((sum, run) => sum + run.violations.length, 0);
    lines.push(`Exit 1: ${counted(violations, 'violation')}, ${counted(notCompleted, 'run')} not completed, ${counted(runs.length, 'run')} in all.`);
  }
  return lines.join('\n');
}

/**
 * 0 when there is at least one run and every run completed with no violation. 1 otherwise, including when there are
 * no runs. Argument and table errors are exit 2, and the command line gives that code, not this function.
 */
export function exitCodeFor(runs: readonly RunSummary[]): 0 | 1 {
  if (runs.length === 0) return 1;
  return runs.every((run) => run.completed && run.violations.length === 0) ? 0 : 1;
}
