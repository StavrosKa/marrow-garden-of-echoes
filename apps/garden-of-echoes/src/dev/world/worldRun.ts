// The per-frame data flow of the slice (design 3.1, 3.2, 8.3). Pure: a run is a value, and each step
// returns a new one. The Scene Manager and the DOM sit outside this file.
//
// Order of one frame (stepWorldFrame, steps 1-9 of design 3.1):
//   presence delta, tracking (camera), clocks, Head View, Glide, lock, reward timer and travel, views.
// After the render (afterRender, steps 13-14): the dwell step, and the selections it reports.
//
// Clamping: the frame delta is clamped in marrow's stepClocks, and nowhere else (Req 12.8). Marrow's
// presenceDelta is called only to give the tracking step its presence delta, and it does the same clamp.
import {
  createDwell,
  createHeadView,
  createTracking,
  dwellView,
  presenceDelta,
  stepClocks,
  stepDwell,
  stepHeadView,
  stepTracking,
  TUNING as MARROW_TUNING,
  type DwellState,
  type HeadViewInput,
  type HeadViewPointer,
  type HeadViewState,
  type HitArea,
  type Landmark,
  type MotionLevel,
  type PointerInput,
  type PoseLandmarks,
  type TrackingState,
  type Vec2,
} from 'marrow/core';
import type { SettingsStore } from 'marrow/react';
import {
  createGlide,
  createLock,
  createTravel,
  motionProfile,
  startTravel,
  stepGlide,
  stepLock,
  stepTravel,
  type GlideState,
  type LockMode,
  type LockState,
  type ProjectionFrame,
  type Tuning,
  type TravelPhase,
  type TravelState,
  type TravelStyle,
  type View,
} from 'world-view';
import type { FrameData, HitCircle } from 'world-view/pixi';
import { REWARD_DELAY_MS, TARGET_SELECTED_TOKEN } from './constants';
import { createHeadDriver, setHeadDriver, type HeadDriver } from './headDriver';
import { createNeutral, recordNeutral, requestSetCentre, type NeutralState } from './cameraNeutral';
import type { ThemeToken } from '../../ui/theme';
import type { PlacedStop } from './placementSetup';
import type { ContentSegment, WorldContent } from './worldContent';

const ZERO = 0;
const ONE = 1;
const ACTIVE_WRIST = 'right';
const UNSELECTED_STOP = 0;
const ARRIVED_STOP = 1;

const NOT_VALID: Landmark = { pos: { x: ZERO, y: ZERO }, valid: false };
/** The landmarks of simulated input. Head View reads none of them in that mode. */
const NO_LANDMARKS: PoseLandmarks = {
  leftWrist: NOT_VALID,
  rightWrist: NOT_VALID,
  nose: NOT_VALID,
  leftShoulder: NOT_VALID,
  rightShoulder: NOT_VALID,
};

export type InputMode = 'mouse' | 'camera';

/** What a run is made from: the content, the chosen segment, the placed stops, the settings and the mode. */
export interface RunConfig {
  readonly content: WorldContent;
  readonly tuning: Tuning;
  readonly segment: ContentSegment;
  readonly stops: readonly PlacedStop[];
  readonly settings: SettingsStore;
  readonly mode: InputMode;
}

export interface RewardState {
  /** Session time since both stop-1 targets were selected, while the reward is not yet started. */
  readonly elapsedMs: number;
  readonly started: boolean;
}

export interface WorldRun {
  readonly config: RunConfig;
  /** Counts the restarts; an activation id is `<targetId>@<generation>`. */
  readonly generation: number;
  readonly head: HeadViewState;
  readonly glide: GlideState;
  readonly lock: LockState;
  readonly travel: TravelState;
  readonly dwell: DwellState;
  readonly selected: readonly string[];
  readonly reward: RewardState;
  readonly driver: HeadDriver;
  readonly neutral: NeutralState;
  readonly tracking: TrackingState | null;
  /** The target ids that were active in the last frame. The render step reads them. */
  readonly activeIds: readonly string[];
  /** The presence delta of the last frame. The dwell step reads it. */
  readonly presenceDt: number;
}

