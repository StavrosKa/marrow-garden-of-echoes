// The presence and session clocks (design section 3, Requirement 16). Time reaches
// the core only as these deltas, which the caller computes from its own frame
// timestamps; nothing in the core reads a clock itself (Req 16.8). The driver calls
// the two stages on either side of stepTracking, so the session delta sees the hold
// of the same step.
import type { Tuning } from './tuning';

/** The suspensions that stop the presence clock: Pause and a hidden tab. */
export interface PresenceFlags {
  readonly paused: boolean;
  readonly hidden: boolean;
}

/** The presence flags plus a tracking hold, which stops only the session clock. */
export interface ClockFlags extends PresenceFlags {
  readonly holdActive: boolean;
}

/** The two deltas of one step, in milliseconds. */
export interface ClockDeltas {
  readonly presenceDt: number;
  readonly sessionDt: number;
}

/**
 * Stage 1 (Req 16.2, 16.3): the raw frame delta clamped to 0..maxClockStepMs. A
 * negative or non-finite delta counts as 0, and every delta counts as 0 while paused
 * or hidden.
 */
export function presenceDelta(rawDtMs: number, flags: PresenceFlags, tuning: Tuning): number {
  if (flags.paused || flags.hidden) return 0;
  if (!Number.isFinite(rawDtMs) || rawDtMs <= 0) return 0;
  return Math.min(rawDtMs, tuning.maxClockStepMs);
}

/** Stage 2 (Req 16.4, 16.5): 0 during a tracking hold, otherwise the presence delta. */
export function sessionDelta(presenceDt: number, holdActive: boolean): number {
  return holdActive ? 0 : presenceDt;
}

/** Both stages for one step whose hold is already known (Req 16.1). */
export function stepClocks(rawDtMs: number, flags: ClockFlags, tuning: Tuning): ClockDeltas {
  const presenceDt = presenceDelta(rawDtMs, flags, tuning);
  return { presenceDt, sessionDt: sessionDelta(presenceDt, flags.holdActive) };
}
