// The invariant log of one run (garden-level design 2.5; requirement 19.5). A pure value: each check returns the
// next log. A failed check records its name and a detail line. The detail is a function, so the text is built only
// when the check fails. The simulator owns the checks; this file only keeps the count and the violations.

/** The checks made so far in a run, and the violations among them, in the order they were made. */
export interface InvariantLog {
  readonly checks: number;
  readonly violations: readonly string[];
}

/** A log with no checks and no violations. */
export function startInvariantLog(): InvariantLog {
  return { checks: 0, violations: [] };
}

/** One check. A check that holds adds to the count only. A check that fails adds "name: detail". */
export function checkInvariant(log: InvariantLog, name: string, holds: boolean, detail: () => string): InvariantLog {
  const checks = log.checks + 1;
  if (holds) return { checks, violations: log.violations };
  return { checks, violations: [...log.violations, `${name}: ${detail()}`] };
}
