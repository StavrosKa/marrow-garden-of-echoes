// The per-frame glue of a garden session (garden-level design 2.7, 3 steps 5 to 8; requirements 1.4, 5, 7, 8, 12.1,
// 19). Pure: stepGarden takes the state and one frame, and returns the next state and the effects. The clocks, the
// pointers and the browser stay outside, in the UI. The driver keeps no timer of its own (Req 7.7).
//
// Help reads: the help levels are read once per round, by placeRound at the round's placement (Req 12.1). The driver
// keeps the placement and never reads the levels again, so a change during a round does not reach it. A round is a
// lantern round, a whisper spirit round, or the path choice of Whisper Glade (a second round with its own placement).
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
  type MotionLevel,
  type PointerInput,
  type Tuning,
  type Vec2,
} from 'marrow/core';
import { ATTENTION_TUNING, seedRng, type AttentionEvent, type Rng } from 'marrow/challenges';
import { targetScreen, TUNING as WORLD_TUNING, type ProjectionFrame, type View, type WorldPoint } from 'world-view';
import { INTERACTION_LAYER } from '../scene/forestLayers';
import { LANTERN_COUNT, type LanternGladeContent } from '../stages/lantern-glade/content';
import { activeLanternIds, createLanternGlade, lineKey as lanternLineKey, stepLanternGlade, targetIdOf, type LanternState } from '../stages/lantern-glade/rules';
import { placeRound, type PlaceRoundInput, type PlacedRound } from '../stages/shared/placeRound';
import type { PlaceholderContent, SlotSpec } from '../stages/shared/placeholderContent';
import { createPlaceholder, stepPlaceholder, type PlaceholderState } from '../stages/shared/placeholderRule';
import type { WhisperGladeContent } from '../stages/whisper-glade/content';
import { PATH_TARGET_IDS, type PathOption } from '../stages/whisper-glade/pathChoice';
import {
  lineKey as whisperLineKey,
  presentedTargetId,
  spiritTargetId,
  startWhisperGlade,
  stepWhisperGlade,
  type WhisperState,
} from '../stages/whisper-glade/rules';
import { createSession, stepSession, targetsActive, type JourneySegments, type SessionEffect, type SessionEvent, type SessionState, type Suspension } from './machine';
import type { StageId } from './stageOrder';

/** Motor steps are allowed in every round of this spec, so the motor axis can rise when a round has enough difficulties. */
const MOTOR_STEP_ALLOWED = true;
/** The seed of a session when the caller gives none. Tests and the simulator pass their own (Req 19). */
export const DEFAULT_SEED = 42;

/** The stages that are placeholders in this spec: each has one target and its own content (design 4.1). */
export type PlaceholderStageId = 'whisper-hall' | 'bloom';

/** The shape that marks a whisper target: a blue drop or a gold leaf (Req 5.6), or one of the two path options (Req 8.1). */
export type WhisperShape = 'drop' | 'leaf' | PathOption;

/** One target of Whisper Glade: its id, its point on the interaction layer (the same object placeRound returns) and its shape. */
export interface WhisperTarget {
  readonly id: string;
  readonly point: WorldPoint;
  readonly shape: WhisperShape;
}

export interface GardenContent {
  readonly lantern: LanternGladeContent;
  readonly whisper: WhisperGladeContent;
  readonly placeholders: Readonly<Record<PlaceholderStageId, PlaceholderContent>>;
}

/** The comfort of the wrists that serve the input, and the frame it is measured in (Req 20.3). */
export interface PlacementReach {
  readonly grids: PlaceRoundInput['grids'];
  readonly activeWrists: PlaceRoundInput['activeWrists'];
  readonly mapping: PlaceRoundInput['mapping'];
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
  | {
      readonly kind: 'whisper';
      readonly id: 'whisper-glade';
      readonly rule: WhisperState;
      /** The spirit and path targets, each with the point it is placed at. The placement holds the same point objects. */
      readonly targets: readonly WhisperTarget[];
      readonly round: number;
    }
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
  /** The number of rounds placed. */
  readonly rounds: number;
  /** The seeded generator of the session. It orders the whisper blocks (Req 5.5), and it is kept in the state (Req 19). */
  readonly rng: Rng;
}

