// One headless session of the garden for one synthetic player (garden-level design 5.2; requirement 19). The run
// calibrates with the camera sweep of the profile, then plays the route through stepGarden, one simulated frame per
// step. Lantern Glade is played through its dwell. Whisper Glade is played by its rules: the attention rounds and the
// path choice, where each presentation is answered by chooseFor. Whisper Hall and Bloom are played through a dwell on
// their one placed target, as in the browser. Two probes send a completion under a suspension: a pause on the first
// lantern, and a tracking hold (from stepTracking) on the first hold frame. The run checks the invariants of design 5.2
// step 5 and returns a summary with counters. It prints nothing.
//
// The view of the play area (ASPECT, the pointer mapping, the whole-frame reach, the scene scale 1) repeats what
// ui/GardenStage.tsx builds in its environment(). It is not imported from there, because that file is a React
// component (see the journal entry of garden-level task 7).
import { ATTENTION_TUNING, currentPresentation, inRestingBand, seedRng, type Rng } from 'marrow/challenges';
import {
  createCalibration,
  createTracking,
  dwellView,
  makeMapping,
  placeTargets,
  stepCalibration,
  stepClocks,
  stepTracking,
  TUNING,
  type CalibrationInput,
  type Landmark,
  type PointerInput,
  type PoseFrame,
  type TrackingState,
  type Vec2,
} from 'marrow/core';
import { chooseFor, checkInvariant, framesFor, startInvariantLog, sweepSamples, type RunSummary, type SimProfile } from 'marrow/sim';
import {
  depthScale,
  parallaxMargin,
  TUNING as WORLD_TUNING,
  worldToScreen,
  type LayerRef,
  type View,
  type WorldPoint,
} from 'world-view';
import { loadSegments } from '../../journeys/journeys';
import segmentsJson from '../../journeys/segments.json';
import { INTERACTION_LAYER } from '../../scene/forestLayers';
import { targetsActive, type SessionEvent } from '../../session/machine';
import {
  activeHitAreas,
  createGarden,
  placeholderLayerOf,
  placeholderPointOf,
  stepGarden,
  type GardenEnv,
  type GardenFrame,
  type GardenState,
} from '../../session/stageDriver';
import { snapshotRound } from '../../session/roundSnapshot';
import type { StageId } from '../../session/stageOrder';
import { SIMULATED_WRISTS, wholeFrameReach } from '../../session/wholeFrame';
import { loadBloom } from '../../stages/bloom/content';
import bloomJson from '../../stages/bloom/content.json';
import { LANTERN_COUNT, loadLanternGlade } from '../../stages/lantern-glade/content';
import lanternJson from '../../stages/lantern-glade/content.json';
import { targetIdOf } from '../../stages/lantern-glade/rules';
import type { PlacedRound } from '../../stages/shared/placeRound';
import type { SlotSpec } from '../../stages/shared/placeholderContent';
import { loadWhisperGlade } from '../../stages/whisper-glade/content';
import whisperGladeJson from '../../stages/whisper-glade/content.json';
import { loadWhisperHall } from '../../stages/whisper-hall/content';
import whisperHallJson from '../../stages/whisper-hall/content.json';

/** The aspect of the play area: 16:9, as ui/GardenStage.tsx has it. */
const ASPECT = 16 / 9;
/** The vertical centre of the play area, in normalized units. */
const CENTRE_Y = 0.5;
/** The scene scale of the play area. The scene has no zoom of its own, so the scale is 1. */
const SCENE_SCALE = 1;
/** The dwell progress at which the pause probe fires: half of the dwell time. */
const PROBE_AT_MS = TUNING.dwellMs / 2;
const RADIUS_TOLERANCE = 1e-9;
const NO_FLAGS = { paused: false, hidden: false, holdActive: false };
const NO_SUSPENSION = { paused: false, holdActive: false };
/** The still head of the calibration: a valid nose and two valid shoulders. */
const still = (x: number, y: number): Landmark => ({ pos: { x, y }, valid: true });
const STILL_HEAD: CalibrationInput['head'] = {
  nose: still(0.5, 0.4),
  leftShoulder: still(0.4, 0.6),
  rightShoulder: still(0.6, 0.6),
};
/** The pointer mapping of the play area: the whole play area is the screen, with gain 1 (as ui/GardenStage.tsx). */
const POINTER_MAPPING = makeMapping({
  playAspect: ASPECT,
  frameAspect: ASPECT,
  gain: 1,
  centre: { x: ASPECT / 2, y: CENTRE_Y },
});
const LANTERN: StageId = 'lantern-glade';

