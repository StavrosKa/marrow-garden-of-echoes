// The controller of the input playground (design sections 14.1 to 14.5). Plain TypeScript with no React: the component
// subscribes to `getView`. Each click or key handler calls `send` or `pressStart`, and `send` runs the effects of the
// setup flow in that same call, so the browser sees the audio start, the camera request and the Pointer Source begin
// from the gesture that caused them (Req 27.1, 5.1, 22.2).
//
// `mount` owns the one frame loop, the tone player and the window listeners. Its cleanup stops them and disposes the
// sources. React StrictMode mounts, unmounts and mounts again, which therefore leaves exactly one loop and one source
// of each kind (the tests check this).
//
// Two sources exist at most, one per mode. The Pointer Source serves simulated input. The Camera Source (17.8) serves
// camera mode, and it is created and started only by `startCamera`, which the click that asked for the camera calls.
// The app's getUserMedia wrapper keeps the stream for the preview; the source keeps the tracks and stops them.
import { TUNING, dwellView, type CalibrationState, type HitArea, type Mapping } from 'marrow/core';
import type { CameraSourceOptions, PoseSource } from 'marrow/input';
import type { CalibrationPointer, DebugSnapshot, HandChoice, SettingsStore } from 'marrow/react';
import { createTonePlayer, type ToneContext, type TonePlayer } from '../audio/tonePlayer';
import {
  createDriver,
  startFrameLoop,
  type DriverConfig,
  type DriverState,
  type DriverStep,
  type FrameLoop,
  type FrameReading,
} from './frameDriver';
import type { PlaygroundContent } from './playgroundContent';
import {
  applyPlayAreaPlan,
  createPlayAreaParts,
  PLAY_ASPECT,
  planPlayArea,
  type PlayAreaParts,
  type TargetInput,
} from './playAreaPlan';
import { advanceRound, COMPLETE_EASE_MS, firstRound, NO_ROUND, recordSelection, type RoundProgress } from './playgroundRounds';
import { calibrationDemand, openTargets, type RoundEnvironment, type RoundTarget } from './roundController';
import { INITIAL_SETUP, stepSetup, type SetupEffect, type SetupEvent, type SetupState } from './setupFlow';
import { keepDebugWindow, refreshDue } from './playgroundDebug';

