import { describe, expect, it } from 'vitest';
import { createHelp, helpRadiusForMotorLevel, stepHelp, TUNING, type HelpEvent, type HelpState } from 'marrow/core';
import { snapshotRound } from './roundSnapshot';

// Requirement 12.3: both levels change in the middle of a round, and the round's snapshot does not
// change until the next placement. The changes come from the help reducer itself: each round end
// during a dwell is queued (Req 19.8), and the queue is applied by the first event with no dwell
// and no playback that comes after it.

const DWELL = { dwellActive: true, playbackActive: false };
const IDLE = { dwellActive: false, playbackActive: false };

function run(state: HelpState, events: readonly HelpEvent[]): HelpState {
  return events.reduce((current, event) => stepHelp(current, event).state, state);
}

describe('roundSnapshot', () => {
  it('copies the levels and the radius of the level at placement', () => {
    const snapshot = snapshotRound(createHelp(TUNING), TUNING);
    expect(snapshot).toEqual({
      motorLevel: 0,
      cognitiveLevel: 0,
      radius: helpRadiusForMotorLevel(0, TUNING),
    });
  });

  it('does not change when both levels change mid-round, until the next placement', () => {
    // R0 queues a cognitive raise and R1 queues a motor raise, both during a dwell.
    const queued = run(createHelp(TUNING), [
      { kind: 'roundStarted', steps: 1, ...DWELL },
      { kind: 'difficulty', axis: 'cognitive', ...DWELL },
      { kind: 'difficulty', axis: 'cognitive', ...DWELL },
      { kind: 'roundEnded', motorStepAllowed: true, ...DWELL },
      { kind: 'roundStarted', steps: 1, ...DWELL },
      { kind: 'difficulty', axis: 'motor', ...DWELL },
      { kind: 'difficulty', axis: 'motor', ...DWELL },
      { kind: 'roundEnded', motorStepAllowed: true, ...DWELL },
    ]);
    expect(queued.pending).toEqual(['cognitive', 'motor']);
    expect(queued.motorLevel).toBe(0);
    expect(queued.cognitiveLevel).toBe(0);

    // Round R2 is placed here. The placement is the only read of the levels.
    const placed = run(queued, [{ kind: 'roundStarted', steps: 3, ...DWELL }]);
    const snapshot = snapshotRound(placed, TUNING);
    expect(snapshot).toEqual({ motorLevel: 0, cognitiveLevel: 0, radius: helpRadiusForMotorLevel(0, TUNING) });

    // Mid-round: the first event with no dwell applies the cognitive raise, and the next applies the motor raise.
    const midRound = run(placed, [
      { kind: 'difficulty', axis: 'motor', ...IDLE },
      { kind: 'stepCompleted', ...IDLE },
    ]);
    expect(midRound.cognitiveLevel).toBe(1);
    expect(midRound.motorLevel).toBe(1);
    expect(midRound.pending).toEqual([]);
    expect(midRound.round).not.toBeNull();

    // The snapshot taken at placement is the same object of numbers after both changes.
    expect(snapshot).toEqual({ motorLevel: 0, cognitiveLevel: 0, radius: helpRadiusForMotorLevel(0, TUNING) });
    expect(snapshotRound(midRound, TUNING)).not.toEqual(snapshot);

    // The next placement takes new values, and they show both levels raised.
    const next = run(midRound, [
      { kind: 'roundEnded', motorStepAllowed: false, ...IDLE },
      { kind: 'roundStarted', steps: 1, ...IDLE },
    ]);
    expect(snapshotRound(next, TUNING)).toEqual({
      motorLevel: 1,
      cognitiveLevel: 1,
      radius: helpRadiusForMotorLevel(1, TUNING),
    });
    expect(snapshot.motorLevel).toBe(0);
    expect(snapshot.cognitiveLevel).toBe(0);
  });
});