/** The counters of one run. The report of the simulator prints the summary; these numbers are for the tests. */
export interface SessionStats {
  /** The steps of the whole run, calibration included. */
  readonly steps: number;
  /** The placements made: one per round (the lanterns, the spirits and the path choice). */
  readonly placements: number;
  /** The placements that used a band slot. */
  readonly bandPlacements: number;
  /** The steps on which a help level changed inside a round (Req 19.8). */
  readonly liveLevelChanges: number;
  /** The steps of a tracking hold. */
  readonly holdFrames: number;
  /** The completions sent during a tracking hold, each refused with reason suspended. */
  readonly holdProbes: number;
  /** The pause probes sent, at most one. */
  readonly pauseProbes: number;
  /** The help steps used (the revealStep outputs). */
  readonly helpSteps: number;
  /** The mistakes of the attention rounds (requirement 7.1). */
  readonly mistakes: number;
  /** The largest session delta of a step, in milliseconds. */
  readonly maxSessionDtMs: number;
}

/** One run: its summary and its counters. */
export interface SessionRun {
  readonly summary: RunSummary;
  readonly stats: SessionStats;
}

const EMPTY_STATS: SessionStats = {
  steps: 0,
  placements: 0,
  bandPlacements: 0,
  liveLevelChanges: 0,
  holdFrames: 0,
  holdProbes: 0,
  pauseProbes: 0,
  helpSteps: 0,
  mistakes: 0,
  maxSessionDtMs: 0,
};

let cachedEnv: GardenEnv | null = null;

/** The content and the reach of a run, built once per process. */
function environment(): GardenEnv {
  if (cachedEnv !== null) return cachedEnv;
  const reach = wholeFrameReach(ASPECT);
  cachedEnv = {
    content: {
      lantern: loadLanternGlade(lanternJson),
      whisper: loadWhisperGlade(whisperGladeJson),
      placeholders: {
        'whisper-hall': loadWhisperHall(whisperHallJson),
        bloom: loadBloom(bloomJson),
      },
    },
    reach: {
      grids: reach.grids,
      activeWrists: SIMULATED_WRISTS,
      mapping: reach.mapping,
      frame: { aspect: ASPECT, sceneScale: SCENE_SCALE },
    },
  };
  return cachedEnv;
}

/** The screen pointer of a frame's right wrist, through the pointer mapping (as ui/GardenStage.tsx does). */
function pointerOf(frame: PoseFrame): PointerInput {
  const wrist = frame.landmarks.rightWrist;
  if (!wrist.valid) return { wrist: 'right', valid: false };
  return { wrist: 'right', valid: true, pos: POINTER_MAPPING.toScreen(wrist.pos) };
}


/** The layer of the interaction targets: the layer every placement and hit area uses. */
const INTERACTION_LAYER_REF: LayerRef = {
  depth: INTERACTION_LAYER.depth,
  anchor: INTERACTION_LAYER.anchor,
  factor: WORLD_TUNING.interactionFactor,
};

/** An authored slot as a point of the interaction layer (as the stage driver places it). */
function interactionPoint(slot: { readonly x: number; readonly y: number }): WorldPoint {
  return { x: slot.x, y: slot.y, depth: INTERACTION_LAYER.depth, anchor: INTERACTION_LAYER.anchor, factor: WORLD_TUNING.interactionFactor };
}