/** The head source of one frame: the pointer in simulated input, or the pose of the camera. */
export type HeadInput =
  | { readonly kind: 'pointer'; readonly pointer: HeadViewPointer; readonly playAspect: number }
  | {
      readonly kind: 'camera';
      readonly landmarks: PoseLandmarks;
      readonly wristValid: { readonly left?: boolean; readonly right?: boolean };
      readonly cameraAspect: number;
    };

export interface FrameInputs {
  readonly paused: boolean;
  readonly hidden: boolean;
  /** The projection frame that the Scene Manager built for this frame. */
  readonly frame: ProjectionFrame;
  readonly head: HeadInput;
}

/** What one frame computed, for the debug snapshot and the tests (design 8.2). */
export interface FrameReport {
  readonly rawDt: number;
  readonly presenceDt: number;
  readonly sessionDt: number;
  readonly paused: boolean;
  readonly hidden: boolean;
  readonly hold: boolean;
  readonly level: MotionLevel;
  readonly headOut: Vec2;
  readonly driverOn: boolean;
  readonly driverValue: Vec2;
  readonly view: View;
  readonly interactionHead: Vec2;
  readonly decorativeHead: Vec2;
  readonly lockRequested: boolean;
  readonly lockMode: LockMode;
  readonly travelPhase: TravelPhase;
  readonly travelStyle: TravelStyle | null;
  readonly travelLevel: MotionLevel;
  readonly progress: number;
  readonly cover: number;
  readonly remainingMs: number;
  readonly rewardMs: number;
  readonly rewardStarted: boolean;
  readonly frame: ProjectionFrame;
  readonly shown: readonly string[];
  readonly active: readonly string[];
}

export interface WorldStep {
  readonly run: WorldRun;
  readonly frame: FrameData;
  readonly report: FrameReport;
}

/** A selection (Req 12.7): the target to colour with `colour`, and that colour token. */
export interface SelectionEvent {
  readonly kind: 'selected';
  readonly targetId: string;
  readonly colour: ThemeToken;
}

export interface RenderStep {
  readonly run: WorldRun;
  readonly events: readonly SelectionEvent[];
}

/** The ids of the targets of one stop, in placement order. */
export function stopTargetIds(config: RunConfig, stopIndex: number): string[] {
  return (config.stops[stopIndex]?.targets ?? []).map((target) => target.id);
}

/** The active targets of a phase (design 3.2): stop 1 while idle, stop 2 after arrival, none while travelling. */
function activeFor(config: RunConfig, phase: TravelPhase, selected: readonly string[]): string[] {
  if (phase === 'travelling') return [];
  const stopIndex = phase === 'arrived' ? ARRIVED_STOP : UNSELECTED_STOP;
  return stopTargetIds(config, stopIndex).filter((id) => !selected.includes(id));
}

/** The targets that are active now, read from the run's state. */
export function activeTargets(run: WorldRun): readonly string[] {
  return activeFor(run.config, run.travel.phase, run.selected);
}

/** Whether a pointer owns one of the given targets: the lock is requested while this holds (Req 6.1). */
export function dwellInProgress(state: DwellState, activeIds: readonly string[]): boolean {
  return activeIds.some((id) => dwellView(state, id).owner !== null);
}

function freshRun(config: RunConfig, generation: number, driver: HeadDriver, neutral: NeutralState, tracking: TrackingState | null): WorldRun {
  const { segment } = config;
  return {
    config,
    generation,
    head: createHeadView(),
    glide: createGlide(),
    lock: createLock(),
    travel: createTravel({ from: segment.from, to: segment.to, durationMs: segment.durationMs }),
    dwell: createDwell(MARROW_TUNING),
    selected: [],
    reward: { elapsedMs: ZERO, started: false },
    driver,
    neutral,
    tracking,
    activeIds: [],
    presenceDt: ZERO,
  };
}

/** A run at the first stop with clean states. Camera mode also starts the tracking lifecycle. */
export function createWorldRun(config: RunConfig): WorldRun {
  const tracking =
    config.mode === 'camera'
      ? createTracking({ activeWrists: [ACTIVE_WRIST], mode: 'camera', tuning: MARROW_TUNING })
      : null;
  return freshRun(config, ZERO, createHeadDriver(), createNeutral(), tracking);
}

