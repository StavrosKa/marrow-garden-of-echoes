// The browser side of the slice: the Scene Manager, marrow's Pointer Source and Camera Source, and the
// screen state that follows them. Every rule is in the files of task 6. Each frame goes through
// stepWorldFrame and afterRender of worldRun.ts, and the placement through placeStops. Nothing here
// decides a value. Tests replace the three browser objects through `deps`.
import { createCameraSource, createPointerSource, type PoseSource } from 'marrow/input';
import {
  makeMapping,
  TUNING as MARROW_TUNING,
  type HeadViewPointer,
  type Landmark,
  type Mapping,
  type PointerInput,
  type PoseLandmarks,
  type Vec2,
  type WristId,
} from 'marrow/core';
import type { SettingsStore } from 'marrow/react';
import { TUNING, type ProjectionFrame, type TravelPhase } from 'world-view';
import type { FrameData, HitCircle, SceneManager, SceneManagerOptions } from 'world-view/pixi';
import { browserFrames } from '../../ui/frames';
import { colourNumber } from '../../ui/theme';
import { COVER_COLOUR, DEBUG_REFRESH_MS, DEFAULT_ASPECT, TARGET_VISUAL_RATIO } from './constants';
import { buildSnapshot, deepFreeze, type DebugSnapshot, type HandSnapshot } from './debugSnapshot';
import {
  activeWristsOf,
  cameraComfort,
  mouseComfort,
  placeStops,
  type ComfortSetup,
  type PlacementNotice,
  type PlacedStop,
} from './placementSetup';
import { sceneLayers, sceneTargets } from './sceneSpec';
import {
  afterRender,
  createWorldRun,
  restartRun,
  requestRunSetCentre,
  setRunHeadDriver,
  stepWorldFrame,
  stopTargetIds,
  type FrameReport,
  type HeadInput,
  type InputMode,
  type RunConfig,
  type WorldRun,
} from './worldRun';
import type { ContentSegment, WorldContent } from './worldContent';

const ZERO = 0;
const HALF = 0.5;
const ONE = 1;
const SECOND_STOP_INDEX = 1;
/** The wrists in the order of the hand orbs and of the pointers: right first (Req 14.9). */
const WRISTS: readonly WristId[] = ['right', 'left'];
/** The play area is 16:9 by CSS (960 by 540 CSS px), so the scene's aspect is exactly this value. */
const PLAY_ASPECT = DEFAULT_ASPECT;
const RADIUS = MARROW_TUNING.hitRadius;
const SCENE_PLAY_CENTRE: Vec2 = { x: PLAY_ASPECT * HALF, y: HALF };
/** The mapping of the Pointer Source: the base mapping with gain 1 (marrow Req 6.3). */
const POINTER_MAPPING: Mapping = makeMapping({
  playAspect: PLAY_ASPECT,
  frameAspect: PLAY_ASPECT,
  gain: ONE,
  centre: SCENE_PLAY_CENTRE,
});
const NOT_VALID: Landmark = { pos: { x: ZERO, y: ZERO }, valid: false };
const EMPTY_LANDMARKS: PoseLandmarks = {
  leftWrist: NOT_VALID,
  rightWrist: NOT_VALID,
  nose: NOT_VALID,
  leftShoulder: NOT_VALID,
  rightShoulder: NOT_VALID,
};

export type Screen = 'start' | 'camera-starting' | 'running' | 'notice';
export type SegmentKind = ContentSegment['kind'];
/** Why the slice stopped before the scene: a placement notice (Req 12.2), or a scene that did not start. */
export type NoticeKind = PlacementNotice | 'sceneUnavailable';

/** The browser objects the session uses. The defaults are the real ones; tests pass fakes. */
export interface SessionDeps {
  readonly createScene: (options: SceneManagerOptions) => Promise<SceneManager>;
  readonly createCamera: (video: HTMLVideoElement) => PoseSource;
  readonly createPointer: (playArea: HTMLElement) => PoseSource;
  readonly isHidden: () => boolean;
}

/** Pixi is loaded only when a scene is made, so the tests of this file never load it. */
export const DEFAULT_DEPS: SessionDeps = {
  createScene: async (options) => (await import('world-view/pixi')).createSceneManager(options),
  createCamera: (video) => createCameraSource({ basePath: import.meta.env.BASE_URL, video }),
  createPointer: (playArea) =>
    createPointerSource({ playArea, requestFrame: browserFrames.request, cancelFrame: browserFrames.cancel }),
  isHidden: () => document.hidden,
};

export interface SessionOptions {
  readonly content: WorldContent;
  readonly settings: SettingsStore;
  readonly playArea: () => HTMLElement | null;
  /** The orb over the play area of each active wrist (Req 14.9). The session sets its position and visibility. */
  readonly handOrb: (wrist: WristId) => HTMLElement | null;
  readonly video: () => HTMLVideoElement | null;
  readonly deps?: Partial<SessionDeps>;
}

