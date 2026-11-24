// The session machine (garden-level design 2.6; requirements 1, 2.7, 9.3, 9.4; steering 7). A pure reducer:
// stepSession(state, event, input) returns the next state and the effects of that step. It reads no clock and
// no randomness, and it knows nothing about what a stage contains. Time arrives as input.dtMs, the session
// delta. The suspension flags also stop time here, so the machine does not depend on the driver sending zero.
//
// A step does at most one transition. It checks its event first. A step that makes a transition adds no time.
// Otherwise the timed phases (ENTERING, CELEBRATING, TRAVELLING) advance.
import type { MotionLevel } from 'marrow/core';
import {
  createTravel,
  startTravel,
  stepTravel,
  TUNING as WORLD_TUNING,
  validateSegment,
  type SegmentKind,
  type SegmentSpec,
  type TravelSegment,
  type TravelState,
} from 'world-view';
import { ROUTE, TITLE_OF, type JourneyId, type StageId, type TitleId } from './stageOrder';
import { APP_SESSION_TUNING } from './tuning';

export type Phase = 'SETUP' | 'CALIBRATING' | 'ENTERING' | 'PLAYING' | 'CELEBRATING' | 'TRAVELLING' | 'BLOOM' | 'SAVED';

/** The two suspension flags, read from the input each step (Req 1.4, 1.5). A tracking hold is a flag, not a stage. */
export interface Suspension {
  readonly paused: boolean;
  readonly holdActive: boolean;
}

/** The travel segment of each journey and door. Given to createSession, stored in the state. */
export type JourneySegments = Readonly<Record<JourneyId, TravelSegment>>;

export interface SessionState {
  readonly phase: Phase;
  /** The active stage. Null in SETUP, CALIBRATING, TRAVELLING and SAVED. */
  readonly stage: StageId | null;
  /** Each stage at most once. */
  readonly done: readonly StageId[];
  /** Index into ROUTE: the stage in PLAYING, ENTERING, CELEBRATING and BLOOM, the travel in TRAVELLING. */
  readonly step: number;
  /** Session time left in ENTERING or CELEBRATING. */
  readonly timerMs: number;
  /** The travel in progress, or the last one that arrived. Null before the first travel. */
  readonly travel: TravelState | null;
  /** Given to createSession. The state stays plain data. */
  readonly segments: JourneySegments;
}

export type SessionEvent =
  | { readonly kind: 'setupDone' }
  | { readonly kind: 'calibrated' }
  | { readonly kind: 'startAt'; readonly stage: StageId }
  | { readonly kind: 'stageCompleted'; readonly stage: StageId }
  | { readonly kind: 'endCardShown' };

export interface SessionInput {
  /** The session delta, in ms. Zero or less, and a value that is not finite, add no time. */
  readonly dtMs: number;
  readonly motion: MotionLevel;
  readonly suspension: Suspension;
}

/** Why a completion or another event was refused: the first failed check, in this order. */
export type IgnoreReason = 'phase' | 'stage' | 'done' | 'suspended';

export type SessionEffect =
  | { readonly kind: 'stageActivated'; readonly stage: StageId }
  | { readonly kind: 'rewardStarted'; readonly stage: StageId }
  | { readonly kind: 'travelStarted'; readonly journey: JourneyId }
  | { readonly kind: 'titleShown'; readonly title: TitleId }
  | { readonly kind: 'ignored'; readonly reason: IgnoreReason };

export interface SessionStep {
  readonly state: SessionState;
  readonly effects: readonly SessionEffect[];
}

/** The journeys in ROUTE order of their travels, and whether each is a journey or a door. */
const JOURNEYS: readonly JourneyId[] = ['journeyA', 'journeyB', 'doorHall', 'doorGarden'];
const KIND_OF: Readonly<Record<JourneyId, SegmentKind>> = {
  journeyA: 'journey',
  journeyB: 'journey',
  doorHall: 'door',
  doorGarden: 'door',
};

/** The stage that starts the session. It is the only stage that waits in ENTERING for its title. */
const ENTRY_STAGE: StageId = 'lantern-glade';

/**
 * Builds a session in SETUP. Throws when a journey is missing or when validateSegment rejects one of the
 * segments, because the segments are set at startup and a bad table is a programming error.
 */