/**
 * Restart (Req 13.6): new view, glide, lock, travel, dwell and selection states, back at stop 1, and a
 * new activation id for every target. The driver, the neutral head and the tracking lifecycle are kept.
 */
export function restartRun(run: WorldRun): WorldRun {
  return freshRun(run.config, run.generation + ONE, run.driver, run.neutral, run.tracking);
}

/** The programmatic head driver (Req 12.10): `head` turns it on, null turns it off. */
export function setRunHeadDriver(run: WorldRun, head: Vec2 | null): WorldRun {
  return { ...run, driver: setHeadDriver(run.driver, head) };
}

/** "Set centre" (Req 14.4): the next qualifying frame records the neutral head again. */
export function requestRunSetCentre(run: WorldRun): WorldRun {
  return { ...run, neutral: requestSetCentre(run.neutral) };
}

/** Steps 1-9 of design 3.1 for one rendered frame. `rawDt` is the raw frame delta; nothing here clamps it. */
export function stepWorldFrame(run: WorldRun, rawDt: number, inputs: FrameInputs): WorldStep {
  const { config } = run;
  const wv = config.tuning;
  const { head } = inputs;

  // Steps 1 and 3: the presence delta gives the tracking step its time, and the hold of this step comes
  // from the tracking lifecycle (camera mode only).
  const preDt = presenceDelta(rawDt, { paused: inputs.paused, hidden: inputs.hidden }, MARROW_TUNING);
  let tracking = run.tracking;
  let holdActive = false;
  if (head.kind === 'camera' && tracking !== null) {
    const trackingStep = stepTracking(
      tracking,
      { wristValid: head.wristValid, noseValid: head.landmarks.nose.valid, calibrating: false },
      preDt,
    );
    tracking = trackingStep.state;
    holdActive = trackingStep.holdActive;
  }

  // Steps 1 and 4: both clocks come from marrow's stepClocks, with the hold of this step.
  const clocks = stepClocks(rawDt, { paused: inputs.paused, hidden: inputs.hidden, holdActive }, MARROW_TUNING);
  const { presenceDt, sessionDt } = clocks;

  // Step 2: Head View is stepped in both modes, and the driver replaces its output only while it is on.
  let neutral = run.neutral;
  let headInput: HeadViewInput;
  if (head.kind === 'camera') {
    neutral = recordNeutral(neutral, head.landmarks, head.cameraAspect);
    headInput = {
      mode: 'camera',
      tuning: MARROW_TUNING,
      landmarks: head.landmarks,
      frameAspect: head.cameraAspect,
      neutral: neutral.neutral,
      skip: false,
    };
  } else {
    headInput = {
      mode: 'simulated',
      tuning: MARROW_TUNING,
      landmarks: NO_LANDMARKS,
      frameAspect: head.playAspect,
      neutral: null,
      skip: false,
      pointer: head.pointer,
      playAspect: head.playAspect,
    };
  }
  const headStep = stepHeadView(run.head, headInput, presenceDt);
  const headOut = run.driver.on ? run.driver.value : headStep.offset;

  // Step 5: the motion level comes from the settings store, and reaches the head only through the target.
  const level = config.settings.get().motion;
  const profile = motionProfile(level, wv);
  const target: Vec2 = { x: headOut.x * profile.headMultiplier, y: headOut.y * profile.headMultiplier };

  // Step 6: the glide.
  const glide = stepGlide(run.glide, target, presenceDt, wv);

  // Step 7: lockRequested comes from the dwell state after the previous frame (design 3.2).
  const activeBefore = activeTargets(run);
  const lockRequested = dwellInProgress(run.dwell, activeBefore);
  const lockStep = stepLock(run.lock, { liveHead: glide.out, lockRequested }, presenceDt, wv);

  // Step 8: the reward timer on the session clock, then the travel. The frame that starts the travel
  // steps it with dtMs 0.
  const stopOneIds = stopTargetIds(config, UNSELECTED_STOP);
  const bothSelected = stopOneIds.every((id) => run.selected.includes(id));
  const waiting = bothSelected && !run.reward.started;
  const rewardMs = waiting ? run.reward.elapsedMs + sessionDt : run.reward.elapsedMs;
  const startNow = waiting && rewardMs >= REWARD_DELAY_MS;
  const travelBefore = startNow ? startTravel(run.travel, level, wv) : run.travel;
  const travelStep = stepTravel(
    travelBefore,
    { dtMs: startNow ? ZERO : sessionDt, paused: inputs.paused || inputs.hidden || holdActive, motion: level },
    wv,
  );
  const reward: RewardState = { elapsedMs: rewardMs, started: run.reward.started || startNow };

  // Step 9: the views, built once here. The shown and active sets follow design 3.2.
  const phase = travelStep.state.phase;
  const shown: string[] = [];
  if (phase !== 'arrived') shown.push(...stopOneIds);
  if (phase !== 'idle') shown.push(...stopTargetIds(config, ARRIVED_STOP));
  const active = activeFor(config, phase, run.selected);
  const view: View = { travel: travelStep.travel, head: lockStep.decorativeHead };
  const interactionView: View = { travel: travelStep.travel, head: lockStep.interactionHead };
  const fade = travelStep.state.part?.style === 'fade';
  const frameData: FrameData = {
    view,
    interactionView,
    interactionHead: lockStep.interactionHead,
    decorativeHead: lockStep.decorativeHead,
    cover: travelStep.cover,
    accentAlpha: fade ? travelStep.progress : ZERO,
    travelling: travelStep.travelling,
    active: new Set(active),
    shown: new Set(shown),
  };

  const part = travelStep.state.part;
  const report: FrameReport = {
    rawDt,
    presenceDt,
    sessionDt,
    paused: inputs.paused,
    hidden: inputs.hidden,
    hold: holdActive,
    level,
    headOut,
    driverOn: run.driver.on,
    driverValue: run.driver.value,
    view,
    interactionHead: lockStep.interactionHead,
    decorativeHead: lockStep.decorativeHead,
    lockRequested,
    lockMode: lockStep.state.mode,
    travelPhase: phase,
    travelStyle: part?.style ?? null,
    travelLevel: travelStep.state.level,
    progress: travelStep.progress,
    cover: travelStep.cover,
    remainingMs: part === null ? ZERO : part.remainingMs - part.elapsedMs,
    rewardMs: reward.elapsedMs,
    rewardStarted: reward.started,
    frame: inputs.frame,
    shown,
    active,
  };

  const next: WorldRun = {
    ...run,
    head: headStep.state,
    glide,
    lock: lockStep.state,
    travel: travelStep.state,
    reward,
    neutral,
    tracking,
    activeIds: active,
    presenceDt,
  };
  return { run: next, frame: frameData, report };
}

/**
 * Steps 13 and 14 of design 3.1, after the render: the dwell step over the hit circles of this frame
 * and the pointers of this frame, and the selections it reports. Only active targets get a hit area, so
 * none is given during the reward delay or the travel (Req 13.2).
 */
export function afterRender(run: WorldRun, circles: readonly HitCircle[], pointers: readonly PointerInput[]): RenderStep {
  const hitAreas: HitArea[] = [];
  for (const circle of circles) {
    if (!run.activeIds.includes(circle.id)) continue;
    hitAreas.push({
      targetId: circle.id,
      activationId: `${circle.id}@${run.generation}`,
      centre: circle.centre,
      radius: circle.radius,
    });
  }
  const dwellStep = stepDwell(run.dwell, { dt: run.presenceDt, pointers, hitAreas });
  const selected = [...run.selected];
  const events: SelectionEvent[] = [];
  for (const event of dwellStep.events) {
    if (selected.includes(event.targetId)) continue;
    selected.push(event.targetId);
    events.push({ kind: 'selected', targetId: event.targetId, colour: TARGET_SELECTED_TOKEN });
  }
  return { run: { ...run, dwell: dwellStep.state, selected }, events };
}
