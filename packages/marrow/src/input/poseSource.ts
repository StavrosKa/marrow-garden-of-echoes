// The one input contract (design section 2.2, Req 3). Camera, pointer and trace
// sources all implement it, and code that consumes frames uses only these members,
// so it cannot tell the sources apart (Req 3.4). It is IO, so it lives here and not
// in the pure core.
import type { PoseFrame } from '../core';

/** The one outcome a start attempt reports (Req 5.2). */
export type StartOutcome = 'ready' | 'denied' | 'no-camera' | 'model-failed';

export interface PoseSource {
  /** Begin producing frames. Resolves with exactly one outcome (Req 5.2). */
  start(): Promise<StartOutcome>;
  /**
   * The newest frame, or null before the first one. Never a queue: a slow consumer
   * sees only the latest frame, older frames are dropped (Req 3.2, 4.2).
   */
  latest(): PoseFrame | null;
  /** Release every resource. Safe to call more than once; later calls do nothing (Req 3.3). */
  dispose(): void;
}
