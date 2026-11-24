// The per-frame glue of a garden session (garden-level design 2.7, 3 steps 5 to 8; requirements 1.4, 7, 12.1, 19).
// Pure: stepGarden takes the state and one frame, and returns the next state and the effects. The clocks, the
// pointers and the browser stay outside, in the UI. The driver keeps no timer of its own (Req 7.7).
//
// Help reads: the help levels are read once per round, by placeRound at the round's placement (Req 12.1). The
// driver keeps the placement and never reads the levels again, so a change during a round does not reach it.
import {
  createDwell,
  createHelp,
  dwellView,
  stepDwell,
  stepHelp,
  TUNING,
  type DwellState,
  type HelpEvent,
  type HelpFlags,
  type HelpOutput,
  type HelpState,
  type HitArea,
  type Mapping,
  type MotionLevel,
  type PointerInput,
  type Tuning,
  type Vec2,
  type WristId,
} from 'marrow/core';
import { ATTENTION_TUNING, type AttentionEvent } from 'marrow/challenges';
import { targetScreen, TUNING as WORLD_TUNING, type ProjectionFrame, type View, type WorldPoint } from 'world-view';
import { INTERACTION_LAYER } from '../scene/forestLayers';
import { LANTERN_COUNT, type LanternGladeContent } from '../stages/lantern-glade/content';
import { activeLanternIds, createLanternGlade, lineKey, stepLanternGlade, targetIdOf, type LanternState } from '../stages/lantern-glade/rules';
import { placeRound, type PlaceRoundInput, type PlacedRound } from '../stages/shared/placeRound';
import type { PlaceholderContent } from '../stages/shared/placeholderContent';
import { createPlaceholder, stepPlaceholder, type PlaceholderState } from '../stages/shared/placeholderRule';
import { createSession, stepSession, targetsActive, type JourneySegments, type SessionEffect, type SessionEvent, type SessionState, type Suspension } from './machine';
import type { StageId } from './stageOrder';

/** Motor steps are allowed in every round of this spec, so the motor axis can rise when a round has enough difficulties. */
const MOTOR_STEP_ALLOWED = true;

/** The stages that are placeholders in this spec: each has one target and its own content (design 4.1). */
export type PlaceholderStageId = Exclude<StageId, 'lantern-glade'>;

export interface GardenContent {
  readonly lantern: LanternGladeContent;
  readonly placeholders: Readonly<Record<PlaceholderStageId, PlaceholderContent>>;
}

/** The comfort of the wrists that serve the input, and the frame it is measured in (Req 20.3). */
export interface PlacementReach {
  readonly grids: PlaceRoundInput['grids'];
  readonly activeWrists: readonly WristId[];
  readonly mapping: Mapping;
  readonly frame: ProjectionFrame;
}

/** What a session needs and does not change during a run. */
export interface GardenEnv {
  readonly content: GardenContent;
  readonly reach: PlacementReach;
}

/** The stage in progress. Each kind keeps its rule and the number of its round, which makes its activation ids. */
export type ActiveStage =
  | { readonly kind: 'lantern'; readonly id: 'lantern-glade'; readonly rule: LanternState; readonly round: number }
  | { readonly kind: 'placeholder'; readonly id: PlaceholderStageId; readonly rule: PlaceholderState; readonly copy: string; readonly round: number };

export interface GardenState {
  readonly session: SessionState;
  readonly help: HelpState;
  readonly dwell: DwellState;
  readonly stage: ActiveStage | null;
  /** The placement of the round in progress, kept until the next round. Null before the first round (Req 12.1). */
  readonly placed: PlacedRound | null;
  /** Whether a pointer holds an active target, from the last step (design 3 step 7, dwellActive). */
  readonly dwellActive: boolean;
  /** True during an attention demonstration, which is not a presentation (design 3 step 8, playbackActive). */
  readonly playback: boolean;
  /** The number of rounds started. */
  readonly rounds: number;
}

