// The per-frame data flow of the slice, in node (Req 5, 6, 7, 8, 12, 13, 14; design 3, 8.3, 9.2).
// The Scene Manager is not loaded here. A fake scene does what applyTargets does, with targetScreen.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dwellView, TUNING as MARROW_TUNING, type MotionLevel, type PointerInput, type PoseLandmarks, type Vec2 } from 'marrow/core';
import { createSettingsStore, type SettingsStore } from 'marrow/react';
import { describe, expect, it } from 'vitest';
import { parallaxShift, TUNING, targetScreen, type ProjectionFrame, type View } from 'world-view';
import type { FrameData, HitCircle } from 'world-view/pixi';
import { DEFAULT_ASPECT, REWARD_DELAY_MS, TARGET_SELECTED_TOKEN } from './constants';
import { mouseComfort, placeStops, type PlacedStop } from './placementSetup';
import { loadWorldContent, type ContentSegment } from './worldContent';
import {
  activeTargets,
  afterRender,
  createWorldRun,
  dwellInProgress,
  restartRun,
  setRunHeadDriver,
  stepWorldFrame,
  stopTargetIds,
  type FrameReport,
  type HeadInput,
  type RunConfig,
  type WorldRun,
} from './worldRun';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const HALF = 0.5;
/** Test parameters (design 5.1): the render rate, and the step limit of a run that must reach a state. */
const RENDER_HZ = 60;
const FRAME_MS = 1000 / RENDER_HZ;
const MAX_FRAMES = 1200;
/** Req 12.6: the head moves by more than this while the dwell completes. */
const HEAD_CHANGE_MIN = 0.1;
const RAMP_FRAMES = 60;
const RAMP_TO = 0.5;
/** Test parameter: the 7 pose frames per second of Req 14.8, and the length of the run that checks them. */
const POSE_HZ = 7;
const POSE_SECONDS = 3;
/** The spread of the camera pose: a nose swing and the shoulder offsets from the middle of the frame. */
const NOSE_SWING = 0.2;
const SHOULDER_OFFSET = 0.25;
const EPSILON = 1e-12;

const PLAY_ASPECT = DEFAULT_ASPECT;
const CAMERA_ASPECT = DEFAULT_ASPECT;
const FRAME: ProjectionFrame = { aspect: PLAY_ASPECT, sceneScale: ONE };
/** A point of the play area away from every target, for the frames in which nothing is held. */
const AWAY: Vec2 = { x: HALF * PLAY_ASPECT, y: HALF + HALF * HALF };

interface Setup {
  readonly config: RunConfig;
  readonly settings: SettingsStore;
  readonly stops: readonly PlacedStop[];
}

/** The forest content, placed with the mouse comfort grid, and a settings store at the given motion level. */
function setup(kind: 'journey' | 'door' = 'journey', motion: MotionLevel = 'full', mode: 'mouse' | 'camera' = 'mouse'): Setup {
  const loaded = loadWorldContent(FRAME);
  if (!loaded.ok) throw new Error('the forest content is invalid');
  const { content } = loaded;
  const segment: ContentSegment | undefined = content.segments.find((item) => item.kind === kind);
  if (segment === undefined) throw new Error(`no ${kind} segment`);
  const settings = createSettingsStore({ prefix: 'test:', prefersReducedMotion: false, storage: null });
  settings.update({ motion });
  const comfort = mouseComfort(PLAY_ASPECT, MARROW_TUNING.hitRadius);
  const placed = placeStops(content, segment, FRAME, comfort.grids, comfort.mapping, MARROW_TUNING.hitRadius, TUNING);
  if (!placed.ok) throw new Error(`placement did not start: ${placed.notice}`);
  const config: RunConfig = { content, tuning: TUNING, segment, stops: placed.stops, settings, mode };
  return { config, settings, stops: placed.stops };
}