export function createSession(segments: JourneySegments): SessionState {
  const issues: string[] = [];
  for (const journey of JOURNEYS) {
    const seg: TravelSegment | undefined = segments[journey];
    if (seg === undefined) {
      issues.push(`${journey} is missing from the journey segments`);
      continue;
    }
    const spec: SegmentSpec = { id: journey, kind: KIND_OF[journey], from: seg.from, to: seg.to, durationMs: seg.durationMs };
    for (const issue of validateSegment(spec, WORLD_TUNING)) issues.push(`${journey}: ${issue.message}`);
  }
  if (issues.length > 0) throw new Error(`invalid journey segments: ${issues.join('; ')}`);
  return {
    phase: 'SETUP',
    stage: null,
    done: [],
    step: 0,
    timerMs: 0,
    travel: null,
    segments: Object.freeze({ ...segments }),
  };
}

/** The effects of a stage becoming active: its activation, and its title when it has one (Req 9.4). */
function activation(stage: StageId): SessionEffect[] {
  const title = TITLE_OF[stage];
  const effects: SessionEffect[] = [{ kind: 'stageActivated', stage }];
  if (title !== undefined) effects.push({ kind: 'titleShown', title });
  return effects;
}

/** The index of a stage in ROUTE. */
function stepOf(stage: StageId): number {
  const index = ROUTE.findIndex((step) => step.kind === 'stage' && step.stage === stage);
  if (index < 0) throw new Error(`stage ${stage} is not on the route`);
  return index;
}

/** The travel at a ROUTE index. The route is fixed, so a travel index that is not a travel is a bug. */
function journeyAt(index: number): JourneyId {
  const step = ROUTE[index];
  if (step === undefined || step.kind !== 'travel') throw new Error(`route index ${index} is not a travel`);
  return step.journey;
}

/** The outcome of a step. `moved` is true when the step made a transition, so its time is dropped. */
interface Outcome {
  readonly state: SessionState;
  readonly effects: readonly SessionEffect[];
  readonly moved: boolean;
}

const stay = (state: SessionState, effects: readonly SessionEffect[] = []): Outcome => ({ state, effects, moved: false });
const move = (state: SessionState, effects: readonly SessionEffect[] = []): Outcome => ({ state, effects, moved: true });
const refuse = (state: SessionState, reason: IgnoreReason): Outcome => stay(state, [{ kind: 'ignored', reason }]);

/**
 * Starts a stage from SETUP, CALIBRATING or the calibrated event. The session's first stage waits in ENTERING for
 * its title, and any other stage starts in PLAYING, or in BLOOM for bloom (table rows 2, 3).
 */
function begin(state: SessionState, stage: StageId): Outcome {
  const phase: Phase = stage === ENTRY_STAGE ? 'ENTERING' : stage === 'bloom' ? 'BLOOM' : 'PLAYING';
  const timerMs = phase === 'ENTERING' ? APP_SESSION_TUNING.entryTitleMs : 0;
  return move({ ...state, phase, stage, done: [], step: stepOf(stage), timerMs, travel: null }, activation(stage));
}

/** A stage completion (table rows 5 and 6). The first failed check gives the reason. */
function complete(state: SessionState, stage: StageId, input: SessionInput): Outcome {
  if (state.phase !== 'PLAYING' && state.phase !== 'BLOOM') return refuse(state, 'phase');
  if (stage !== state.stage) return refuse(state, 'stage');
  if (state.done.includes(stage)) return refuse(state, 'done');
  if (input.suspension.paused || input.suspension.holdActive) return refuse(state, 'suspended');
  const done = [...state.done, stage];
  const reward: SessionEffect = { kind: 'rewardStarted', stage };
  if (state.phase === 'BLOOM') return move({ ...state, phase: 'SAVED', stage: null, done }, [reward]);
  return move({ ...state, phase: 'CELEBRATING', timerMs: APP_SESSION_TUNING.rewardToTravelMs, done }, [reward]);
}