/** One frame of input. The times are the clocks' outputs (Req 7.7): the driver adds no time of its own. */
export interface GardenFrame {
  readonly event: SessionEvent | null;
  /** The presence delta, for the dwell timers (Req 16.1). */
  readonly presenceDt: number;
  /** The session delta, for travel and the stage rule (design 3 step 2). */
  readonly sessionDt: number;
  readonly motion: MotionLevel;
  readonly suspension: Suspension;
  /** This frame's pointers for dwell. A pointer that is not valid counts as an invalid pointer (marrow Req 17.3). */
  readonly pointers: readonly PointerInput[];
}

export type GardenEffect =
  | { readonly kind: 'session'; readonly effect: SessionEffect }
  | { readonly kind: 'lanternLit'; readonly index: number; readonly note: string }
  | { readonly kind: 'help'; readonly output: HelpOutput }
  | { readonly kind: 'noSlot' };

export interface GardenStep {
  readonly state: GardenState;
  readonly effects: readonly GardenEffect[];
}

/** The help events of one attention event, in the order design 3 step 8 gives (Req 7, 19.1). */
export function helpEventsOf(event: AttentionEvent, flags: HelpFlags): HelpEvent[] {
  switch (event.kind) {
    case 'presentationStarted':
      return [{ kind: 'roundStarted', steps: 1, ...flags }];
    case 'mistake':
      // A select window that ends without a dwell is a motor difficulty. A dwell on a let-pass is a cognitive one.
      return [{ kind: 'difficulty', axis: event.reason === 'windowEnded' ? 'motor' : 'cognitive', ...flags }];
    case 'presentationCompleted': {
      const finish: HelpEvent = event.byHelp ? { kind: 'continueWithHelp', ...flags } : { kind: 'stepCompleted', ...flags };
      return [finish, { kind: 'roundEnded', motorStepAllowed: MOTOR_STEP_ALLOWED, ...flags }];
    }
    default:
      return [];
  }
}

/** Whether a demonstration is on after an attention event: it starts one, and the next presentation ends it (Req 5.3). */
export function playbackAfter(event: AttentionEvent, previous: boolean): boolean {
  if (event.kind === 'demonstrationStarted') return true;
  if (event.kind === 'presentationStarted' || event.kind === 'roundFinished') return false;
  return previous;
}

/** Runs help events through the policy in order, and returns the new policy state with the outputs. */
export function applyHelp(help: HelpState, events: readonly HelpEvent[]): { help: HelpState; outputs: HelpOutput[] } {
  let state = help;
  const outputs: HelpOutput[] = [];
  for (const event of events) {
    const step = stepHelp(state, event);
    state = step.state;
    outputs.push(...step.outputs);
  }
  return { help: state, outputs };
}

/** A session at SETUP, with no stage, no dwell and the default help levels. */
export function createGarden(segments: JourneySegments, tuning: Tuning = TUNING): GardenState {
  return {
    session: createSession(segments),
    help: createHelp(tuning),
    dwell: createDwell(tuning),
    stage: null,
    placed: null,
    dwellActive: false,
    playback: false,
    rounds: 0,
  };
}

/** The view of a frame: the session's travel distance, with the head at rest (the head is not wired in this task). */
function viewOf(session: SessionState): View {
  return { travel: session.travel?.distance ?? 0, head: { x: 0, y: 0 } };
}

/** Each authored slot as a point of the interaction layer (the layer of the forest table). */
function slotPoints(content: LanternGladeContent): WorldPoint[] {
  return content.slots.map((slot) => ({
    x: slot.x,
    y: slot.y,
    depth: INTERACTION_LAYER.depth,
    anchor: INTERACTION_LAYER.anchor,
    factor: WORLD_TUNING.interactionFactor,
  }));
}

/** The flags that every help event of a frame carries (Req 19.1). */
function flagsOf(state: GardenState): HelpFlags {
  return { dwellActive: state.dwellActive, playbackActive: state.playback };
}