/** The landmarks of one camera frame: the nose at `nose`, and both shoulders around the middle of the frame. */
function cameraLandmarks(nose: Vec2, valid: boolean): PoseLandmarks {
  const shoulder = (x: number): { pos: Vec2; valid: boolean } => ({ pos: { x, y: HALF }, valid });
  return {
    leftWrist: { pos: { x: ZERO, y: ZERO }, valid: false },
    rightWrist: { pos: { x: ZERO, y: ZERO }, valid: false },
    nose: { pos: nose, valid },
    leftShoulder: shoulder(HALF + SHOULDER_OFFSET),
    rightShoulder: shoulder(HALF - SHOULDER_OFFSET),
  };
}

function pointerAt(pos: Vec2): HeadInput {
  return { kind: 'pointer', pointer: { valid: true, pos }, playAspect: PLAY_ASPECT };
}

function pointerInput(pos: Vec2): PointerInput {
  return { wrist: 'right', valid: true, pos };
}

/**
 * A stand-in for the Scene Manager's applyTargets (design 7.3, step 6): one targetScreen call per target of
 * the view it is given, circles for the active targets only, and none while travelling. It returns the view
 * it used, so that a test can compare that object with the frame's view.
 */
function fakeScene(config: RunConfig, data: FrameData, frame: ProjectionFrame): { view: View; circles: HitCircle[] } {
  const circles: HitCircle[] = [];
  for (const stop of config.stops) {
    for (const target of stop.targets) {
      const placed = targetScreen(target.point, target.r, data.interactionView, frame, TUNING);
      if (placed === null) continue;
      if (data.active.has(target.id) && !data.travelling) {
        circles.push({ id: target.id, centre: placed.position, radius: placed.radius });
      }
    }
  }
  return { view: data.interactionView, circles };
}

interface Played {
  readonly run: WorldRun;
  readonly frame: FrameData;
  readonly report: FrameReport;
  readonly circles: HitCircle[];
  readonly selectedNow: readonly string[];
  readonly events: ReturnType<typeof afterRender>['events'];
}

/** One rendered frame: the step, the fake scene, then the dwell step with the pointers of this frame. */
function play(run: WorldRun, head: HeadInput, pointers: readonly PointerInput[] = [], dtMs = FRAME_MS, paused = false): Played {
  const step = stepWorldFrame(run, dtMs, { paused, hidden: false, frame: FRAME, head });
  const scene = fakeScene(step.run.config, step.frame, FRAME);
  const rendered = afterRender(step.run, scene.circles, pointers);
  return {
    run: rendered.run,
    frame: step.frame,
    report: step.report,
    circles: scene.circles,
    selectedNow: rendered.events.map((event) => event.targetId),
    events: rendered.events,
  };
}

function circleOf(played: Played, id: string): HitCircle {
  const circle = played.circles.find((item) => item.id === id);
  if (circle === undefined) throw new Error(`no hit circle for ${id}`);
  return circle;
}

/** A first frame away from the targets, so that the scene has its circles. */
function warm(run: WorldRun): Played {
  return play(run, pointerAt(AWAY));
}

/** Holds the pointer on a target, following its circle, until the target is selected. */
function holdUntilSelected(start: Played, id: string): Played {
  let state = start;
  for (let i = ZERO; i < MAX_FRAMES; i++) {
    const circle = circleOf(state, id);
    state = play(state.run, pointerAt(circle.centre), [pointerInput(circle.centre)]);
    if (state.run.selected.includes(id)) return state;
  }
  throw new Error(`target ${id} was not selected within ${MAX_FRAMES} frames`);
}

/** Steps with the pointer away from every target until the predicate holds. */
function runUntil(start: Played, predicate: (played: Played) => boolean): Played {
  let state = start;
  for (let i = ZERO; i < MAX_FRAMES; i++) {
    state = play(state.run, pointerAt(AWAY));
    if (predicate(state)) return state;
  }
  throw new Error(`the condition was not reached within ${MAX_FRAMES} frames`);
}

function stopOneIds(config: RunConfig): string[] {
  return stopTargetIds(config, ZERO);
}

