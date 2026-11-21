// @vitest-environment jsdom
// The React update of the session (design 8.2; Req 11.7): at most one update per DEBUG_REFRESH_MS of frame time
// while nothing a player sees changes, and at once when a frame changes a selection, the hold, the waiting line,
// the restart button or the travel phase. The browser objects are fakes, so no test loads Pixi or a camera. A
// frame is the Scene Manager's two callbacks: getFrame with the raw frame delta, then onFrame with the circles.
import { describe, expect, it, vi, type Mock } from 'vitest';
import { TUNING as MARROW_TUNING, type Vec2 } from 'marrow/core';
import type { PoseSource } from 'marrow/input';
import { createSettingsStore } from 'marrow/react';
import type { HitCircle, SceneManager, SceneManagerOptions } from 'world-view/pixi';
import { DEBUG_REFRESH_MS, DEFAULT_ASPECT } from './constants';
import { cameraComfort } from './placementSetup';
import { loadWorldContent, type WorldContent } from './worldContent';
import { createWorldSession, type SessionDeps, type WorldSession } from './worldSession';

const FRAME_MS = 16;
/** The centre of the play area in play units; the pointer and the circle both sit here. */
const CENTRE: Vec2 = { x: DEFAULT_ASPECT * 0.5, y: 0.5 };
const NO_POINT = { pos: { x: 0, y: 0 }, valid: false };

interface Point {
  pos: Vec2;
  valid: boolean;
}

/** The camera's landmarks, changed by a test between frames. */
interface FakePose {
  leftWrist: Point;
  rightWrist: Point;
  nose: Point;
  leftShoulder: Point;
  rightShoulder: Point;
}

type Scene = ReturnType<typeof fakeScene>;

function fakeScene() {
  return {
    start: vi.fn(async () => undefined),
    dispose: vi.fn(),
    hitCircles: () => [],
    projectionFrame: () => ({ aspect: DEFAULT_ASPECT, sceneScale: 1 }),
    setTargets: vi.fn(),
    setTargetColour: vi.fn(),
    debugLayers: () => [],
    debugTargets: () => [],
    canvasSize: () => ({ width: 960, height: 540 }),
  };
}

function validContent(): WorldContent {
  const loaded = loadWorldContent();
  if (!loaded.ok) throw new Error('the shipped content must be valid for these tests');
  return loaded.content;
}

interface Rig {
  readonly session: WorldSession;
  readonly options: SceneManagerOptions[];
  readonly scene: Scene;
  readonly listener: Mock<() => void>;
}

/**
 * Creates a session, subscribes a listener, starts the session in `mode` ('mouse' or 'camera'), and waits until
 * the scene has started. The pointer and the camera report the given landmarks on every frame.
 */
async function startRig(mode: 'mouse' | 'camera', pose: FakePose, pointerWrist: Point): Promise<Rig> {
  const options: SceneManagerOptions[] = [];
  const scenes: Scene[] = [];
  const area = document.createElement('div');
  document.body.append(area);
  const video = document.createElement('video');
  const camera = {
    start: vi.fn(async () => 'ready' as const),
    latest: () => ({ t: 0, aspect: 4 / 3, landmarks: pose }),
    dispose: vi.fn(),
  };
  const pointer = {
    start: vi.fn(async () => 'ready' as const),
    latest: () => ({ landmarks: { rightWrist: pointerWrist } }),
    dispose: vi.fn(),
  };
  const deps: Partial<SessionDeps> = {
    createScene: async (sceneOptions) => {
      options.push(sceneOptions);
      const scene = fakeScene();
      scenes.push(scene);
      return scene as unknown as SceneManager;
    },
    createCamera: () => camera as unknown as PoseSource,
    createPointer: () => pointer as unknown as PoseSource,
    isHidden: () => false,
  };
  const session = createWorldSession({
    content: validContent(),
    settings: createSettingsStore({ prefix: 'world-session-test:', prefersReducedMotion: false }),
    playArea: () => area,
    handOrb: () => null,
    video: () => video,
    deps,
  });
  const listener = vi.fn();
  session.subscribe(listener);
  if (mode === 'mouse') session.startMouse();
  else session.startCamera();
  await vi.waitFor(() => expect(scenes[0]?.start).toHaveBeenCalled());
  const scene = scenes[0];
  if (scene === undefined) throw new Error('the scene did not start');
  return { session, options, scene, listener };
}