/** The Pointer Source's constructor, as the playground calls it. It matches `createPointerSource` of marrow/input. */
export type CreatePointerSource = (options: {
  readonly playArea: HTMLElement;
  readonly requestFrame: (callback: (frameTimeMs: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
}) => PoseSource;

/** The Camera Source's constructor, as the playground calls it. It matches `createCameraSource` of marrow/input. */
export type CreateCameraSource = (options: CameraSourceOptions) => PoseSource;

/** What the controller needs from the browser, passed in so that tests can replace each part. */
export interface PlaygroundDeps {
  readonly content: PlaygroundContent;
  readonly settings: SettingsStore;
  /** The app's base path, from `import.meta.env.BASE_URL`. Every URL of the camera's files is built from it. */
  readonly basePath: string;
  readonly createPointerSource: CreatePointerSource;
  readonly createCameraSource: CreateCameraSource;
  /** The browser's getUserMedia. The controller calls it through a wrapper that keeps the stream for the preview. */
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  readonly requestFrame: (callback: (timestampMs: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly createToneContext: () => ToneContext;
  /** Whether the page shows the Debug Overlay (`debug=1`, Req 25.1). The snapshot is built only when it is on. */
  readonly debug: boolean;
}

/** What the component draws. It changes only when the controller notifies its listeners. */
export interface PlaygroundView {
  readonly setup: SetupState;
  readonly calibration: CalibrationState | null;
  readonly mapping: Mapping | null;
  /** The filtered camera-space pointers of the calibration, for its orbs. */
  readonly calibrationPointers: readonly CalibrationPointer[];
  /** The round's targets that are drawn now: open ones, and the ones completed in this round. */
  readonly shown: readonly RoundTarget[];
  readonly completedIds: readonly string[];
  /** The camera's stream while a camera run is open, for the preview. Null otherwise. */
  readonly previewStream: MediaStream | null;
  /** Whether a tracking hold is in effect: the play area dims (Req 23.10). */
  readonly holding: boolean;
  /** Whether the one-wrist hint shows (Req 18.9). */
  readonly oneWristHint: boolean;
}

export interface PlaygroundController {
  /** The settings store the page's providers read. */
  readonly settings: SettingsStore;
  /** Whether the Debug Overlay is on for this page. */
  readonly debugEnabled: boolean;
  /** Subscribes to the Debug Overlay's snapshot. It changes at most every DEBUG_REFRESH_MS, or at a change a player sees. */
  subscribeDebug(listener: () => void): () => void;
  getDebugSnapshot(): DebugSnapshot | null;
  subscribe(listener: () => void): () => void;
  getView(): PlaygroundView;
  /** Starts the loop, the tone player and the listeners. Returns the cleanup that stops them and the sources. */
  mount(): () => void;
  /** The play field element, which the Pointer Source listens on. The component sets it through a ref. */
  attachPlayArea(element: HTMLElement | null): void;
  /** The registered elements of the play area, which the component fills through refs. */
  readonly playAreaParts: PlayAreaParts;
  /** The Start control: creates or resumes the audio context in this handler (Req 27.1), then starts the flow. */
  pressStart(): void;
  /** Sends one event to the setup flow. Its effects run before this returns. */
  send(event: SetupEvent): void;
  /** "Skip head view" in the calm hold (Req 12.6, 12.7). */
  skipHeadView(): void;
}

const ORIGIN = { x: 0, y: 0 };

/** The wrists a hand choice uses (Req 22.4). */
function wristsOf(hand: HandChoice): ('left' | 'right')[] {
  if (hand === 'both') return ['left', 'right'];
  return [hand];
}

export function createPlaygroundController(deps: PlaygroundDeps): PlaygroundController {
  const listeners = new Set<() => void>();
  const playAreaParts = createPlayAreaParts();
  let setup: SetupState = INITIAL_SETUP;
  let progress: RoundProgress = NO_ROUND;
  /** The session clock: the sum of the session deltas of every step (Req 16.5, 16.7). */
  let sessionMs = 0;
  let hidden = false;
  let playArea: HTMLElement | null = null;
  let loop: FrameLoop | null = null;
  let pointer: PoseSource | null = null;
  let camera: PoseSource | null = null;
  let previewStream: MediaStream | null = null;
  let pendingHand: HandChoice | null = null;
  /** A camera run waiting for its first frame, so that the frame aspect is known (Req 10.1). */
  let pendingCameraRun: { readonly hand: HandChoice } | null = null;
  let holding = false;
  let oneWristHint = false;
  let tone: TonePlayer | null = null;
  // The Debug Overlay's inputs: the frame times in the debug window, the time of the last tick, and the head offset.
  let renderTimes: number[] = [];
  let newFrameTimes: number[] = [];
  let lastNowMs = 0;
  let lastRefreshMs = Number.NEGATIVE_INFINITY;
  let headOffset = ORIGIN;
  let debugSnapshot: DebugSnapshot | null = null;
  const debugListeners = new Set<() => void>();

  function driverState(): DriverState | null {
    return loop?.state() ?? null;
  }

  function roundEnvironment(driver: DriverState): RoundEnvironment | null {
    const result = driver.calibration.result;
    if (result === null) return null;
    return {
      content: deps.content,
      playAspect: PLAY_ASPECT,
      frameAspect: driver.config.frameAspect,
      grids: result.grids,
      mapping: driver.mapping,
    };
  }

  function buildView(): PlaygroundView {
    const driver = driverState();
    const round = progress.round;
    const completedIds = round?.completed ?? [];
    const open = round !== null && setup.screen === 'play' ? new Set(openTargets(round).map((target) => target.id)) : null;
    const shown =
      round === null || open === null
        ? []
        : round.targets.filter((target) => open.has(target.id) || completedIds.includes(target.id));
    const calibrationPointers: CalibrationPointer[] =
      driver === null
        ? []
        : driver.config.activeWrists.map((wrist) => {
            const pointerOf = driver.cameraPointers[wrist];
            return pointerOf !== undefined && pointerOf.valid
              ? { wrist, valid: true, pos: pointerOf.pos }
              : { wrist, valid: false, pos: ORIGIN };
          });
    return {
      setup,
      calibration: driver?.calibration ?? null,
      mapping: driver?.mapping ?? null,
      calibrationPointers,
      shown,
      completedIds,
      previewStream,
      holding,
      oneWristHint,
    };
  }

  let view: PlaygroundView = buildView();

  function notify(): void {
    view = buildView();
    for (const listener of [...listeners]) listener();
  }

  /**
   * The Debug Overlay's snapshot of this frame: the values the playground draws, from the same state. The overlay gets
   * the latest refreshed copy (refreshDebugSnapshot), so its numbers are at most DEBUG_REFRESH_MS of frame time old.
   */
  function buildDebugSnapshot(): DebugSnapshot {
    const driver = driverState();
    return {
      mode: setup.mode,
      nowMs: lastNowMs,
      renderTimesMs: renderTimes,
      newFrameTimesMs: newFrameTimes,
      frameDrawnAtMs: driver?.frameDrawnAtMs ?? null,
      frame: driver?.lastFrame ?? null,
      playAspect: PLAY_ASPECT,
      activeWrists: driver?.config.activeWrists ?? ['right'],
      mapping: driver?.mapping ?? null,
      grids: driver?.calibration.grids ?? {},
      hitAreas: hitAreas(),
      headOffset,
    };
  }

  /** Refreshes the overlay's copy when a change a player sees happened, or when DEBUG_REFRESH_MS have passed (Req 25.5). */
  function refreshDebugSnapshot(changed: boolean): void {
    if (!deps.debug) return;
    if (!refreshDue({ changed, nowMs: lastNowMs, lastMs: lastRefreshMs })) return;
    lastRefreshMs = lastNowMs;
    debugSnapshot = buildDebugSnapshot();
    for (const listener of [...debugListeners]) listener();
  }

  function disposePointer(): void {
    pointer?.dispose();
    pointer = null;
  }

  /** Disposes the Camera Source, detaches the preview stream (Req 5.6). The source stops its own tracks. */
  function disposeCamera(): void {
    camera?.dispose();
    camera = null;
    previewStream = null;
  }

  function simulatedConfig(): DriverConfig {
    return {
      mode: 'simulated',
      activeWrists: ['right'],
      playAspect: PLAY_ASPECT,
      frameAspect: PLAY_ASPECT,
      demand: calibrationDemand(deps.content, PLAY_ASPECT),
      tuning: TUNING,
    };
  }

  function cameraConfig(hand: HandChoice, frameAspect: number): DriverConfig {
    return {
      mode: 'camera',
      activeWrists: wristsOf(hand),
      playAspect: PLAY_ASPECT,
      frameAspect,
      demand: calibrationDemand(deps.content, PLAY_ASPECT),
      tuning: TUNING,
    };
  }

  /**
   * Requests the camera from the click that asked for it (Req 5.1). The getUserMedia wrapper keeps the stream of this
   * camera only while it is the current one, so a stream from a replaced camera never reaches the preview.
   */
  function startCamera(): void {
    disposeCamera();
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const source: PoseSource = deps.createCameraSource({
      basePath: deps.basePath,
      video,
      getUserMedia: (constraints) => {
        const request = deps.getUserMedia(constraints);
        request.then(
          (stream) => {
            if (camera === source) {
              previewStream = stream;
              notify();
            }
          },
          () => undefined,
        );
        return request;
      },
    });
    camera = source;
    void source.start().then((outcome) => {
      if (camera === source) send({ kind: 'cameraOutcome', outcome });
    });
  }

  function disposeSource(): void {
    disposePointer();
    pendingCameraRun = null;
  }

  /** A calibration run: the mode decides which source serves it, and each run starts a fresh driver state. */
  function startCalibrationRun(mode: 'camera' | 'simulated'): void {
    if (mode === 'camera') {
      disposePointer();
      progress = NO_ROUND;
      loop?.replace(null);
      pendingCameraRun = { hand: pendingHand ?? 'right' };
      return;
    }
    disposeSource();
    if (playArea !== null) {
      pointer = deps.createPointerSource({
        playArea,
        requestFrame: deps.requestFrame,
        cancelFrame: deps.cancelFrame,
      });
      void pointer.start();
    }
    progress = NO_ROUND;
    loop?.replace(createDriver(simulatedConfig()));
  }

  /** Starts a waiting camera run once its first frame exists. Called from the loop's read, on every tick. */
  function startPendingCameraRun(): void {
    if (pendingCameraRun === null || camera === null) return;
    const frame = camera.latest();
    if (frame === null) return;
    const { hand } = pendingCameraRun;
    pendingCameraRun = null;
    progress = NO_ROUND;
    loop?.replace(createDriver(cameraConfig(hand, frame.aspect)));
  }

  /** Calibration has a transform: place the first round and report the Placement result (Req 26.4). */
  function onCalibrationComplete(): void {
    const driver = driverState();
    if (driver === null) return;
    const env = roundEnvironment(driver);
    if (env === null) return;
    progress = firstRound(env);
    send({ kind: 'placed', placement: progress.round?.mode ?? 'none' });
  }

  /**
   * "Use the whole screen" (Req 11.15). Calibration that already completed (the no-usable-slot screen) is restarted
   * first, so that the whole-screen completion starts from painting.
   */
  function completeWholeScreen(): void {
    if (loop === null) return;
    if (loop.state()?.calibration.phase === 'complete') loop.act({ kind: 'retry' });
    if (loop.act({ kind: 'wholeScreen' })) onCalibrationComplete();
  }

  function discardRun(): void {
    loop?.replace(null);
    progress = NO_ROUND;
    disposeSource();
  }

  function runEffect(effect: SetupEffect): void {
    switch (effect.kind) {
      case 'requestCamera':
        startCamera();
        return;
      case 'disposeCamera':
        disposeCamera();
        return;
      case 'startCalibration':
        startCalibrationRun(effect.mode);
        return;
      case 'completeWholeScreen':
        completeWholeScreen();
        return;
      case 'discardCalibration':
        discardRun();
        return;
    }
  }

  function send(event: SetupEvent): void {
    if (event.kind === 'handChosen') pendingHand = event.hand;
    const step = stepSetup(setup, event);
    setup = step.state;
    for (const effect of step.effects) runEffect(effect);
    refreshDebugSnapshot(true);
    notify();
  }

  /** A selected target: its tone plays once, and the round records the time (Req 26.9). */
  function selectTarget(targetId: string): void {
    const round = progress.round;
    if (round === null) return;
    const next = recordSelection(progress, targetId, sessionMs);
    if (next === progress) return;
    const index = round.targets.findIndex((target) => target.id === targetId);
    if (index >= 0) tone?.playTarget(index);
    progress = next;
  }

  function targetInputs(driver: DriverState): TargetInput[] {
    const round = progress.round;
    if (round === null || setup.screen !== 'play') return [];
    const open = new Set(openTargets(round).map((target) => target.id));
    return round.targets.map((target) => {
      const dwell = dwellView(driver.dwell, target.id);
      const completed = round.completed.includes(target.id);
      return {
        id: target.id,
        centre: target.slot,
        shown: open.has(target.id) || completed,
        completed,
        completedAtMs: progress.completedAtMs[target.id] ?? null,
        owner: dwell.owner,
        progress: dwell.progress,
      };
    });
  }

  function hitAreas(): HitArea[] {
    const round = progress.round;
    if (setup.screen !== 'play' || round === null) return [];
    return openTargets(round).map((target) => ({
      targetId: target.id,
      activationId: target.activationId,
      centre: target.slot,
      radius: TUNING.hitRadius,
    }));
  }

  function read(timestampMs: number): FrameReading {
    startPendingCameraRun();
    lastNowMs = timestampMs;
    renderTimes = keepDebugWindow([...renderTimes, timestampMs], timestampMs);
    // Before the first run there is no step to refresh the overlay, so the idle tick does it.
    if (driverState() === null) refreshDebugSnapshot(false);
    const active = setup.mode === 'camera' ? camera : pointer;
    return { paused: setup.paused, hidden, frame: active?.latest() ?? null, hitAreas: hitAreas() };
  }

  /** One animation frame of the run: the session clock, the tracking events, the round, and the drawing. */
  function onStep(step: DriverStep): void {
    const before = progress;
    const wasHolding = holding;
    const wasHint = oneWristHint;
    const wasScreen = setup.screen;
    sessionMs += step.sessionDt;
    holding = step.holdActive;
    oneWristHint = step.oneWristHint;
    headOffset = step.headOffset;
    if (step.newFrame) newFrameTimes = keepDebugWindow([...newFrameTimes, lastNowMs], lastNowMs);
    for (const event of step.trackingEvents) {
      if (event.kind === 'overlayShown') send({ kind: 'overlayShown' });
      if (event.kind === 'holdEnded') send({ kind: 'holdEnded' });
    }
    if (step.calibrationCompleted) onCalibrationComplete();
    const driver = driverState();
    if (driver === null) return;
    for (const event of step.dwellEvents) selectTarget(event.targetId);
    const env = roundEnvironment(driver);
    if (env !== null && progress.round !== null) progress = advanceRound(progress, sessionMs, env);
    applyPlayAreaPlan(
      playAreaParts,
      planPlayArea({
        hitRadius: TUNING.hitRadius,
        nowMs: sessionMs,
        easeMs: COMPLETE_EASE_MS,
        targets: targetInputs(driver),
        pointers: step.pointers,
      }),
    );
    const changed = progress !== before || setup.screen !== wasScreen || holding !== wasHolding || oneWristHint !== wasHint;
    refreshDebugSnapshot(changed);
    // The calibration screen draws its orbs from React, so it is notified every frame. The play area does not.
    if (changed || setup.screen !== 'play') notify();
  }

  function mount(): () => void {
    tone = createTonePlayer(deps.createToneContext);
    const applyAudio = (): void => {
      const { volume, mute } = deps.settings.get();
      tone?.setVolume(volume);
      tone?.setMuted(mute);
    };
    applyAudio();
    const unsubscribeAudio = deps.settings.subscribe(applyAudio);
    hidden = document.hidden;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.repeat) send({ kind: 'escape' });
    };
    // A tab switch only sets the hidden flag (Req 16.3). The camera stays open.
    const onVisibility = (): void => {
      hidden = document.hidden;
    };
    // The page is leaving: the camera is released (Req 5.7).
    const onPageHide = (): void => {
      disposeCamera();
      notify();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    loop = startFrameLoop({
      initial: null,
      read,
      onStep,
      requestFrame: deps.requestFrame,
      cancelFrame: deps.cancelFrame,
    });
    refreshDebugSnapshot(true);
    notify();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribeAudio();
      loop?.stop();
      loop = null;
      disposePointer();
      disposeCamera();
      pendingCameraRun = null;
      tone?.dispose();
      tone = null;
    };
  }

  return {
    settings: deps.settings,
    debugEnabled: deps.debug,
    subscribeDebug(listener) {
      debugListeners.add(listener);
      return () => {
        debugListeners.delete(listener);
      };
    },
    getDebugSnapshot: () => debugSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getView: () => view,
    mount,
    attachPlayArea(element) {
      playArea = element;
    },
    playAreaParts,
    pressStart() {
      tone?.start();
      send({ kind: 'start' });
    },
    send,
    skipHeadView() {
      if (loop?.act({ kind: 'skipHeadView' })) onCalibrationComplete();
      notify();
    },
  };
}