/** One frame of input. The times are the clocks' outputs (Req 7.7): the driver adds no time of its own. */
export interface GardenFrame {
  readonly event: SessionEvent | null;
  /** The presence delta, for the dwell timers (Req 16.1). */
  readonly presenceDt: number;
  /** The session delta, for travel and the stage rules (design 3 step 2). */
  readonly sessionDt: number;
  readonly motion: MotionLevel;
  readonly suspension: Suspension;
  /** This frame's pointers for dwell. A pointer that is not valid counts as an invalid pointer (marrow Req 17.3). */
  readonly pointers: readonly PointerInput[];
  /** "Continue with help" was pressed this frame. Nothing in the UI sets it yet (Pause is task 11). */
  readonly helpRequested?: boolean;
}

export type GardenEffect =
  | { readonly kind: 'session'; readonly effect: SessionEffect }
  | { readonly kind: 'lanternLit'; readonly index: number; readonly note: string }
  | { readonly kind: 'attention'; readonly event: AttentionEvent }
  | { readonly kind: 'pathChosen'; readonly option: PathOption }
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

/** A session at SETUP, with no stage, no dwell, the default help levels and the seeded generator. */
export function createGarden(segments: JourneySegments, seed: number = DEFAULT_SEED, tuning: Tuning = TUNING): GardenState {
  return {
    session: createSession(segments),
    help: createHelp(tuning),
    dwell: createDwell(tuning),
    stage: null,
    placed: null,
    dwellActive: false,
    playback: false,
    rounds: 0,
    rng: seedRng(seed),
  };
}

/** The view of a frame: the session's travel distance, with the head at rest (the head is not wired in this task). */
function viewOf(session: SessionState): View {
  return { travel: session.travel?.distance ?? 0, head: { x: 0, y: 0 } };
}