/** The layer of a round's targets: a placeholder's own layer (its slot's depth and anchor), else the forest's interaction layer. */
function layerOf(env: GardenEnv, stage: NonNullable<GardenState['stage']>): LayerRef {
  if (stage.kind !== 'placeholder') return INTERACTION_LAYER_REF;
  return placeholderLayerOf(placeholderSlotOf(env, stage.id));
}

/** The first slot of a placeholder stage, the one its target is placed at (see stageDriver). */
function placeholderSlotOf(env: GardenEnv, id: 'whisper-hall' | 'bloom'): SlotSpec {
  const slot = env.content.placeholders[id].target.slots[0];
  if (slot === undefined) throw new Error(`${id}: no slot`);
  return slot;
}

/** The candidate slots of a placement, its number of targets and its layer, or null when the round has no placement. */
function candidatesOf(
  env: GardenEnv,
  stage: GardenState['stage'],
): { points: readonly WorldPoint[]; n: number; layer: LayerRef } | null {
  if (stage === null) return null;
  const layer = layerOf(env, stage);
  if (stage.kind === 'lantern') return { points: env.content.lantern.slots.map(interactionPoint), n: LANTERN_COUNT, layer };
  if (stage.kind === 'placeholder') return { points: [placeholderPointOf(placeholderSlotOf(env, stage.id))], n: 1, layer };
  if (stage.kind === 'whisper') {
    const whisper = env.content.whisper;
    const slots = stage.rule.path.phase === 'waiting' ? whisper.spiritSlots : [whisper.pathSlots.fireflies, whisper.pathSlots.candles];
    return { points: slots.map(interactionPoint), n: slots.length, layer };
  }
  return null;
}

/**
 * Invariant 4 (requirement 10.5): a band slot is used only when the out-of-band slots alone give no simultaneous
 * placement. The check takes the slots outside the resting band at its real edge (ATTENTION_TUNING.restingBandY) and
 * places them alone, with the same count as the placement.
 */
function bandRuleHolds(placed: PlacedRound, candidates: { points: readonly WorldPoint[]; n: number; layer: LayerRef }, travel: number, env: GardenEnv): boolean {
  if (placed.bandSlotsUsed === 0) return true;
  const view: View = { travel, head: { x: 0, y: 0 } };
  const slots = candidates.points.flatMap((point) => {
    const screen = worldToScreen(point, view, env.reach.frame);
    return screen === null ? [] : [screen];
  });
  const r = placed.snapshot.radius * depthScale(candidates.layer, travel);
  const m = parallaxMargin(env.reach.frame.sceneScale, env.reach.frame.aspect);
  const bandY = ATTENTION_TUNING.restingBandY;
  // The slots outside the resting band, placed alone. A simultaneous result means no band slot was needed.
  const outOfBand = slots.filter((slot) => !inRestingBand(slot, r, env.reach.mapping, bandY));
  const alone = placeTargets({ slots: outOfBand, n: candidates.n, r, m }, env.reach.grids, env.reach.mapping, TUNING);
  return alone.kind !== 'simultaneous';
}

/** The answer of the player to the presentation in progress: its key, and whether it dwells on the spirit. */
interface Attempt {
  readonly key: string;
  readonly dwell: boolean;
}