describe('frame order and the dwell', () => {
  it('frame order: dwell and render share one view', () => {
    const { config } = setup();
    const start = warm(createWorldRun(config));
    const step = stepWorldFrame(start.run, FRAME_MS, {
      paused: false,
      hidden: false,
      frame: FRAME,
      head: pointerAt({ x: HALF, y: HALF }),
    });
    const scene = fakeScene(step.run.config, step.frame, FRAME);
    // The view the scene received is the very object the frame gave, and each circle is targetScreen of it.
    expect(Object.is(scene.view, step.frame.interactionView)).toBe(true);
    expect(scene.circles.length).toBeGreaterThan(ZERO);
    for (const circle of scene.circles) {
      const target = config.stops.flatMap((stop) => stop.targets).find((item) => item.id === circle.id);
      if (target === undefined) throw new Error(`no target ${circle.id}`);
      const placed = targetScreen(target.point, target.r, scene.view, FRAME, TUNING);
      expect(placed?.position).toEqual(circle.centre);
      expect(placed?.radius).toBe(circle.radius);
    }
  });

  it("lockRequested comes from the previous frame's dwell", () => {
    const { config } = setup();
    const start = warm(createWorldRun(config));
    const target = config.stops[ZERO]?.targets[ZERO];
    if (target === undefined) throw new Error('no target');
    const circle = circleOf(start, target.id);
    // The pointer enters the circle in this frame. The owner is set by the render of this frame.
    const entering = play(start.run, pointerAt(circle.centre), [pointerInput(circle.centre)]);
    expect(entering.report.lockRequested).toBe(false);
    expect(dwellInProgress(entering.run.dwell, activeTargets(entering.run))).toBe(true);
    // The next frame reads that owner, so the lock is requested in it.
    const next = play(entering.run, pointerAt(circle.centre), [pointerInput(circle.centre)]);
    expect(next.report.lockRequested).toBe(true);
  });

  it('pause freezes glide, lock, travel and dwell', () => {
    const { config } = setup();
    const target = config.stops[ZERO]?.targets[ZERO];
    if (target === undefined) throw new Error('no target');
    let state = warm(createWorldRun(config));
    // Hold until the dwell is half way: in progress, not selected.
    for (let i = ZERO; i < MAX_FRAMES && dwellView(state.run.dwell, target.id).progress < HALF; i++) {
      const circle = circleOf(state, target.id);
      state = play(state.run, pointerAt(circle.centre), [pointerInput(circle.centre)]);
    }
    expect(dwellView(state.run.dwell, target.id).owner).not.toBeNull();
    expect(state.run.selected).not.toContain(target.id);
    const before = state.run;
    const circle = circleOf(state, target.id);
    const paused = play(before, pointerAt(circle.centre), [pointerInput(circle.centre)], FRAME_MS, true);
    expect(paused.report.presenceDt).toBe(ZERO);
    expect(paused.report.sessionDt).toBe(ZERO);
    expect(paused.run.glide).toEqual(before.glide);
    expect(paused.run.lock).toEqual(before.lock);
    expect(paused.run.travel).toEqual(before.travel);
    expect(paused.run.dwell).toEqual(before.dwell);
  });

  it('head driver replaces the head output', () => {
    const { config } = setup();
    const target = config.stops[ZERO]?.targets[ZERO];
    if (target === undefined) throw new Error('no target');
    let state = warm(createWorldRun(config));
    // Hold the pointer in the circle until the dwell owns the target.
    for (let i = ZERO; i < MAX_FRAMES; i++) {
      const circle = circleOf(state, target.id);
      state = play(state.run, pointerAt(circle.centre), [pointerInput(circle.centre)]);
      if (dwellInProgress(state.run.dwell, activeTargets(state.run))) break;
    }
    expect(dwellInProgress(state.run.dwell, activeTargets(state.run))).toBe(true);
    // Now the driver moves the head by more than HEAD_CHANGE_MIN, with the pointer held in the circle.
    const lockedHeads: Vec2[] = [];
    const decorativeHeads: Vec2[] = [];
    const offsets: Vec2[] = [];
    let run = state.run;
    let last: Played = state;
    for (let i = ZERO; i < RAMP_FRAMES; i++) {
      run = setRunHeadDriver(run, { x: (i / RAMP_FRAMES) * RAMP_TO, y: ZERO });
      const circle = circleOf(last, target.id);
      last = play(run, pointerAt(circle.centre), [pointerInput(circle.centre)]);
      run = last.run;
      if (last.report.lockRequested) lockedHeads.push(last.report.interactionHead);
      decorativeHeads.push(last.report.decorativeHead);
      offsets.push(parallaxShift(TUNING.interactionFactor, last.report.interactionHead, FRAME, TUNING));
    }
    expect(last.report.driverOn).toBe(true);
    expect(lockedHeads.length).toBeGreaterThan(ZERO);
    const held = lockedHeads[ZERO];
    for (const head of lockedHeads) expect(head).toEqual(held);
    for (const offset of offsets) expect(offset).toEqual(offsets[ZERO]);
    const first = decorativeHeads[ZERO];
    const lastHead = decorativeHeads[decorativeHeads.length - ONE];
    expect(Math.abs((lastHead?.x ?? ZERO) - (first?.x ?? ZERO))).toBeGreaterThan(HEAD_CHANGE_MIN);
    // The dwell completes while the driver moves the head. The circle does not move, so the hold stays.
    const done = holdUntilSelected(last, target.id);
    expect(done.run.selected).toContain(target.id);
  });

  it('glide and lock read the motion level only through the target', () => {
    const { config, settings } = setup('journey', 'full');
    const target = config.stops[ZERO]?.targets[ZERO];
    if (target === undefined) throw new Error('no target');
    let state = warm(createWorldRun(config));
    for (let i = ZERO; i < MAX_FRAMES && state.report.lockMode !== 'locked'; i++) {
      const circle = circleOf(state, target.id);
      state = play(state.run, pointerAt(circle.centre), [pointerInput(circle.centre)]);
    }
    expect(state.report.lockMode).toBe('locked');
    const heldHead = state.report.interactionHead;
    const headBefore = state.report.decorativeHead;
    settings.update({ motion: 'reduced' });
    const circle = circleOf(state, target.id);
    const reduced = play(state.run, pointerAt(circle.centre), [pointerInput(circle.centre)]);
    expect(reduced.report.interactionHead).toEqual(heldHead);
    expect(reduced.report.decorativeHead).not.toEqual(headBefore);
  });
});