/** One frame of the scene: the frame delta, then the circles that the frame drew. */
function frame(rig: Rig, dt: number, circles: readonly HitCircle[] = []): void {
  const sceneOptions = rig.options[0];
  if (sceneOptions === undefined) throw new Error('the scene has not been created');
  sceneOptions.getFrame(dt);
  sceneOptions.onFrame?.(circles);
}

/** Runs frames until the listener is called, so that the next frame cannot be the timer's frame. */
function frameUntilNotified(rig: Rig): void {
  for (let i = 0; i < 100; i++) {
    const before = rig.listener.mock.calls.length;
    frame(rig, FRAME_MS);
    if (rig.listener.mock.calls.length > before) return;
  }
  throw new Error('the listener was never called');
}

function allInvalidPose(): FakePose {
  return {
    leftWrist: NO_POINT,
    rightWrist: NO_POINT,
    nose: NO_POINT,
    leftShoulder: NO_POINT,
    rightShoulder: NO_POINT,
  };
}

/** A mouse pointer whose hand is at the centre of the play area (the pointer takes camera-style coordinates). */
const CENTRE_HAND: Point = { pos: { x: 0.5, y: 0.5 }, valid: true };
const NO_HAND: Point = { pos: { x: 0, y: 0 }, valid: false };

describe('the React update of the session (design 8.2; Req 11.7)', () => {
  it('at most one update per DEBUG_REFRESH_MS of frame time while nothing a player sees changes', async () => {
    const rig = await startRig('mouse', allInvalidPose(), NO_HAND);
    frame(rig, FRAME_MS);
    rig.listener.mockClear();
    const frames = 300;
    for (let i = 0; i < frames; i++) frame(rig, FRAME_MS);
    const totalMs = frames * FRAME_MS;
    expect(rig.listener.mock.calls.length).toBeGreaterThan(0);
    expect(rig.listener.mock.calls.length).toBeLessThanOrEqual(Math.floor(totalMs / DEBUG_REFRESH_MS));
  });

  it('a selection notifies in the frame that makes it', async () => {
    const rig = await startRig('mouse', allInvalidPose(), CENTRE_HAND);
    const target = rig.options[0]?.targets[0];
    if (target === undefined) throw new Error('the scene has no target');
    const circle: HitCircle = { id: target.id, centre: CENTRE, radius: 0.1 };
    let selectedInFrame = false;
    for (let i = 0; i < 300 && !selectedInFrame; i++) {
      const before = rig.listener.mock.calls.length;
      const coloured = rig.scene.setTargetColour.mock.calls.length;
      frame(rig, FRAME_MS, [circle]);
      if (rig.scene.setTargetColour.mock.calls.length > coloured) {
        expect(rig.listener.mock.calls.length).toBe(before + 1);
        selectedInFrame = true;
      }
    }
    expect(selectedInFrame).toBe(true);
  });

  it('a hold change notifies in the frame that makes it', async () => {
    const rig = await startRig('camera', allInvalidPose(), NO_HAND);
    frame(rig, FRAME_MS);
    let flipped = false;
    for (let i = 0; i < 200 && !flipped; i++) {
      const before = rig.listener.mock.calls.length;
      const held = rig.session.snapshot().hold === true;
      frame(rig, FRAME_MS);
      if (!held && rig.session.snapshot().hold === true) {
        expect(rig.listener.mock.calls.length).toBe(before + 1);
        flipped = true;
      }
    }
    expect(flipped).toBe(true);
  });

  it('a change of the waiting line notifies in the frame that makes it', async () => {
    const pose = allInvalidPose();
    const rig = await startRig('camera', pose, NO_HAND);
    expect(rig.session.snapshot().waitingForHead).toBe(true);
    frameUntilNotified(rig);
    const before = rig.listener.mock.calls.length;
    pose.nose = { pos: { x: 0.5, y: 0.3 }, valid: true };
    pose.leftShoulder = { pos: { x: 0.4, y: 0.6 }, valid: true };
    pose.rightShoulder = { pos: { x: 0.6, y: 0.6 }, valid: true };
    frame(rig, FRAME_MS);
    expect(rig.session.snapshot().waitingForHead).toBe(false);
    expect(rig.listener.mock.calls.length).toBe(before + 1);
  });

  it('a button call still notifies at once, while the frames are throttled', async () => {
    const rig = await startRig('mouse', allInvalidPose(), NO_HAND);
    frame(rig, FRAME_MS);
    const before = rig.listener.mock.calls.length;
    rig.session.setPaused(true);
    expect(rig.listener.mock.calls.length).toBe(before + 1);
    rig.session.setCentre();
    expect(rig.listener.mock.calls.length).toBe(before + 2);
  });
});

