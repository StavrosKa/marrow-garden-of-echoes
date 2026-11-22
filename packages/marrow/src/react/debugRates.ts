// The rate of events over the debug window (Requirement 25.2), as a pure function of the times the
// frame driver recorded. The window is the half-open interval (nowMs - windowMs, nowMs]: a time
// exactly windowMs old is outside it, and a time after nowMs is not counted yet.
/** Milliseconds per second: the unit a rate is given in. */
const MS_PER_SECOND = 1000;

/**
 * The number of events per second in the window ending at nowMs. The count is the events whose time
 * falls in (nowMs - windowMs, nowMs], scaled to one second. A window of zero or less gives 0.
 */
export function ratePerSecond(timesMs: readonly number[], nowMs: number, windowMs: number): number {
  if (!(windowMs > 0)) return 0;
  let count = 0;
  for (const time of timesMs) {
    if (time > nowMs - windowMs && time <= nowMs) count += 1;
  }
  return (count * MS_PER_SECOND) / windowMs;
}