/** The screen state that a player sees and that a frame can change; the React update waits for a change of it. */
interface VisibleState {
  readonly hold: boolean;
  readonly waitingForHead: boolean;
  readonly restartAvailable: boolean;
  readonly travelPhase: TravelPhase;
}

function sameVisible(a: VisibleState, b: VisibleState | null): boolean {
  return (
    b !== null &&
    a.hold === b.hold &&
    a.waitingForHead === b.waitingForHead &&
    a.restartAvailable === b.restartAvailable &&
    a.travelPhase === b.travelPhase
  );
}

/** What the screens and the Playwright test read: the screen, and the debug snapshot once a frame has run. */
export type WorldSnapshot = Partial<DebugSnapshot> & {
  readonly screen: Screen;
  readonly notice: NoticeKind | null;
  readonly cameraNotice: boolean;
  readonly segment: SegmentKind;
  readonly waitingForHead: boolean;
  readonly restartAvailable: boolean;
};

export interface WorldSession {
  snapshot(): WorldSnapshot;
  subscribe(listener: () => void): () => void;
  startMouse(): void;
  startCamera(): void;
  setPaused(paused: boolean): void;
  setSegmentKind(kind: SegmentKind): void;
  setHead(head: Vec2 | null): void;
  setCentre(): void;
  restart(): void;
  exit(): void;
  dispose(): void;
}

function pointerOf(wrist: WristId, valid: boolean, pos: Vec2): PointerInput {
  return valid ? { wrist, valid: true, pos } : { wrist, valid: false };
}

/** The landmark of one wrist of a pose (Req 14.9: each active wrist has its own). */
function wristLandmark(landmarks: PoseLandmarks, wrist: WristId): Landmark {
  return wrist === 'left' ? landmarks.leftWrist : landmarks.rightWrist;
}

function videoAspect(video: HTMLVideoElement | null): number {
  if (video !== null && video.videoWidth > ZERO && video.videoHeight > ZERO) return video.videoWidth / video.videoHeight;
  return MARROW_TUNING.cameraWidth / MARROW_TUNING.cameraHeight;
}