describe('the reward, the travel and the activity of the stops', () => {
  it('both selected start the travel once after the reward delay', () => {
    const { config } = setup('door');
    const [first, second] = stopOneIds(config);
    if (first === undefined || second === undefined) throw new Error('stop 1 needs two targets');
    let state = holdUntilSelected(warm(createWorldRun(config)), first);
    state = holdUntilSelected(state, second);
    let starts = ZERO;
    let startFrame: FrameReport | undefined;
    let previousStarted = state.report.rewardStarted;
    let previousPhase = state.report.travelPhase;
    for (let i = ZERO; i < MAX_FRAMES && previousPhase !== 'arrived'; i++) {
      state = play(state.run, pointerAt(AWAY));
      if (state.report.rewardStarted && !previousStarted) {
        starts += ONE;
        startFrame = state.report;
      }
      previousStarted = state.report.rewardStarted;
      previousPhase = state.report.travelPhase;
    }
    expect(starts).toBe(ONE);
    expect(startFrame?.rewardMs).toBeGreaterThanOrEqual(REWARD_DELAY_MS);
    expect(startFrame?.travelPhase).toBe('travelling');
  });

  it('no hit area while the reward delay or the travel runs', () => {
    const { config } = setup('door');
    const [first, second] = stopOneIds(config);
    if (first === undefined || second === undefined) throw new Error('stop 1 needs two targets');
    let state = holdUntilSelected(warm(createWorldRun(config)), first);
    state = holdUntilSelected(state, second);
    // The selecting frame reports the targets that were active during it, so one more frame passes first.
    state = play(state.run, pointerAt(AWAY));
    // The reward delay: both targets are selected and the travel has not started.
    expect(state.report.rewardStarted).toBe(false);
    expect(state.report.active).toEqual([]);
    expect(state.circles).toEqual([]);
    // The travel: no target is active and no circle exists.
    state = runUntil(state, (played) => played.report.travelPhase === 'travelling');
    for (let i = ZERO; i < MAX_FRAMES && state.report.travelPhase === 'travelling'; i++) {
      expect(state.report.active).toEqual([]);
      expect(state.circles).toEqual([]);
      state = play(state.run, pointerAt(AWAY));
    }
  });

  it('stop-2 target is active only after arrival', () => {
    const { config } = setup('door');
    const [first, second] = stopOneIds(config);
    const stopTwo = stopTargetIds(config, ONE)[ZERO];
    if (first === undefined || second === undefined || stopTwo === undefined) throw new Error('the forest stops have targets');
    let state = holdUntilSelected(warm(createWorldRun(config)), first);
    state = holdUntilSelected(state, second);
    let arrived: Played | undefined;
    for (let i = ZERO; i < MAX_FRAMES && arrived === undefined; i++) {
      state = play(state.run, pointerAt(AWAY));
      if (state.report.travelPhase === 'arrived') arrived = state;
      else expect(state.frame.active.has(stopTwo)).toBe(false);
    }
    expect(arrived).toBeDefined();
    // The very frame of `arrived` makes the stop-2 target active, with travel at its end and progress 1.
    expect(arrived?.frame.active.has(stopTwo)).toBe(true);
    expect(arrived?.report.progress).toBe(ONE);
    expect(arrived?.report.travelPhase).toBe('arrived');
  });

  it('restart creates clean states', () => {
    const { config } = setup('door');
    const [first] = stopOneIds(config);
    if (first === undefined) throw new Error('no target');
    const state = holdUntilSelected(warm(createWorldRun(config)), first);
    const restarted = restartRun(state.run);
    expect(restarted.selected).toEqual([]);
    expect(restarted.travel.phase).toBe('idle');
    expect(restarted.dwell.targets).toEqual([]);
    expect(restarted.glide.out).toEqual({ x: ZERO, y: ZERO });
    expect(restarted.lock.mode).toBe('free');
    expect(restarted.generation).toBe(state.run.generation + ONE);
    expect(activeTargets(restarted)).toEqual(stopOneIds(config));
  });
});

