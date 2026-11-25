// One headless session of the garden for one synthetic player (garden-level design 5.2; requirement 19). The run
// calibrates with the camera sweep of the profile, then plays the route through stepGarden, one simulated frame per
// step. Lantern Glade is played through its own dwell. The three placeholder stages have no hit area in this spec,
// so each completes with a stageCompleted event that goes through stepSession once the stage has its targets.
// One pause probe sets the paused flag for one frame during a dwell, so invariant 2 can fail. The run checks the
// invariants of design 5.2 step 5 and returns a summary. It prints nothing.
//
// The view of the play area (ASPECT, the pointer mapping, the whole-frame reach, the scene scale 1) repeats what
// ui/GardenStage.tsx builds in its environment(). It is not imported from there, because that file is a React
// component (see the journal entry of garden-level task 7).
import { planPlacement, seedRng, type Rng } from 'marrow/challenges';
import {
  createCalibration,
  dwellView,
  makeMapping,
  stepCalibration,
  stepClocks,
  TUNING,
  type CalibrationInput,
  type Landmark,
  type PointerInput,
  type PoseFrame,
  type Vec2,
} from 'marrow/core';
import { checkInvariant, framesFor, startInvariantLog, sweepSamples, type RunSummary, type SimProfile } from 'marrow/sim';
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
import { targetsActive, type SessionEvent, type SessionState } from '../../session/machine';
import {
  activeHitAreas,
  createGarden,
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
const NO_FLAGS = { paused: false, hidden: false, holdActive: false };
const NO_SUSPENSION = { paused: false, holdActive: false };
/** The still head of the calibration and of the frames: a valid nose and two valid shoulders. */
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

/** A placeholder stage is ready to complete: its targets are active and no completion has been accepted. */
function placeholderReady(session: SessionState): session is SessionState & { readonly stage: StageId } {
  if (session.phase !== 'PLAYING' && session.phase !== 'BLOOM') return false;
  return session.stage !== null && session.stage !== LANTERN && !session.done.includes(session.stage) && targetsActive(session);
}

/**
 * Invariant 4 (requirement 10.5): a band slot is used only when the out-of-band slots alone give no simultaneous
 * placement. The check repeats planPlacement with every slot out of the band (a band value of Infinity).
 */
function bandRuleHolds(state: GardenState, env: GardenEnv): boolean {
  const placed = state.placed;
  if (placed === null || placed.bandSlotsUsed === 0) return true;
  const travel = state.session.travel?.distance ?? 0;
  const layer: LayerRef = {
    depth: INTERACTION_LAYER.depth,
    anchor: INTERACTION_LAYER.anchor,
    factor: WORLD_TUNING.interactionFactor,
  };
  const view: View = { travel, head: { x: 0, y: 0 } };
  const slots = env.content.lantern.slots.flatMap((slot) => {
    const point: WorldPoint = {
      x: slot.x,
      y: slot.y,
      depth: INTERACTION_LAYER.depth,
      anchor: INTERACTION_LAYER.anchor,
      factor: WORLD_TUNING.interactionFactor,
    };
    const screen = worldToScreen(point, view, env.reach.frame);
    return screen === null ? [] : [screen];
  });
  const r = placed.snapshot.radius * depthScale(layer, travel);
  const m = parallaxMargin(env.reach.frame.sceneScale, env.reach.frame.aspect);
  const outOfBand = planPlacement(
    { slots, n: LANTERN_COUNT, r, m },
    env.reach.grids,
    env.reach.mapping,
    TUNING,
    Number.POSITIVE_INFINITY,
  );
  return outOfBand.result.kind !== 'simultaneous';
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

/** One full run of the session for the profile and the seed. The summary says whether it reached SAVED. */
function playSession(profile: SimProfile, seed: number, maxSteps: number): RunSummary {
  const env = environment();
  const interval = profile.frameIntervalMs;
  let garden = createGarden(loadSegments(segmentsJson));
  const budget = { steps: 0, maxSteps };
  const calibrated = calibrate(profile, seedRng(seed), env, garden, budget);
  garden = calibrated.garden;
  if (!calibrated.completed) return summaryOf(profile, seed, false, 0, []);
  let rng = calibrated.rng;
  let log = startInvariantLog();
  let helpSteps = 0;
  let probed = false;
  let pending: SessionEvent | null = { kind: 'calibrated' };
  const activations = new Map<string, number>();
  const lanternZero = targetIdOf(0);
  while (garden.session.phase !== 'SAVED') {
    if (budget.steps >= maxSteps) return summaryOf(profile, seed, false, helpSteps, log.violations);
    budget.steps++;
    const areas = activeHitAreas(garden, env.reach.frame);
    const area = areas[0];
    const aim: Vec2 | null = area === undefined ? null : POINTER_MAPPING.toCamera(area.centre);
    const t = budget.steps * interval;
    const framed = framesFor(profile, rng, aim, area !== undefined, ASPECT, { startMs: t, endMs: t + interval });
    rng = framed.rng;
    const pose = framed.frames[0];
    if (pose === undefined) throw new Error('the frame generator gave no frame');
    const probing =
      !probed &&
      pending === null &&
      area !== undefined &&
      area.targetId === lanternZero &&
      dwellView(garden.dwell, area.targetId).progressMs >= PROBE_AT_MS;
    let event: SessionEvent | null = pending;
    pending = null;
    if (probing) {
      probed = true;
      event = { kind: 'stageCompleted', stage: LANTERN };
    } else if (event === null && placeholderReady(garden.session)) {
      event = { kind: 'stageCompleted', stage: garden.session.stage };
    }
    const clocks = stepClocks(interval, { paused: probing, hidden: false, holdActive: false }, TUNING);
    const frame: GardenFrame = {
      event,
      presenceDt: clocks.presenceDt,
      sessionDt: clocks.sessionDt,
      motion: 'full',
      suspension: probing ? { paused: true, holdActive: false } : NO_SUSPENSION,
      pointers: [pointerOf(pose)],
    };
    const step = stepGarden(env, garden, frame);
    garden = step.state;
    let activatedLantern = false;
    for (const effect of step.effects) {
      if (effect.kind === 'help' && effect.output.kind === 'revealStep') helpSteps++;
      if (effect.kind === 'session' && effect.effect.kind === 'stageActivated') {
        const id = effect.effect.stage;
        activations.set(id, (activations.get(id) ?? 0) + 1);
        if (id === LANTERN) activatedLantern = true;
      }
    }
    const repeated = [...activations].find(([, count]) => count > 1);
    log = checkInvariant(log, 'one transition per stage', repeated === undefined, () => `${repeated?.[0]} activated ${repeated?.[1]} times`);
    if (probing) {
      const refused = step.effects.some(
        (effect) => effect.kind === 'session' && effect.effect.kind === 'ignored' && effect.effect.reason === 'suspended',
      );
      const lit = step.effects.some((effect) => effect.kind === 'lanternLit');
      log = checkInvariant(log, 'no completion under a pause', refused && !lit, () =>
        lit ? 'a lantern was lit while paused' : 'a completion under the pause was not refused',
      );
    }
    const targetsOk = activeHitAreas(garden, env.reach.frame).length === 0 || targetsActive(garden.session);
    log = checkInvariant(log, 'no target active before travel stops', targetsOk, () => 'a target was active while travelling');
    if (activatedLantern) {
      log = checkInvariant(log, 'no band slot unless needed', bandRuleHolds(garden, env), () =>
        'a band slot was used though the other slots give a simultaneous placement',
      );
    }
    const stage = garden.stage;
    if (stage !== null && stage.kind === 'lantern' && !stage.rule.completed && garden.placed !== null) {
      // The levels are compared through snapshotRound, the only reader of the levels (requirement 12.1).
      const levelsHold = JSON.stringify(snapshotRound(garden.help, TUNING)) === JSON.stringify(garden.placed.snapshot);
      log = checkInvariant(log, 'help levels unchanged in a round', levelsHold, () => 'a help level changed during the round');
    }
  }
  return summaryOf(profile, seed, true, helpSteps, log.violations);
}

function summaryOf(
  profile: SimProfile,
  seed: number,
  completed: boolean,
  helpStepsUsed: number,
  violations: readonly string[],
): RunSummary {
  return { profile: profile.name, seed, completed, helpStepsUsed, violations };
}

/**
 * One run of one profile from one seed, at most `options.maxSteps` steps (requirement 19.5, 19.7). A run that throws
 * is returned as a run that did not complete, with the error as its violation.
 */
export function runSession(profile: SimProfile, seed: number, options: { readonly maxSteps: number }): RunSummary {
  try {
    return playSession(profile, seed, options.maxSteps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return summaryOf(profile, seed, false, 0, [`run threw: ${message}`]);
  }
}