export function createWorldSession(options: SessionOptions): WorldSession {
  const { content, settings } = options;
  const deps: SessionDeps = { ...DEFAULT_DEPS, ...options.deps };
  const listeners = new Set<() => void>();
  const playFrame: ProjectionFrame = { aspect: PLAY_ASPECT, sceneScale: content.sceneScale };
  const travelRange = { from: ZERO, to: Math.max(...content.segments.map((segment) => segment.to)) };

  let screen: Screen = 'start';
  let kind: SegmentKind = 'journey';
  let mode: InputMode = 'mouse';
  let notice: NoticeKind | null = null;
  let cameraNotice = false;
  let paused = false;
  /** Bumped by every start, exit and dispose, so that a late answer from an old start does nothing. */
  let epoch = 0;
  let comfort: ComfortSetup | null = null;
  let cameraAspect = videoAspect(null);
  let run: WorldRun | null = null;
  let report: FrameReport | null = null;
  let scene: SceneManager | null = null;
  let pointer: PoseSource | null = null;
  let camera: PoseSource | null = null;
  let pointers: PointerInput[] = [];
  let circles: readonly HitCircle[] = [];
  /** The frame time, from the raw deltas, since the last frame notify (the React update of afterFrame). */
  let sinceFrameNotifyMs = ZERO;
  /** The visible state of the frame before this one; null until the first frame of a run. */
  let lastVisible: VisibleState | null = null;

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function waitingForHead(): boolean {
    return mode === 'camera' && run !== null && run.neutral.neutral === null;
  }

  function restartAvailable(): boolean {
    const current = run;
    return current !== null && stopTargetIds(current.config, SECOND_STOP_INDEX).some((id) => current.selected.includes(id));
  }

  function visibleState(current: FrameReport): VisibleState {
    return {
      hold: current.hold,
      waitingForHead: waitingForHead(),
      restartAvailable: restartAvailable(),
      travelPhase: current.travelPhase,
    };
  }

  /** This frame's pointers for the debug snapshot (Req 14.9): one per active wrist, right first. */
  function handsOf(): HandSnapshot[] {
    return pointers.map((hand) =>
      hand.valid
        ? { wrist: hand.wrist, valid: true, pos: { x: hand.pos.x, y: hand.pos.y } }
        : { wrist: hand.wrist, valid: false, pos: null },
    );
  }

  /**
   * Moves the hand orb of each wrist (Req 14.9). An orb is shown only for an active wrist of the mode, in camera
   * mode, while that wrist is valid, and it is placed at that wrist's pointer of this frame, scaled by the play
   * area's height in CSS px. The style is set here, not by React, so the orbs move at the frame rate.
   */
  function moveHands(): void {
    const playArea = options.playArea();
    const active = activeWristsOf(mode);
    for (const wrist of WRISTS) {
      const orb = options.handOrb(wrist);
      if (orb === null) continue;
      const hand = pointers.find((pointer) => pointer.wrist === wrist);
      const shown = mode === 'camera' && active.includes(wrist) && hand?.valid === true;
      orb.hidden = !shown;
      if (!shown || hand === undefined || !hand.valid || playArea === null) continue;
      const height = playArea.offsetHeight;
      orb.style.transform = `translate(${hand.pos.x * height}px,${hand.pos.y * height}px)`;
    }
  }

  function segmentFor(wanted: SegmentKind): ContentSegment {
    const found = content.segments.find((segment) => segment.kind === wanted);
    if (found === undefined) throw new Error(`world slice: the content has no ${wanted} segment`);
    return found;
  }

  function releaseAll(): void {
    camera?.dispose();
    pointer?.dispose();
    scene?.dispose();
    camera = null;
    pointer = null;
    scene = null;
    run = null;
    report = null;
    circles = [];
    pointers = [];
    lastVisible = null;
    sinceFrameNotifyMs = ZERO;
    for (const wrist of WRISTS) {
      const orb = options.handOrb(wrist);
      if (orb !== null) orb.hidden = true;
    }
  }

  function showNotice(kindOfNotice: NoticeKind): void {
    epoch += 1;
    releaseAll();
    notice = kindOfNotice;
    screen = 'notice';
    notify();
  }

  /** The head input and the dwell pointers of one frame, in mouse mode. */
  function mouseFrame(): { head: HeadInput; pointers: PointerInput[] } {
    const wrist = pointer?.latest()?.landmarks.rightWrist ?? NOT_VALID;
    const pos = POINTER_MAPPING.toScreen(wrist.pos);
    const headPointer: HeadViewPointer = { valid: wrist.valid, pos };
    return {
      head: { kind: 'pointer', pointer: headPointer, playAspect: PLAY_ASPECT },
      pointers: activeWristsOf('mouse').map((hand) => pointerOf(hand, wrist.valid, pos)),
    };
  }

  /** The head input and the dwell pointers of one frame, in camera mode: one pointer per active wrist (Req 14.2, 14.6). */
  function cameraFrame(): { head: HeadInput; pointers: PointerInput[] } {
    const latest = camera?.latest();
    const landmarks = latest?.landmarks ?? EMPTY_LANDMARKS;
    const frameAspect = latest?.aspect ?? cameraAspect;
    const mapping = comfort?.mapping ?? POINTER_MAPPING;
    return {
      head: {
        kind: 'camera',
        landmarks,
        wristValid: { left: landmarks.leftWrist.valid, right: landmarks.rightWrist.valid },
        cameraAspect: frameAspect,
      },
      pointers: activeWristsOf('camera').map((hand) => {
        const landmark = wristLandmark(landmarks, hand);
        return pointerOf(hand, landmark.valid, mapping.toScreen(landmark.pos));
      }),
    };
  }

  /** Scene Manager callback: one frame of the run, built from the projection frame the scene used. */
  function frameData(rawDt: number): FrameData {
    if (run === null || scene === null) throw new Error('world slice: a frame was requested without a run');
    const input = mode === 'camera' ? cameraFrame() : mouseFrame();
    const step = stepWorldFrame(run, rawDt, {
      paused,
      hidden: deps.isHidden(),
      frame: scene.projectionFrame(),
      head: input.head,
    });
    run = step.run;
    report = step.report;
    pointers = input.pointers;
    sinceFrameNotifyMs += rawDt;
    return step.frame;
  }

  /**
   * Scene Manager callback after the render: the dwell step over this frame's circles (Req 12.3), the hand orb
   * (Req 14.9), and the React update. The update runs at once when this frame changes what a player sees (a
   * selection, or a change of hold, waiting line, restart button or travel phase), and otherwise at most once
   * per DEBUG_REFRESH_MS of frame time. Every other notify is immediate.
   */
  function afterFrame(hit: readonly HitCircle[]): void {
    circles = hit;
    if (run === null || report === null) return;
    const step = afterRender(run, hit, pointers);
    run = step.run;
    for (const event of step.events) scene?.setTargetColour(event.targetId, colourNumber(event.colour));
    moveHands();
    const visible = visibleState(report);
    const changed = step.events.length > ZERO || !sameVisible(visible, lastVisible);
    lastVisible = visible;
    if (!changed && sinceFrameNotifyMs < DEBUG_REFRESH_MS) return;
    sinceFrameNotifyMs = ZERO;
    notify();
  }

  /** Places the stops and starts the scene. A placement that fails shows its notice and starts nothing (Req 12.2). */
  function begin(setup: ComfortSetup): void {
    comfort = setup;
    const outcome = placeStops(content, segmentFor(kind), playFrame, setup.grids, setup.mapping, RADIUS);
    if (!outcome.ok) {
      showNotice(outcome.notice);
      return;
    }
    const playArea = options.playArea();
    if (playArea === null) {
      showNotice('sceneUnavailable');
      return;
    }
    const config: RunConfig = {
      content,
      tuning: TUNING,
      segment: segmentFor(kind),
      stops: outcome.stops,
      settings,
      mode,
    };
    run = createWorldRun(config);
    report = null;
    circles = [];
    lastVisible = null;
    sinceFrameNotifyMs = ZERO;
    if (mode === 'mouse') {
      pointer = deps.createPointer(playArea);
      void pointer.start();
    }
    screen = 'running';
    notify();
    const token = epoch;
    const sceneOptions: SceneManagerOptions = {
      host: playArea,
      layers: sceneLayers(content),
      targets: sceneTargets(outcome.stops),
      sceneScale: content.sceneScale,
      travelRange,
      coverColour: COVER_COLOUR,
      targetVisualRatio: TARGET_VISUAL_RATIO,
      getFrame: frameData,
      onFrame: afterFrame,
    };
    deps
      .createScene(sceneOptions)
      .then(async (created) => {
        if (token !== epoch) {
          created.dispose();
          return;
        }
        scene = created;
        await created.start();
      })
      .catch(() => {
        if (token === epoch) showNotice('sceneUnavailable');
      });
  }

  function startMouseInternal(afterCamera: boolean): void {
    epoch += 1;
    mode = 'mouse';
    cameraNotice = afterCamera;
    notice = null;
    begin(mouseComfort(PLAY_ASPECT, RADIUS));
  }

  function startCameraInternal(video: HTMLVideoElement): void {
    epoch += 1;
    const token = epoch;
    mode = 'camera';
    cameraNotice = false;
    notice = null;
    screen = 'camera-starting';
    notify();
    // The first call of the start is the browser's permission prompt, so it runs inside the click.
    const source = deps.createCamera(video);
    camera = source;
    source.start().then((outcome) => {
      if (token !== epoch) return;
      if (outcome === 'ready') {
        cameraAspect = videoAspect(video);
        begin(cameraComfort(PLAY_ASPECT, cameraAspect));
        return;
      }
      // Denied, missing or without a model: a plain notice, and the slice continues with the mouse (Req 14.7).
      camera?.dispose();
      camera = null;
      startMouseInternal(true);
    });
  }

  return {
    snapshot(): WorldSnapshot {
      const base =
        run !== null && report !== null && scene !== null
          ? buildSnapshot(run, report, {
              canvas: scene.canvasSize(),
              pixelRatio: window.devicePixelRatio,
              layers: scene.debugLayers(),
              rendered: scene.debugTargets(),
              circles,
              pointers: handsOf(),
            })
          : undefined;
      return deepFreeze({
        ...base,
        screen,
        notice,
        cameraNotice,
        segment: kind,
        waitingForHead: waitingForHead(),
        restartAvailable: restartAvailable(),
      });
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    startMouse(): void {
      startMouseInternal(false);
    },
    startCamera(): void {
      const video = options.video();
      if (video === null) return;
      startCameraInternal(video);
    },
    setPaused(value: boolean): void {
      paused = value;
      notify();
    },
    setSegmentKind(next: SegmentKind): void {
      kind = next;
      notify();
    },
    setHead(head: Vec2 | null): void {
      if (run !== null) run = setRunHeadDriver(run, head);
      notify();
    },
    setCentre(): void {
      if (run !== null) run = requestRunSetCentre(run);
      notify();
    },
    restart(): void {
      if (run === null || comfort === null) return;
      const segment = segmentFor(kind);
      const outcome = placeStops(content, segment, playFrame, comfort.grids, comfort.mapping, RADIUS);
      if (!outcome.ok) {
        showNotice(outcome.notice);
        return;
      }
      const placed: readonly PlacedStop[] = outcome.stops;
      run = restartRun({ ...run, config: { ...run.config, segment, stops: placed } });
      scene?.setTargets(sceneTargets(placed));
      notify();
    },
    exit(): void {
      epoch += 1;
      releaseAll();
      paused = false;
      notice = null;
      cameraNotice = false;
      screen = 'start';
      notify();
    },
    dispose(): void {
      epoch += 1;
      releaseAll();
      listeners.clear();
    },
  };
}
