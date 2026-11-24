// The help parameters of one round, read once when the round is placed (Requirement 12.1, 12.2;
// design 2.8). This is the only app file that reads HelpState.motorLevel or cognitiveLevel.
import { helpRadiusForMotorLevel, type HelpState, type Tuning } from 'marrow/core';

/** The values of one round. Consumers read only `radius`; the levels are kept for tests and the read scan (Req 12). */
export interface RoundSnapshot {
  readonly motorLevel: number;
  readonly cognitiveLevel: number;
  readonly radius: number;
}

/**
 * The snapshot of the help state at placement. It copies the numbers, so a later change to `help`
 * (a deferred change of Req 19.8 applied in the round) does not reach the result.
 */
export function snapshotRound(help: HelpState, tuning: Tuning): RoundSnapshot {
  const motorLevel = help.motorLevel;
  const cognitiveLevel = help.cognitiveLevel;
  return { motorLevel, cognitiveLevel, radius: helpRadiusForMotorLevel(motorLevel, tuning) };
}