/** Runs help events through the policy and records each output as an effect. */
function helpStep(state: GardenState, events: readonly HelpEvent[], effects: GardenEffect[]): GardenState {
  const step = applyHelp(state.help, events);
  for (const output of step.outputs) effects.push({ kind: 'help', output });
  return { ...state, help: step.help };
}

/**
 * Starts the stage of a `stageActivated` effect (design 3 step 5). A lantern stage is placed here through placeRound,
 * and the placement is kept for the round (Req 12.1). That is the only read of the help levels.
 */
function activate(env: GardenEnv, state: GardenState, id: StageId, frame: GardenFrame, effects: GardenEffect[]): GardenState {
  const round = state.rounds + 1;
  if (id === 'lantern-glade') {
    const placed = placeRound({
      worldSlots: slotPoints(env.content.lantern),
      n: LANTERN_COUNT,
      help: state.help,
      grids: env.reach.grids,
      activeWrists: env.reach.activeWrists,
      mapping: env.reach.mapping,
      view: viewOf(state.session),
      frame: env.reach.frame,
      layer: { depth: INTERACTION_LAYER.depth, anchor: INTERACTION_LAYER.anchor, factor: WORLD_TUNING.interactionFactor },
      bandY: ATTENTION_TUNING.restingBandY,
      core: TUNING,
    });
    if (placed.kind === 'none') {
      effects.push({ kind: 'noSlot' });
      return { ...state, stage: null, placed: null, rounds: round };
    }
    const next: GardenState = {
      ...state,
      stage: { kind: 'lantern', id, rule: createLanternGlade(env.content.lantern, placed, frame.motion), round },
      placed,
      rounds: round,
    };
    return helpStep(next, [{ kind: 'roundStarted', steps: LANTERN_COUNT, ...flagsOf(next) }], effects);
  }
  const content = env.content.placeholders[id];
  return {
    ...state,
    stage: { kind: 'placeholder', id, rule: createPlaceholder(content), copy: content.target.copy, round },
    placed: null,
    rounds: round,
  };
}

/** The ids of the targets that can be selected now. Only the active lantern is, and only after travel has arrived (Req 2.7). */
function activeIdsOf(state: GardenState): string[] {
  const stage = state.stage;
  if (stage === null || stage.kind !== 'lantern' || !targetsActive(state.session)) return [];
  return activeLanternIds(stage.rule);
}

/**
 * The hit circles of the active targets (design 3 steps 6 and 7). Each circle comes from targetScreen, the function
 * that the drawing uses too, so the hit area and the drawn target cannot differ (steering 10, item 3).
 */
export function activeHitAreas(state: GardenState, frame: ProjectionFrame): HitArea[] {
  if (state.stage === null || state.stage.kind !== 'lantern' || state.placed === null) return [];
  const view = viewOf(state.session);
  const areas: HitArea[] = [];
  for (const id of activeIdsOf(state)) {
    const index = Number(id.slice('lantern-'.length));
    const point = state.placed.points[index];
    if (point === undefined) continue;
    const screen = targetScreen(point, state.placed.snapshot.radius, view, frame, WORLD_TUNING);
    if (screen === null) continue;
    areas.push({ targetId: id, activationId: `${id}@${state.stage.round}`, centre: screen.position, radius: screen.radius });
  }
  return areas;
}

/** Sends a stage completion to the session. The session refuses it under a flag or in another phase, and then nothing changes (Req 1.3). */
function complete(
  state: GardenState,
  stage: StageId,
  input: { dtMs: number; motion: MotionLevel; suspension: Suspension },
  effects: GardenEffect[],
): GardenState {
  const step = stepSession(state.session, { kind: 'stageCompleted', stage }, input);
  for (const effect of step.effects) effects.push({ kind: 'session', effect });
  return { ...state, session: step.state };
}

/**
 * One frame of a garden session (design 3 steps 5 to 8). The session takes the event and the time first. A stage that
 * activates is placed. The dwell reads the pointers over the active targets. The stage rule takes the selections, and
 * none of them while a pause or a tracking hold is on (Req 1.4). A completion goes to the session, which decides the
 * transition (Req 1.3).
 */
