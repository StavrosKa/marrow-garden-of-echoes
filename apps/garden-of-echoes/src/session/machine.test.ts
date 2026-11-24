// The session machine, unit tests (design 2.6; Req 1.2 to 1.5, 2.2 to 2.7, 9.3, 9.4, 20.2, 20.3). Each test
// reads its numbers from APP_SESSION_TUNING, the world-view TUNING and the segment table, never from literals.
import type { MotionLevel } from 'marrow/core';
import { TUNING as WORLD_TUNING, validateSegment, type SegmentSpec } from 'world-view';
import { describe, expect, it } from 'vitest';
import {
  createSession,
  stepSession,
  targetsActive,
  type JourneySegments,
  type SessionEffect,
  type SessionEvent,
  type SessionInput,
  type SessionState,
  type Suspension,
} from './machine';
import { ROUTE, STAGE_IDS, type JourneyId, type StageId } from './stageOrder';
import { TEST_SEGMENTS } from './testSegments';
import { APP_SESSION_TUNING } from './tuning';

const FREE: Suspension = { paused: false, holdActive: false };
const PAUSED: Suspension = { paused: true, holdActive: false };
const HELD: Suspension = { paused: false, holdActive: true };
const BOTH: Suspension = { paused: true, holdActive: true };

const ENTRY = APP_SESSION_TUNING.entryTitleMs;
const REWARD = APP_SESSION_TUNING.rewardToTravelMs;
const DUR = (journey: JourneyId): number => TEST_SEGMENTS[journey].durationMs;

function input(dtMs: number, motion: MotionLevel = 'full', suspension: Suspension = FREE): SessionInput {
  return { dtMs, motion, suspension };
}

function run(state: SessionState, event: SessionEvent | null, i: SessionInput = input(0)): { state: SessionState; effects: readonly SessionEffect[] } {
  return stepSession(state, event, i);
}

const complete = (stage: StageId): SessionEvent => ({ kind: 'stageCompleted', stage });

/** Session in SETUP, with the test segments. */
const fresh = (): SessionState => createSession(TEST_SEGMENTS);

/** The lantern glade in PLAYING: calibrated, then the entry title runs out. */
function lanternPlaying(): SessionState {
  let s = run(fresh(), { kind: 'setupDone' }).state;
  s = run(s, { kind: 'calibrated' }).state;
  return run(s, null, input(ENTRY)).state;
}

/** Lantern complete, and the first travel started at the given motion level. */
function lanternTravelling(motion: MotionLevel): SessionState {
  let s = run(lanternPlaying(), complete('lantern-glade')).state;
  s = run(s, null, input(REWARD, motion)).state;
  return s;
}

const stageIndex = (stage: StageId): number => ROUTE.findIndex((step) => step.kind === 'stage' && step.stage === stage);