/** The calibration phase of a run: the camera sweep until calibration completes, one frame per step. */
function calibrate(
  profile: SimProfile,
  rng: Rng,
  env: GardenEnv,
  garden: GardenState,
  budget: { steps: number; maxSteps: number },
): { garden: GardenState; rng: Rng; completed: boolean } {
  let state = createCalibration({
    activeWrists: ['right'],
    mode: 'camera',
    demand: { slots: [], n: 1, r: TUNING.hitRadius, m: 0 },
    frameAspect: ASPECT,
    playAspect: ASPECT,
    tuning: TUNING,
  });
  let current = garden;
  let generator = rng;
  let pending: SessionEvent | null = { kind: 'setupDone' };
  while (state.phase !== 'complete') {
    if (budget.steps >= budget.maxSteps) return { garden: current, rng: generator, completed: false };
    budget.steps++;
    const clocks = stepClocks(profile.frameIntervalMs, NO_FLAGS, TUNING);
    const sample = sweepSamples(profile, generator, 1);
    generator = sample.rng;
    const pos: Vec2 | undefined = sample.samples[0];
    if (pos === undefined) throw new Error('the calibration sweep gave no sample');
    state = stepCalibration(
      state,
      { pointers: { right: { valid: true, pos } }, frameConsumed: true, head: STILL_HEAD },
      clocks.presenceDt,
    ).state;
    const step = stepGarden(env, current, {
      event: pending,
      presenceDt: 0,
      sessionDt: 0,
      motion: 'full',
      suspension: NO_SUSPENSION,
      pointers: [],
    });
    current = step.state;
    pending = state.phase === 'complete' ? { kind: 'calibrated' } : null;
  }
  return { garden: current, rng: generator, completed: true };
}