/** An authored slot as a point of the interaction layer (the layer of the forest table). */
function interactionPoint(slot: SlotSpec): WorldPoint {
  return {
    x: slot.x,
    y: slot.y,
    depth: INTERACTION_LAYER.depth,
    anchor: INTERACTION_LAYER.anchor,
    factor: WORLD_TUNING.interactionFactor,
  };
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
 * The one placement of a round (design 2.8). It reads the help levels through placeRound, and nowhere else. The points
 * are the caller's objects, and placeRound returns the same objects, so a target finds its place by identity.
 */
function placeOn(env: GardenEnv, state: GardenState, points: readonly WorldPoint[], n: number): PlacedRound {
  return placeRound({
    worldSlots: points,
    n,
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
}

/** The targets of Whisper Glade: the two spirits at their slots, then the two path options at theirs. */
function whisperTargetsOf(content: WhisperGladeContent): WhisperTarget[] {
  const spirits = content.spirits.flatMap((spirit, index) => {
    const slot = content.spiritSlots[index];
    return slot === undefined ? [] : [{ id: spiritTargetId(spirit.stem), point: interactionPoint(slot), shape: spirit.shape }];
  });
  return [
    ...spirits,
    { id: PATH_TARGET_IDS.fireflies, point: interactionPoint(content.pathSlots.fireflies), shape: 'fireflies' as const },
    { id: PATH_TARGET_IDS.candles, point: interactionPoint(content.pathSlots.candles), shape: 'candles' as const },
  ];
}

/** The spirit targets of a whisper stage (the ones that are not path options). */
function spiritTargetsOf(targets: readonly WhisperTarget[]): WhisperTarget[] {
  return targets.filter((target) => target.shape === 'drop' || target.shape === 'leaf');
}

/** The path targets of a whisper stage. */
function pathTargetsOf(targets: readonly WhisperTarget[]): WhisperTarget[] {
  return targets.filter((target) => target.shape === 'fireflies' || target.shape === 'candles');
}

/**
 * Starts the stage of a `stageActivated` effect (design 3 step 5). A lantern stage is placed here through placeRound, and
 * a whisper stage places its two spirits in the same way. The placement is kept for the round (Req 12.1). That is the
 * only read of the help levels for a round.
 */
function activate(env: GardenEnv, state: GardenState, id: StageId, frame: GardenFrame, effects: GardenEffect[]): GardenState {
  const round = state.rounds + 1;
  if (id === 'lantern-glade') {
    const placed = placeOn(env, state, env.content.lantern.slots.map(interactionPoint), LANTERN_COUNT);
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
  if (id === 'whisper-glade') {
    const content = env.content.whisper;
    const targets = whisperTargetsOf(content);
    const started = startWhisperGlade(content, state.rng, frame.motion);
    const spirits = spiritTargetsOf(targets).map((target) => target.point);
    const placed = placeOn(env, state, spirits, spirits.length);
    if (placed.kind === 'none') {
      effects.push({ kind: 'noSlot' });
      return { ...state, stage: null, placed: null, rounds: round, rng: started.rng };
    }
    return {
      ...state,
      stage: { kind: 'whisper', id, rule: started.state, targets, round },
      placed,
      rounds: round,
      rng: started.rng,
    };
  }
  const content = env.content.placeholders[id];
  return {
    ...state,
    stage: { kind: 'placeholder', id, rule: createPlaceholder(content), copy: content.target.copy, round },
    placed: null,
    rounds: round,
  };
}

/**
 * Places the path options, the second round of Whisper Glade (Req 8.1). It runs once, when the attention round ends. The
 * placement reads the help levels through placeRound, as the first round did.
 */
function placePath(env: GardenEnv, state: GardenState, effects: GardenEffect[]): GardenState {
  if (state.stage === null || state.stage.kind !== 'whisper') return state;
  const paths = pathTargetsOf(state.stage.targets).map((target) => target.point);
  const placed = placeOn(env, state, paths, paths.length);
  const rounds = state.rounds + 1;
  if (placed.kind === 'none') {
    effects.push({ kind: 'noSlot' });
    return { ...state, placed: null, rounds };
  }
  return { ...state, placed, rounds };
}

/** The ids of the targets that can be selected now (Req 2.7, 5.3, 8.1). Nothing is selectable before travel stops. */
function activeIdsOf(state: GardenState): string[] {
  const stage = state.stage;
  if (stage === null || !targetsActive(state.session)) return [];
  if (stage.kind === 'lantern') return activeLanternIds(stage.rule);
  if (stage.kind === 'whisper') {
    if (stage.rule.path.phase === 'open') return pathTargetsOf(stage.targets).map((target) => target.id);
    const presented = presentedTargetId(stage.rule);
    return presented === null ? [] : [presented];
  }
  return [];
}

/**
 * The point of an active target and its index in the placement, or null when the target is not placed. A lantern is
 * found by its index; a whisper target is found by the identity of its point (Req 10, 22.4).
 */
function placedTargetOf(state: GardenState, id: string): { point: WorldPoint; index: number } | null {
  const stage = state.stage;
  const placed = state.placed;
  if (stage === null || placed === null) return null;
  if (stage.kind === 'lantern') {
    const index = Number(id.slice('lantern-'.length));
    const point = placed.points[index];
    return point === undefined ? null : { point, index };
  }
  if (stage.kind !== 'whisper') return null;
  const target = stage.targets.find((candidate) => candidate.id === id);
  if (target === undefined) return null;
  const index = placed.points.indexOf(target.point);
  return index < 0 ? null : { point: target.point, index };
}

/**
 * The hit circles of the active targets (design 3 steps 6 and 7). Each circle comes from targetScreen, the function
 * that the drawing uses too, so the hit area and the drawn target cannot differ (steering 10, item 3).
 */
export function activeHitAreas(state: GardenState, frame: ProjectionFrame): HitArea[] {
  if (state.stage === null || state.placed === null) return [];
  const view = viewOf(state.session);
  const areas: HitArea[] = [];
  for (const id of activeIdsOf(state)) {
    const found = placedTargetOf(state, id);
    if (found === null) continue;
    const screen = targetScreen(found.point, state.placed.snapshot.radius, view, frame, WORLD_TUNING);
    if (screen === null) continue;
    areas.push({ targetId: id, activationId: activationOf(state.stage, id), centre: screen.position, radius: screen.radius });
  }
  return areas;
}

/**
 * The activation id of a target (Req 17.13): a new id is a new period in which the target can be selected, and a target
 * is selected once per period. A spirit of Whisper Glade appears once per presentation, and again after each mistake.
 * Its id therefore counts the completed presentations and the mistakes of the current one. Both stay the same for every
 * frame of one appearance. The path options and the lanterns keep the id of their round.
 */
function activationOf(stage: ActiveStage, id: string): string {
  const base = `${id}@${stage.round}`;
  if (stage.kind !== 'whisper' || stage.rule.path.phase !== 'waiting') return base;
  return `${base}:${stage.rule.attention.completed}:${stage.rule.attention.mistakes}`;
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
 * The attention events of one step, in order (design 3 step 8): each event is an effect, and its help events run
 * through the policy right after it. The demonstration flag follows the events (Req 5.3).
 */
function attentionStep(state: GardenState, events: readonly AttentionEvent[], effects: GardenEffect[]): GardenState {
  let next = state;
  for (const event of events) {
    effects.push({ kind: 'attention', event });
    next = { ...next, playback: playbackAfter(event, next.playback) };
    next = helpStep(next, helpEventsOf(event, flagsOf(next)), effects);
  }
  return next;
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

  // Step 5: a stage that activated gets its rule, and its round is placed.
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
  if (stage.kind === 'whisper') {
    // No time and no help request reach the round while a flag is set (Req 1.4).
    const dt = suspended ? 0 : frame.sessionDt;
    const helpRequested = !suspended && frame.helpRequested === true;
    const step = stepWhisperGlade(stage.rule, selections, dt, helpRequested);
    next = { ...next, stage: { ...stage, rule: step.state } };
    next = attentionStep(next, step.events, effects);
    if (stage.rule.path.phase === 'waiting' && step.state.path.phase === 'open') next = placePath(env, next, effects);
    if (step.completed && step.state.path.dressing !== null) {
      effects.push({ kind: 'pathChosen', option: step.state.path.dressing });
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
  if (stage.kind === 'whisper') return whisperLineKey(stage.rule);
  return lanternLineKey(stage.rule);
}

/** One target as it is drawn: its id, its index in the placement, whether it is lit or active, and its screen circle (null when culled). */
export interface DrawnTarget {
  readonly id: string;
  /** The target's shape: a lantern, or a whisper shape (a blue drop, a gold leaf, or a path option). */
  readonly shape: 'lantern' | WhisperShape;
  readonly index: number;
  readonly lit: boolean;
  readonly active: boolean;
  readonly centre: Vec2 | null;
  readonly radius: number;
}

/**
 * The targets of the round in progress, as they are drawn. Each circle is the one the hit test uses (targetScreen), so a
 * player sees the target where it can be selected (steering 10, item 3). A lantern round draws every lantern; a whisper
 * round draws only the targets that can be selected now, so one spirit is shown at a time (Req 5.3).
 */
export function drawnTargetsOf(state: GardenState, frame: ProjectionFrame): DrawnTarget[] {
  const stage = state.stage;
  if (stage === null || state.placed === null) return [];
  const view = viewOf(state.session);
  const radius = state.placed.snapshot.radius;
  if (stage.kind === 'lantern') {
    const active = activeIdsOf(state);
    return state.placed.points.map((point, index) => {
      const id = targetIdOf(index);
      const screen = targetScreen(point, radius, view, frame, WORLD_TUNING);
      return {
        id,
        shape: 'lantern',
        index,
        lit: index < stage.rule.next,
        active: active.includes(id),
        centre: screen?.position ?? null,
        radius: screen?.radius ?? 0,
      };
    });
  }
  if (stage.kind !== 'whisper') return [];
  const active = activeIdsOf(state);
  return active.flatMap((id) => {
    const found = placedTargetOf(state, id);
    const target = stage.targets.find((candidate) => candidate.id === id);
    if (found === null || target === undefined) return [];
    const screen = targetScreen(found.point, radius, view, frame, WORLD_TUNING);
    return [
      {
        id,
        shape: target.shape,
        index: found.index,
        lit: false,
        active: true,
        centre: screen?.position ?? null,
        radius: screen?.radius ?? 0,
      },
    ];
  });
}