describe('session machine (machine.test.ts)', () => {
  it('SETUP moves to CALIBRATING on setupDone', () => {
    const r = run(fresh(), { kind: 'setupDone' });
    expect(r.state.phase).toBe('CALIBRATING');
    expect(r.effects).toEqual([]);
  });

  it('calibrated enters lantern-glade with the Lantern Garden title', () => {
    const calibrating = run(fresh(), { kind: 'setupDone' }).state;
    const r = run(calibrating, { kind: 'calibrated' });
    expect(r.state.phase).toBe('ENTERING');
    expect(r.state.stage).toBe('lantern-glade');
    expect(r.state.timerMs).toBe(ENTRY);
    expect(r.effects).toEqual([
      { kind: 'stageActivated', stage: 'lantern-glade' },
      { kind: 'titleShown', title: 'lantern' },
    ]);
  });

  it('startAt skips calibration for each stage id (Req 20.2, 20.3)', () => {
    const expected: Record<StageId, { phase: SessionState['phase']; effects: SessionEffect[] }> = {
      'lantern-glade': {
        phase: 'ENTERING',
        effects: [
          { kind: 'stageActivated', stage: 'lantern-glade' },
          { kind: 'titleShown', title: 'lantern' },
        ],
      },
      'whisper-glade': { phase: 'PLAYING', effects: [{ kind: 'stageActivated', stage: 'whisper-glade' }] },
      'whisper-hall': {
        phase: 'PLAYING',
        effects: [
          { kind: 'stageActivated', stage: 'whisper-hall' },
          { kind: 'titleShown', title: 'hall' },
        ],
      },
      bloom: { phase: 'BLOOM', effects: [{ kind: 'stageActivated', stage: 'bloom' }] },
    };
    for (const stage of STAGE_IDS) {
      const r = run(fresh(), { kind: 'startAt', stage });
      expect(r.state.phase).toBe(expected[stage].phase);
      expect(r.state.stage).toBe(stage);
      expect(r.state.step).toBe(stageIndex(stage));
      expect(r.state.done).toEqual([]);
      expect(r.effects).toEqual(expected[stage].effects);
    }
  });

  it('startAt is accepted in SETUP and CALIBRATING, and ignored after that', () => {
    const calibrating = run(fresh(), { kind: 'setupDone' }).state;
    expect(run(calibrating, { kind: 'startAt', stage: 'whisper-glade' }).state.stage).toBe('whisper-glade');
    const playing = run(fresh(), { kind: 'startAt', stage: 'whisper-glade' }).state;
    const r = run(playing, { kind: 'startAt', stage: 'bloom' });
    expect(r.effects).toEqual([{ kind: 'ignored', reason: 'phase' }]);
    expect(r.state).toEqual(playing);
  });

  it('calibrated and setupDone are ignored outside their phase', () => {
    const r1 = run(fresh(), { kind: 'calibrated' });
    expect(r1.effects).toEqual([{ kind: 'ignored', reason: 'phase' }]);
    expect(r1.state).toEqual(fresh());
    const playing = lanternPlaying();
    const r2 = run(playing, { kind: 'setupDone' });
    expect(r2.effects).toEqual([{ kind: 'ignored', reason: 'phase' }]);
    expect(r2.state).toEqual(playing);
  });

  it('ENTERING lasts entryTitleMs, and then PLAYING starts', () => {
    let s = run(run(fresh(), { kind: 'setupDone' }).state, { kind: 'calibrated' }).state;
    s = run(s, null, input(ENTRY - 1)).state;
    expect(s.phase).toBe('ENTERING');
    const r = run(s, null, input(1));
    expect(r.state.phase).toBe('PLAYING');
    expect(r.state.stage).toBe('lantern-glade');
    expect(r.effects).toEqual([]);
  });

  it('a completion for the active stage in ENTERING is ignored', () => {
    let s = run(run(fresh(), { kind: 'setupDone' }).state, { kind: 'calibrated' }).state;
    const before = s;
    const r = run(s, complete('lantern-glade'));
    expect(r.effects).toEqual([{ kind: 'ignored', reason: 'phase' }]);
    expect(r.state).toEqual(before);
    s = r.state;
    expect(s.phase).toBe('ENTERING');
  });

  it('a completion starts CELEBRATING for rewardToTravelMs, then TRAVELLING', () => {
    const r = run(lanternPlaying(), complete('lantern-glade'));
    expect(r.state.phase).toBe('CELEBRATING');
    expect(r.state.timerMs).toBe(REWARD);
    expect(r.state.done).toEqual(['lantern-glade']);
    expect(r.effects).toEqual([{ kind: 'rewardStarted', stage: 'lantern-glade' }]);

    const almost = run(r.state, null, input(REWARD - 1));
    expect(almost.state.phase).toBe('CELEBRATING');
    expect(almost.state.timerMs).toBe(1);

    const travelling = run(almost.state, null, input(1));
    expect(travelling.state.phase).toBe('TRAVELLING');
    expect(travelling.state.stage).toBeNull();
    expect(travelling.state.step).toBe(1);
    expect(travelling.state.travel?.phase).toBe('travelling');
    expect(travelling.effects).toEqual([{ kind: 'travelStarted', journey: 'journeyA' }]);
  });

  it('the step that ends a celebration adds no time to the travel', () => {
    const r = run(run(lanternPlaying(), complete('lantern-glade')).state, null, input(REWARD + 500));
    expect(r.state.phase).toBe('TRAVELLING');
    expect(r.state.travel?.part?.elapsedMs).toBe(0);
  });

  it('a completion for another stage is ignored with reason stage', () => {
    const playing = lanternPlaying();
    const r = run(playing, complete('whisper-glade'));
    expect(r.effects).toEqual([{ kind: 'ignored', reason: 'stage' }]);
    expect(r.state).toEqual(playing);
  });

  it('a completion for a stage already done is ignored with reason done', () => {
    // startAt resets done, so a random script cannot reach this state. It is built by hand.
    const built: SessionState = { ...fresh(), phase: 'PLAYING', stage: 'lantern-glade', done: ['lantern-glade'], step: 0 };
    const r = run(built, complete('lantern-glade'));
    expect(r.effects).toEqual([{ kind: 'ignored', reason: 'done' }]);
    expect(r.state).toEqual(built);
  });

  it('each suspension flag blocks a completion and leaves the state unchanged (Req 1.4)', () => {
    const playing = lanternPlaying();
    for (const susp of [PAUSED, HELD, BOTH]) {
      const r = run(playing, complete('lantern-glade'), input(0, 'full', susp));
      expect(r.effects).toEqual([{ kind: 'ignored', reason: 'suspended' }]);
      expect(r.state).toEqual(playing);
    }
  });

  it('suspension flags never change the stage (Req 1.5)', () => {
    const playing = run(fresh(), { kind: 'startAt', stage: 'whisper-glade' }).state;
    for (const susp of [PAUSED, HELD, BOTH]) {
      const r = run(playing, null, input(1000, 'full', susp));
      expect(r.state.stage).toBe('whisper-glade');
      expect(r.state.phase).toBe('PLAYING');
    }
  });

  it('paused and held time does not advance entry, celebration or travel', () => {
    // Entry: a pause keeps the timer.
    const entering = run(fresh(), { kind: 'setupDone' }).state;
    const entered = run(entering, { kind: 'calibrated' }).state;
    for (const susp of [PAUSED, HELD]) {
      expect(run(entered, null, input(ENTRY, 'full', susp)).state.timerMs).toBe(ENTRY);
    }
    // Celebration: a hold keeps the timer.
    const celebrating = run(lanternPlaying(), complete('lantern-glade')).state;
    expect(run(celebrating, null, input(REWARD + 500, 'full', HELD)).state.timerMs).toBe(REWARD);
    // Travel: a pause adds no progress; unpaused time then arrives.
    const travelling = lanternTravelling('full');
    const frozen = run(travelling, null, input(DUR('journeyA') + 1000, 'full', PAUSED));
    expect(frozen.state.phase).toBe('TRAVELLING');
    expect(frozen.state.travel?.part?.elapsedMs).toBe(0);
    const arrived = run(frozen.state, null, input(DUR('journeyA') + 1000));
    expect(arrived.state.phase).toBe('PLAYING');
    expect(arrived.state.stage).toBe('whisper-glade');
  });

  it('a dtMs that is not finite or is 0 or less adds no time to ENTERING, CELEBRATING or TRAVELLING', () => {
    const bad = [0, -5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const entered = run(run(fresh(), { kind: 'setupDone' }).state, { kind: 'calibrated' }).state;
    const celebrating = run(lanternPlaying(), complete('lantern-glade')).state;
    const travelling = lanternTravelling('full');
    for (const dt of bad) {
      expect(run(entered, null, input(dt)).state.timerMs).toBe(ENTRY);
      expect(run(celebrating, null, input(dt)).state.timerMs).toBe(REWARD);
      expect(run(travelling, null, input(dt)).state.travel?.part?.elapsedMs).toBe(0);
    }
  });

  it('the target flag is off during travel and turns on at arrival (Req 2.7)', () => {
    const entering = run(run(fresh(), { kind: 'setupDone' }).state, { kind: 'calibrated' }).state;
    expect(targetsActive(entering)).toBe(false);
    const celebrating = run(lanternPlaying(), complete('lantern-glade')).state;
    expect(targetsActive(celebrating)).toBe(false);
    let s = lanternTravelling('full');
    expect(targetsActive(s)).toBe(false);
    s = run(s, null, input(DUR('journeyA') - 1)).state;
    expect(s.phase).toBe('TRAVELLING');
    expect(targetsActive(s)).toBe(false);
    s = run(s, null, input(1)).state;
    expect(s.phase).toBe('PLAYING');
    expect(targetsActive(s)).toBe(true);
  });

  it('Gentle travel lasts 1.3 times the segment, and Reduced is a 1.5 s cross-fade (Req 2.3, 2.4)', () => {
    // Gentle: the segment duration times the Gentle multiplier.
    const gentleEnd = DUR('journeyA') * WORLD_TUNING.gentleTravelMultiplier;
    let s = lanternTravelling('gentle');
    s = run(s, null, input(gentleEnd - 1, 'gentle')).state;
    expect(s.phase).toBe('TRAVELLING');
    expect(run(s, null, input(1, 'gentle')).state.phase).toBe('PLAYING');

    // Reduced: a cross-fade of crossFadeMs, with no scaling of the segment.
    let r = lanternTravelling('reduced');
    r = run(r, null, input(WORLD_TUNING.crossFadeMs - 1, 'reduced')).state;
    expect(r.phase).toBe('TRAVELLING');
    expect(run(r, null, input(1, 'reduced')).state.phase).toBe('PLAYING');
  });

  it('a change to less motion during travel applies at once, and more motion waits', () => {
    const full = lanternTravelling('full');
    expect(run(full, null, input(0, 'reduced')).state.travel?.level).toBe('reduced');
    const gentle = lanternTravelling('gentle');
    expect(run(gentle, null, input(0, 'full')).state.travel?.level).toBe('gentle');
  });

  it('journey B chains into the hall door, and the hall title shows on arrival (Req 2.5, 9.4)', () => {
    let s = run(fresh(), { kind: 'startAt', stage: 'whisper-glade' }).state;
    s = run(s, complete('whisper-glade')).state;
    s = run(s, null, input(REWARD)).state;
    expect(s.travel?.segment.from).toBe(TEST_SEGMENTS.journeyB.from);

    // Journey B arrives in front of the door. The door travel starts in the same phase, with no stop.
    const atDoor = run(s, null, input(DUR('journeyB')));
    expect(atDoor.state.phase).toBe('TRAVELLING');
    expect(atDoor.state.step).toBe(ROUTE.findIndex((step) => step.kind === 'travel' && step.journey === 'doorHall'));
    expect(atDoor.state.travel?.segment.from).toBe(TEST_SEGMENTS.doorHall.from);
    expect(atDoor.effects).toEqual([{ kind: 'travelStarted', journey: 'doorHall' }]);
    expect(targetsActive(atDoor.state)).toBe(false);

    // The door arrives at the hall: the hall activates and its title shows.
    const hall = run(atDoor.state, null, input(DUR('doorHall')));
    expect(hall.state.phase).toBe('PLAYING');
    expect(hall.state.stage).toBe('whisper-hall');
    expect(hall.effects).toEqual([
      { kind: 'stageActivated', stage: 'whisper-hall' },
      { kind: 'titleShown', title: 'hall' },
    ]);
  });

  it('bloom completion moves to SAVED, and endCardShown changes nothing (Req 9.3)', () => {
    const bloom = run(fresh(), { kind: 'startAt', stage: 'bloom' }).state;
    expect(bloom.phase).toBe('BLOOM');
    const saved = run(bloom, complete('bloom'));
    expect(saved.state.phase).toBe('SAVED');
    expect(saved.state.stage).toBeNull();
    expect(saved.state.done).toEqual(['bloom']);
    expect(saved.effects).toEqual([{ kind: 'rewardStarted', stage: 'bloom' }]);
    const shown = run(saved.state, { kind: 'endCardShown' });
    expect(shown.state).toEqual(saved.state);
    expect(shown.effects).toEqual([]);
    expect(run(lanternPlaying(), { kind: 'endCardShown' }).effects).toEqual([{ kind: 'ignored', reason: 'phase' }]);
  });

  it('a scripted run reaches SAVED through all four stages (Req 1.2)', () => {
    const all: SessionEffect[] = [];
    const step = (s: SessionState, event: SessionEvent | null, i: SessionInput): SessionState => {
      const r = run(s, event, i);
      all.push(...r.effects);
      return r.state;
    };
    let s = step(fresh(), { kind: 'setupDone' }, input(0));
    s = step(s, { kind: 'calibrated' }, input(0));
    s = step(s, null, input(ENTRY));
    s = step(s, complete('lantern-glade'), input(0));
    s = step(s, null, input(REWARD));
    s = step(s, null, input(DUR('journeyA')));
    s = step(s, complete('whisper-glade'), input(0));
    s = step(s, null, input(REWARD));
    s = step(s, null, input(DUR('journeyB')));
    s = step(s, null, input(DUR('doorHall')));
    s = step(s, complete('whisper-hall'), input(0));
    s = step(s, null, input(REWARD));
    s = step(s, null, input(DUR('doorGarden')));
    expect(s.phase).toBe('BLOOM');
    s = step(s, complete('bloom'), input(0));
    expect(s.phase).toBe('SAVED');
    const activated = all.flatMap((e) => (e.kind === 'stageActivated' ? [e.stage] : []));
    expect(activated).toEqual(['lantern-glade', 'whisper-glade', 'whisper-hall', 'bloom']);
    const travels = all.flatMap((e) => (e.kind === 'travelStarted' ? [e.journey] : []));
    expect(travels).toEqual(['journeyA', 'journeyB', 'doorHall', 'doorGarden']);
    expect(all.filter((e) => e.kind === 'ignored')).toEqual([]);
  });

  it('createSession stores the segments and starts in SETUP', () => {
    const s = fresh();
    expect(s.phase).toBe('SETUP');
    expect(s.segments).toEqual(TEST_SEGMENTS);
  });

  it('createSession rejects a segment table with a missing journey', () => {
    const withoutB = Object.fromEntries(Object.entries(TEST_SEGMENTS).filter(([key]) => key !== 'journeyB'));
    expect(() => createSession(withoutB as unknown as JourneySegments)).toThrow(/journeyB/);
  });

  it('createSession rejects a segment that validateSegment rejects', () => {
    const shortJourney: JourneySegments = { ...TEST_SEGMENTS, journeyA: { from: 0, to: 8, durationMs: 1000 } };
    expect(() => createSession(shortJourney)).toThrow(/journeyA/);
    const badDoor: JourneySegments = { ...TEST_SEGMENTS, doorHall: { from: 16, to: 17, durationMs: DUR('doorHall') + 1 } };
    expect(() => createSession(badDoor)).toThrow(/doorHall/);
  });

  it('the test fixture segments pass validateSegment with the world-view TUNING', () => {
    const journeys: JourneyId[] = ['journeyA', 'journeyB', 'doorHall', 'doorGarden'];
    for (const journey of journeys) {
      const kind = journey.startsWith('door') ? 'door' : 'journey';
      const seg = TEST_SEGMENTS[journey];
      const spec: SegmentSpec = { id: journey, kind, from: seg.from, to: seg.to, durationMs: seg.durationMs };
      expect(validateSegment(spec, WORLD_TUNING)).toEqual([]);
    }
  });
});