describe('clocks, the tracking hold and the pose rate', () => {
  it('clocks come from marrow and nothing clamps', () => {
    const { config } = setup();
    const run = createWorldRun(config);
    const rawMs = MARROW_TUNING.maxClockStepMs * TWO;
    const long = stepWorldFrame(run, rawMs, { paused: false, hidden: false, frame: FRAME, head: pointerAt({ x: HALF, y: HALF }) });
    // Marrow's stepClocks clamps the presence delta to maxClockStepMs; the raw delta is reported unchanged.
    expect(long.report.presenceDt).toBe(MARROW_TUNING.maxClockStepMs);
    expect(long.report.sessionDt).toBe(MARROW_TUNING.maxClockStepMs);
    expect(long.report.rawDt).toBe(rawMs);
    const short = stepWorldFrame(run, FRAME_MS, { paused: false, hidden: false, frame: FRAME, head: pointerAt({ x: HALF, y: HALF }) });
    expect(short.report.presenceDt).toBe(FRAME_MS);
    // The module does not clamp by itself: its source has no Math.min and no Math.max.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, 'worldRun.ts'), 'utf8');
    expect(source).not.toContain('Math.min');
    expect(source).not.toContain('Math.max');
  });

  it('tracking hold stops the session clock and not the presence clock', () => {
    const { config } = setup('journey', 'full', 'camera');
    const cameraConfig: RunConfig = { ...config, mode: 'camera' };
    const seen = (nose: Vec2): HeadInput => ({
      kind: 'camera',
      landmarks: cameraLandmarks(nose, true),
      wristValid: { right: true },
      cameraAspect: CAMERA_ASPECT,
    });
    let state = play(createWorldRun(cameraConfig), seen({ x: HALF, y: HALF }));
    state = play(state.run, seen({ x: HALF + NOSE_SWING * HALF, y: HALF }));
    expect(state.report.hold).toBe(false);
    const headBefore = state.report.decorativeHead;
    // Lost for longer than trackingHoldAfterMs of presence time.
    const lostFrames = Math.ceil(MARROW_TUNING.trackingHoldAfterMs / FRAME_MS) + ONE;
    let held: Played | undefined;
    for (let i = ZERO; i < lostFrames; i++) {
      state = play(state.run, {
        kind: 'camera',
        landmarks: cameraLandmarks({ x: HALF, y: HALF }, false),
        wristValid: { right: false },
        cameraAspect: CAMERA_ASPECT,
      });
      if (state.report.hold) held = state;
    }
    expect(held).toBeDefined();
    expect(held?.report.sessionDt).toBe(ZERO);
    expect(held?.report.presenceDt).toBe(FRAME_MS);
    // The head eases to centre on the presence clock during the hold.
    expect(held?.report.decorativeHead).not.toEqual(headBefore);
  });

  it('slice works at 7 pose frames per second', () => {
    const { config } = setup('journey', 'full', 'camera');
    const cameraConfig: RunConfig = { ...config, mode: 'camera' };
    const limit = (TUNING.glideCapPerS * FRAME_MS) / 1000;
    const poseMs = 1000 / POSE_HZ;
    let run = createWorldRun(cameraConfig);
    let previous: Vec2 | undefined;
    for (let i = ZERO; i < POSE_SECONDS * RENDER_HZ; i++) {
      const pose = Math.floor((i * FRAME_MS) / poseMs);
      const nose = { x: HALF + NOSE_SWING * Math.sin(pose), y: HALF };
      const played = play(run, { kind: 'camera', landmarks: cameraLandmarks(nose, true), wristValid: { right: true }, cameraAspect: CAMERA_ASPECT });
      run = played.run;
      const out = played.report.decorativeHead;
      expect(Number.isFinite(out.x) && Number.isFinite(out.y)).toBe(true);
      if (previous !== undefined) {
        expect(Math.abs(out.x - previous.x)).toBeLessThanOrEqual(limit + EPSILON);
        expect(Math.abs(out.y - previous.y)).toBeLessThanOrEqual(limit + EPSILON);
      }
      previous = out;
    }
  });
});

