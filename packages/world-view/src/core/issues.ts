/** One problem found by a validator: where it is, the value at fault, and one readable line. */
export interface ValidationIssue {
  /** The tuning key or the content path the problem belongs to. */
  path: string;
  /** The value at fault. */
  value: unknown;
  /** One readable line naming the path, the value and the allowed range or relation. */
  message: string;
}

const ZERO = 0;

/** Joins the issues into one block under a title, one line each. Empty when there are none. */
export function formatIssues(title: string, issues: readonly ValidationIssue[]): string {
  if (issues.length === ZERO) return '';
  return [title, ...issues.map((issue) => `- ${issue.message}`)].join('\n');
}