/** The events of one step (table rows 1 to 3, 5, 6 and 10 and the ignored rows of 11). */
function handleEvent(state: SessionState, event: SessionEvent, input: SessionInput): Outcome {
  switch (event.kind) {
    case 'setupDone':
      return state.phase === 'SETUP' ? move({ ...state, phase: 'CALIBRATING' }) : refuse(state, 'phase');
    case 'calibrated':
      return state.phase === 'CALIBRATING' ? begin(state, ENTRY_STAGE) : refuse(state, 'phase');
    case 'startAt':
      return state.phase === 'SETUP' || state.phase === 'CALIBRATING' ? begin(state, event.stage) : refuse(state, 'phase');
    case 'stageCompleted':
      return complete(state, event.stage, input);
    case 'endCardShown':
      return state.phase === 'SAVED' ? stay(state) : refuse(state, 'phase');
  }
}

/** Leaves CELEBRATING for the travel after the stage (table row 7). */
function startNextTravel(state: SessionState, motion: MotionLevel): Outcome {
  const index = state.step + 1;
  const journey = journeyAt(index);
  const travel = startTravel(createTravel(state.segments[journey]), motion);
  return move({ ...state, phase: 'TRAVELLING', stage: null, timerMs: 0, step: index, travel }, [
    { kind: 'travelStarted', journey },
  ]);
}

/** Advances the travel by the step's time (table rows 8 and 9). Time is frozen by a pause or a hold. */
function advanceTravel(state: SessionState, input: SessionInput, live: boolean): Outcome {
  if (state.travel === null) return stay(state);
  const result = stepTravel(state.travel, { dtMs: input.dtMs, paused: !live, motion: input.motion }, WORLD_TUNING);
  if (!result.events.some((event) => event.kind === 'arrived')) return stay({ ...state, travel: result.state });
  const index = state.step + 1;
  const next = ROUTE[index];
  if (next === undefined) throw new Error(`route index ${index} is past the end`);
  if (next.kind === 'travel') {
    // Journey B ends in front of the hall door. The door travel starts at once, with no stop and no target.
    const travel = startTravel(createTravel(state.segments[next.journey]), input.motion);
    return move({ ...state, step: index, travel }, [{ kind: 'travelStarted', journey: next.journey }]);
  }
  const phase: Phase = next.stage === 'bloom' ? 'BLOOM' : 'PLAYING';
  return move({ ...state, phase, stage: next.stage, step: index, travel: result.state }, activation(next.stage));
}

/**
 * The time of one step, for the phases that run on the session clock. The timers add no time for a delta
 * that is not finite or is 0 or less, and nothing is added while a flag is set.
 */
function advance(state: SessionState, input: SessionInput, live: boolean): Outcome {
  const dt = live && Number.isFinite(input.dtMs) && input.dtMs > 0 ? input.dtMs : 0;
  switch (state.phase) {
    case 'ENTERING': {
      const timerMs = state.timerMs - dt;
      return timerMs > 0 ? stay({ ...state, timerMs }) : move({ ...state, phase: 'PLAYING', timerMs: 0 });
    }
    case 'CELEBRATING': {
      const timerMs = state.timerMs - dt;
      return timerMs > 0 ? stay({ ...state, timerMs }) : startNextTravel(state, input.motion);
    }
    case 'TRAVELLING':
      return advanceTravel(state, input, live);
    default:
      return stay(state);
  }
}

/**
 * One step of the session. The event is handled first. Time advances only when the event made no transition.
 * Each step makes at most one transition.
 */
export function stepSession(state: SessionState, event: SessionEvent | null, input: SessionInput): SessionStep {
  const live = !input.suspension.paused && !input.suspension.holdActive;
  const first = event === null ? stay(state) : handleEvent(state, event, input);
  if (first.moved) return { state: first.state, effects: first.effects };
  const second = advance(first.state, input, live);
  return { state: second.state, effects: [...first.effects, ...second.effects] };
}

/**
 * True when targets may be active: the phase is PLAYING or BLOOM, and travel has arrived (or no travel has
 * started yet). Req 2.7: targets never become active while travelling.
 */
export function targetsActive(state: SessionState): boolean {
  const arrived = state.travel === null || state.travel.phase === 'arrived';
  return (state.phase === 'PLAYING' || state.phase === 'BLOOM') && arrived;
}