describe('placement of the stops', () => {
  it('the stops are placed with the hit radius of marrow', () => {
    const { stops } = setup();
    for (const stop of stops) {
      expect(stop.targets.length).toBeGreaterThan(ZERO);
      for (const target of stop.targets) expect(target.r).toBe(MARROW_TUNING.hitRadius);
    }
  });

  it('the active set is the unselected stop-1 targets while idle', () => {
    const { config } = setup();
    expect(activeTargets(createWorldRun(config))).toEqual(stopOneIds(config));
  });

  it('frame report lists the shown and active targets', () => {
    const { config } = setup();
    const played = warm(createWorldRun(config));
    expect(played.report.shown).toEqual(stopOneIds(config));
    expect(played.report.active).toEqual(stopOneIds(config));
  });
});

describe('the colour of a selection and the length of the journey', () => {
  it('12.7: a completed dwell reports the lanternWarm colour', () => {
    const { config } = setup();
    const [first] = stopOneIds(config);
    if (first === undefined) throw new Error('stop 1 needs a target');
    const selected = holdUntilSelected(warm(createWorldRun(config)), first);
    expect(selected.events).toEqual([{ kind: 'selected', targetId: first, colour: TARGET_SELECTED_TOKEN }]);
    expect(TARGET_SELECTED_TOKEN).toBe('lanternWarm');
  });

  it('13.4: a journey started in Gentle lasts 7800 ms', () => {
    const { config } = setup('journey', 'gentle');
    const [first, second] = stopOneIds(config);
    if (first === undefined || second === undefined) throw new Error('stop 1 needs two targets');
    let state = holdUntilSelected(warm(createWorldRun(config)), first);
    state = holdUntilSelected(state, second);
    const started = runUntil(state, (played) => played.report.travelPhase === 'travelling');
    const part = started.run.travel.part;
    if (part === null || part.style !== 'travel') throw new Error('the journey starts as a move');
    expect(part.durationMs).toBe(config.segment.durationMs * TUNING.gentleTravelMultiplier);
    expect(part.durationMs).toBe(7800);
  });
});