/** One full run of the session for the profile and the seed, with its counters. */
function playSession(profile: SimProfile, seed: number, maxSteps: number): SessionRun {
  const env = environment();
  const interval = profile.frameIntervalMs;
  let garden = createGarden(loadSegments(segmentsJson), seed);
  const budget = { steps: 0, maxSteps };
  let log = startInvariantLog();
  const counts = {
    placements: 0,
    bandPlacements: 0,
    liveLevelChanges: 0,
    holdFrames: 0,
    holdProbes: 0,
    pauseProbes: 0,
    helpSteps: 0,
    mistakes: 0,
    maxSessionDtMs: 0,
  };
  const finish = (completed: boolean, violations: readonly string[]): SessionRun => ({
    summary: { profile: profile.name, seed, completed, helpStepsUsed: counts.helpSteps, violations },
    stats: { ...counts, steps: budget.steps },
  });
  const calibrated = calibrate(profile, seedRng(seed), env, garden, budget);
  garden = calibrated.garden;
  if (!calibrated.completed) return finish(false, []);
  let rng = calibrated.rng;
  let pending: SessionEvent | null = { kind: 'calibrated' };
  let tracking: TrackingState = createTracking({ activeWrists: ['right'], mode: 'camera', tuning: TUNING });
  let probed = false;
  let holdProbed = false;
  let attempt: Attempt | null = null;
  let liftFrames = 0;
  // One counter per stage and kind of transition: "activated" and "rewarded" (a completion accepted).
  const transitions = new Map<string, number>();
  const lanternZero = targetIdOf(0);
  let lastPlaced: PlacedRound | null = null;
  let roundStart = '';
  let prevLive = '';
  while (garden.session.phase !== 'SAVED') {
    if (budget.steps >= maxSteps) return finish(false, log.violations);
    budget.steps++;
    const areas = activeHitAreas(garden, env.reach.frame);
    const area = areas[0];
    const stage = garden.stage;

    // The player's answer. A presentation of Whisper Glade is answered once per attempt: a new draw after each mistake.
    // The hand lifts for one frame at the start of each attempt, to the resting place outside every target. A latch on a
    // completed target leaves only when a valid pointer stands outside it (Req 17.12), so the next appearance needs it.
    let wantsDwell = true;
    if (stage !== null && stage.kind === 'whisper') {
      const presentation = currentPresentation(stage.rule.attention);
      if (presentation !== null) {
        const attentionNow = stage.rule.attention;
        const key = `${attentionNow.block}:${attentionNow.index}:${attentionNow.completed}:${attentionNow.mistakes}`;
        if (attempt === null || attempt.key !== key) {
          const choice = chooseFor(profile, rng, presentation.mark);
          rng = choice.rng;
          attempt = { key, dwell: choice.dwell };
          liftFrames = 1;
        }
        wantsDwell = attempt.dwell;
      }
    }
    const lifted = liftFrames > 0;
    if (lifted) liftFrames--;
    const aim: Vec2 | null = area === undefined || lifted ? null : POINTER_MAPPING.toCamera(area.centre);
    const dwell = area !== undefined && wantsDwell && !lifted;
    const t = budget.steps * interval;
    const framed = framesFor(profile, rng, aim, dwell, ASPECT, { startMs: t, endMs: t + interval });
    rng = framed.rng;
    const pose = framed.frames[0];
    if (pose === undefined) throw new Error('the frame generator gave no frame');

    // The pause probe: one frame, on the first lantern, during its dwell.
    const probing =
      !probed &&
      pending === null &&
      area !== undefined &&
      area.targetId === lanternZero &&
      dwellView(garden.dwell, area.targetId).progressMs >= PROBE_AT_MS;

    // The tracking hold: stepTracking reads the right wrist of this frame, and its holdActive is the flag for the clocks.
    const timing = stepClocks(interval, { paused: probing, hidden: false, holdActive: false }, TUNING);
    const trackingStep = stepTracking(
      tracking,
      { wristValid: { right: pose.landmarks.rightWrist.valid }, noseValid: true, calibrating: false },
      timing.presenceDt,
    );
    tracking = trackingStep.state;
    const holdNow = trackingStep.holdActive;
    if (holdNow) counts.holdFrames++;
    const clocks = stepClocks(interval, { paused: probing, hidden: false, holdActive: holdNow }, TUNING);
    counts.maxSessionDtMs = Math.max(counts.maxSessionDtMs, clocks.sessionDt);

    let event: SessionEvent | null = pending;
    pending = null;
    let probe: 'pause' | 'hold' | null = null;
    const activeStage = garden.session.stage;
    if (probing) {
      probed = true;
      probe = 'pause';
      event = { kind: 'stageCompleted', stage: LANTERN };
    } else if (holdNow && !holdProbed && event === null && activeStage !== null && targetsActive(garden.session)) {
      holdProbed = true;
      probe = 'hold';
      event = { kind: 'stageCompleted', stage: activeStage };
    }
    const suspension = { paused: probing, holdActive: holdNow };
    const frame: GardenFrame = {
      event,
      presenceDt: clocks.presenceDt,
      sessionDt: clocks.sessionDt,
      motion: 'full',
      suspension,
      pointers: [pointerOf(pose)],
    };
    const step = stepGarden(env, garden, frame);
    garden = step.state;

    let accepted = false;
    let refusedSuspended = false;
    let lit = false;
    let changed = false;
    for (const effect of step.effects) {
      if (effect.kind === 'help' && effect.output.kind === 'revealStep') counts.helpSteps++;
      if (effect.kind === 'attention' && effect.event.kind === 'mistake') counts.mistakes++;
      if (effect.kind === 'lanternLit') {
        lit = true;
        accepted = true;
      }
      if (effect.kind === 'pathChosen') accepted = true;
      if (effect.kind !== 'session') continue;
      const sessionEffect = effect.effect;
      if (sessionEffect.kind === 'stageActivated') {
        const key = `activated ${sessionEffect.stage}`;
        transitions.set(key, (transitions.get(key) ?? 0) + 1);
        changed = true;
      }
      if (sessionEffect.kind === 'rewardStarted') {
        const key = `rewarded ${sessionEffect.stage}`;
        transitions.set(key, (transitions.get(key) ?? 0) + 1);
        accepted = true;
        changed = true;
      }
      if (sessionEffect.kind === 'ignored' && sessionEffect.reason === 'suspended') refusedSuspended = true;
    }

    // Invariant 1: one transition per stage. A stage is activated at most once and rewarded at most once.
    if (changed) {
      const over = [...transitions].find(([, count]) => count > 1);
      log = checkInvariant(log, 'one transition per stage', over === undefined, () => `${over?.[0]} happened ${over?.[1]} times`);
    }

    // Invariant 2: no completion under a suspension, and each probe is refused with reason suspended.
    if (probing || holdNow) {
      log = checkInvariant(log, 'no completion under a suspension', !accepted, () => 'a completion was accepted while paused or in a tracking hold');
    }
    if (probe === 'pause') {
      counts.pauseProbes++;
      log = checkInvariant(log, 'no completion under a suspension', refusedSuspended && !lit, () => 'the pause did not refuse the completion');
    }
    if (probe === 'hold') {
      counts.holdProbes++;
      log = checkInvariant(log, 'no completion under a suspension', refusedSuspended && !accepted, () => 'the tracking hold did not refuse the completion');
    }

    // Invariant 3: no hit area while the travel is not arrived. Before the first travel there is no travel to check.
    const travel = garden.session.travel;
    const travelling = travel !== null && travel.phase !== 'arrived';
    const areasNow = activeHitAreas(garden, env.reach.frame);
    log = checkInvariant(log, 'no target active before travel stops', !(travelling && areasNow.length > 0), () => 'a hit area was active while travelling');

    // Invariants 4 and 5, per round. A new placement starts a round and keeps its snapshot. Inside a round, the hit areas
    // must use the radius of the round's snapshot, and the snapshot must not change.
    const placed = garden.placed;
    const travelNow = travel?.distance ?? 0;
    if (placed !== null && placed !== lastPlaced) {
      lastPlaced = placed;
      counts.placements++;
      if (placed.bandSlotsUsed > 0) counts.bandPlacements++;
      const candidates = candidatesOf(env, garden.stage);
      if (candidates !== null) {
        log = checkInvariant(log, 'no band slot unless needed', bandRuleHolds(placed, candidates, travelNow, env), () =>
          'a band slot was used though the other slots give a simultaneous placement',
        );
      }
      roundStart = JSON.stringify(placed.snapshot);
      prevLive = JSON.stringify(snapshotRound(garden.help, TUNING));
    } else if (placed !== null && placed === lastPlaced) {
      log = checkInvariant(log, 'help levels unchanged in a round', JSON.stringify(placed.snapshot) === roundStart, () => 'the round snapshot changed');
      const live = JSON.stringify(snapshotRound(garden.help, TUNING));
      if (live !== prevLive) {
        counts.liveLevelChanges++;
        prevLive = live;
      }
      const expected = garden.stage === null ? 0 : placed.snapshot.radius * depthScale(layerOf(env, garden.stage), travelNow);
      for (const hit of areasNow) {
        log = checkInvariant(log, 'help levels unchanged in a round', Math.abs(hit.radius - expected) < RADIUS_TOLERANCE, () =>
          `a hit area radius ${hit.radius} differs from the round snapshot radius ${expected}`,
        );
      }
    }
  }
  return finish(true, log.violations);
}

/**
 * One run of one profile from one seed, at most `options.maxSteps` steps (requirement 19.5, 19.7). A run that throws
 * is returned as a run that did not complete, with the error as its violation.
 */
export function runSessionDetailed(profile: SimProfile, seed: number, options: { readonly maxSteps: number }): SessionRun {
  try {
    return playSession(profile, seed, options.maxSteps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      summary: { profile: profile.name, seed, completed: false, helpStepsUsed: 0, violations: [`run threw: ${message}`] },
      stats: EMPTY_STATS,
    };
  }
}

/** The summary of one run, as the simulator reports it. */
export function runSession(profile: SimProfile, seed: number, options: { readonly maxSteps: number }): RunSummary {
  return runSessionDetailed(profile, seed, options).summary;
}