export function stepGarden(env: GardenEnv, state: GardenState, frame: GardenFrame): GardenStep {
  const effects: GardenEffect[] = [];
  const suspended = frame.suspension.paused || frame.suspension.holdActive;
  const sessionInput = { dtMs: frame.sessionDt, motion: frame.motion, suspension: frame.suspension };

  // Steps 2 and 9: the session takes the event and the time.
  const first = stepSession(state.session, frame.event, sessionInput);
  let next: GardenState = { ...state, session: first.state };
  for (const effect of first.effects) effects.push({ kind: 'session', effect });

  // Step 5: a stage that activated gets its rule, and a lantern round is placed.
  for (const effect of first.effects) {
    if (effect.kind === 'stageActivated') next = activate(env, next, effect.stage, frame, effects);
  }

  // Steps 6 and 7: the dwell over the active targets.
  const dwell = stepDwell(next.dwell, { dt: frame.presenceDt, pointers: frame.pointers, hitAreas: activeHitAreas(next, env.reach.frame) });
  const activeIds = activeIdsOf(next);
  next = { ...next, dwell: dwell.state, dwellActive: activeIds.some((id) => dwellView(dwell.state, id).owner !== null) };
  const selections = suspended ? [] : dwell.events.map((event) => event.targetId);

  // Step 8: the stage rule, while targets are active.
  const stage = next.stage;
  if (stage === null || !targetsActive(next.session)) return { state: next, effects };
  if (stage.kind === 'lantern') {
    const step = stepLanternGlade(stage.rule, selections, frame.sessionDt);
    next = { ...next, stage: { ...stage, rule: step.state } };
    if (step.patch !== null && step.note !== null) {
      effects.push({ kind: 'lanternLit', index: step.patch, note: step.note });
      next = helpStep(next, [{ kind: 'stepCompleted', ...flagsOf(next) }], effects);
    }
    if (step.completed) {
      next = helpStep(next, [{ kind: 'roundEnded', motorStepAllowed: MOTOR_STEP_ALLOWED, ...flagsOf(next) }], effects);
      next = complete(next, stage.id, sessionInput, effects);
    }
    return { state: next, effects };
  }
  const step = stepPlaceholder(stage.rule, selections);
  next = { ...next, stage: { ...stage, rule: step.state } };
  if (step.completed && !stage.rule.done) next = complete(next, stage.id, sessionInput, effects);
  return { state: next, effects };
}

/** The line the player reads now: the stage's copy key, or null when no line is due (Req 14, 15.1). */
export function instructionKeyOf(state: GardenState): string | null {
  const stage = state.stage;
  if (stage === null) return null;
  if (stage.kind === 'placeholder') return stage.copy;
  return lineKey(stage.rule);
}

/** One lantern as it is drawn: its id, whether it is lit or active, and its screen circle (null when culled). */
export interface DrawnTarget {
  readonly id: string;
  readonly index: number;
  readonly lit: boolean;
  readonly active: boolean;
  readonly centre: Vec2 | null;
  readonly radius: number;
}

/**
 * The lanterns of the round in progress, as they are drawn. Each circle is the one the hit test uses (targetScreen),
 * so a player sees the target where it can be selected (steering 10, item 3).
 */
export function drawnTargetsOf(state: GardenState, frame: ProjectionFrame): DrawnTarget[] {
  const stage = state.stage;
  if (stage === null || stage.kind !== 'lantern' || state.placed === null) return [];
  const view = viewOf(state.session);
  const active = activeIdsOf(state);
  return state.placed.points.map((point, index) => {
    const id = targetIdOf(index);
    const screen = targetScreen(point, state.placed?.snapshot.radius ?? 0, view, frame, WORLD_TUNING);
    return {
      id,
      index,
      lit: index < stage.rule.next,
      active: active.includes(id),
      centre: screen?.position ?? null,
      radius: screen?.radius ?? 0,
    };
  });
}