/** The screen position of a camera point, through the comfort mapping of camera mode (the one the slice uses). */
function cameraScreen(point: Vec2): Vec2 {
  return cameraComfort(DEFAULT_ASPECT, MARROW_TUNING.cameraWidth / MARROW_TUNING.cameraHeight).mapping.toScreen(point);
}

describe('the two hands of the camera mode (Req 14.2, 14.6, 14.9)', () => {
  it('14.2: a target is selected with only the left wrist on it', async () => {
    const pose = allInvalidPose();
    pose.leftWrist = { pos: { x: 0.3, y: 0.4 }, valid: true };
    const rig = await startRig('camera', pose, NO_HAND);
    const target = rig.options[0]?.targets[0];
    if (target === undefined) throw new Error('the scene has no target');
    const circle: HitCircle = { id: target.id, centre: cameraScreen(pose.leftWrist.pos), radius: 0.1 };
    for (let i = 0; i < 300 && rig.scene.setTargetColour.mock.calls.length === 0; i++) {
      frame(rig, FRAME_MS, [circle]);
    }
    expect(rig.scene.setTargetColour).toHaveBeenCalledWith(target.id, expect.any(Number));
  });

  it('14.6: the hold does not begin while the left wrist alone is valid, and begins once both are invalid for the hold time', async () => {
    const pose = allInvalidPose();
    pose.leftWrist = { pos: { x: 0.5, y: 0.5 }, valid: true };
    const rig = await startRig('camera', pose, NO_HAND);
    for (let i = 0; i < 100; i++) frame(rig, FRAME_MS);
    expect(rig.session.snapshot().hold).toBe(false);
    pose.leftWrist = { pos: { x: 0.5, y: 0.5 }, valid: false };
    let elapsedMs = 0;
    let held = false;
    for (let i = 0; i < 100 && !held; i++) {
      frame(rig, FRAME_MS);
      elapsedMs += FRAME_MS;
      held = rig.session.snapshot().hold === true;
    }
    expect(held).toBe(true);
    expect(elapsedMs).toBeGreaterThan(MARROW_TUNING.trackingHoldAfterMs);
    expect(elapsedMs).toBeLessThanOrEqual(MARROW_TUNING.trackingHoldAfterMs + 2 * FRAME_MS);
  });

  it('14.9: in camera mode the snapshot lists both pointers, right first, each at its own position', async () => {
    const pose = allInvalidPose();
    pose.rightWrist = { pos: { x: 0.2, y: 0.3 }, valid: true };
    pose.leftWrist = { pos: { x: 0.6, y: 0.5 }, valid: true };
    const rig = await startRig('camera', pose, NO_HAND);
    frame(rig, FRAME_MS);
    expect(rig.session.snapshot().pointers).toEqual([
      { wrist: 'right', valid: true, pos: cameraScreen(pose.rightWrist.pos) },
      { wrist: 'left', valid: true, pos: cameraScreen(pose.leftWrist.pos) },
    ]);
  });

  it('14.9: in mouse mode there is one pointer, for the right wrist', async () => {
    const rig = await startRig('mouse', allInvalidPose(), CENTRE_HAND);
    frame(rig, FRAME_MS);
    const pointers = rig.session.snapshot().pointers;
    expect(pointers?.map((hand) => hand.wrist)).toEqual(['right']);
    expect(pointers?.[0]?.valid).toBe(true);
  });
});
