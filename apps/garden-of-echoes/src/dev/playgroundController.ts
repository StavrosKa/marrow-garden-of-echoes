// The controller of the input playground (design sections 14.1 to 14.5). Plain TypeScript with no React: the component
// subscribes to `getView`. Each click or key handler calls `send` or `pressStart`, and `send` runs the effects of the
// setup flow in that same call, so the browser sees the audio start and the Pointer Source begin from the gesture
// that caused them (Req 27.1, 5.1, 22.2).
//
// `mount` owns the one frame loop, the tone player and the window listeners. Its cleanup stops them and disposes the
// Pointer Source. React StrictMode mounts, unmounts and mounts again, which therefore leaves exactly one loop and one
// source (the test in playground.test.tsx checks this).
//
// Camera effects (`requestCamera`, `disposeCamera`) are not wired in 17.7. Camera start, its outcomes and the camera
// calibration come in 17.8, so "Use the camera" does nothing in this step.
import { TUNING, dwellView, type CalibrationState, type HitArea, type Mapping } from 'marrow/core';
import type { PoseSource } from 'marrow/input';
import type { CalibrationPointer, SettingsStore } from 'marrow/react';
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
import {
  calibrationDemand,
  openTargets,
  type RoundEnvironment,
  type RoundTarget,
} from './roundController';
import { INITIAL_SETUP, stepSetup, type SetupEffect, type SetupEvent, type SetupState } from './setupFlow';

/** The Pointer Source's constructor, as the playground calls it. It matches `createPointerSource` of marrow/input. */
export type CreatePointerSource = (options: {
  readonly playArea: HTMLElement;
  readonly requestFrame: (callback: (frameTimeMs: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
}) => PoseSource;

/** What the controller needs from the browser, passed in so that tests can replace each part. */
export interface PlaygroundDeps {
  readonly content: PlaygroundContent;
  readonly settings: SettingsStore;
  readonly createPointerSource: CreatePointerSource;
  readonly requestFrame: (callback: (timestampMs: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly createToneContext: () => ToneContext;
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
}

export interface PlaygroundController {
  /** The settings store the page's providers read. */
  readonly settings: SettingsStore;
  subscribe(listener: () => void): () => void;
  getView(): PlaygroundView;
  /** Starts the loop, the tone player and the listeners. Returns the cleanup that stops them. */
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
  let source: PoseSource | null = null;
  let tone: TonePlayer | null = null;

  function driverState(): DriverState | null {
    return loop?.state() ?? null;
  }

  function roundEnvironment(driver: DriverState): RoundEnvironment | null {
    const result = driver.calibration.result;
    if (result === null) return null;
    return {
      content: deps.content,
      playAspect: PLAY_ASPECT,
      frameAspect: PLAY_ASPECT,
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
            const pointer = driver.cameraPointers[wrist];
            return pointer !== undefined && pointer.valid
              ? { wrist, valid: true, pos: pointer.pos }
              : { wrist, valid: false, pos: ORIGIN };
          });
    return {
      setup,
      calibration: driver?.calibration ?? null,
      mapping: driver?.mapping ?? null,
      calibrationPointers,
      shown,
      completedIds,
    };
  }

  let view: PlaygroundView = buildView();

  function notify(): void {
    view = buildView();
    for (const listener of [...listeners]) listener();
  }

  function disposeSource(): void {
    source?.dispose();
    source = null;
  }

  function calibrationConfig(): DriverConfig {
    return {
      mode: 'simulated',
      activeWrists: ['right'],
      playAspect: PLAY_ASPECT,
      frameAspect: PLAY_ASPECT,
      demand: calibrationDemand(deps.content, PLAY_ASPECT),
      tuning: TUNING,
    };
  }

  /** A new calibration run: one Pointer Source at a time (plan point 6), and a fresh driver state. */
  function startCalibrationRun(mode: 'camera' | 'simulated'): void {
    // Camera calibration arrives with the camera source in 17.8.
    if (mode !== 'simulated') return;
    disposeSource();
    if (playArea !== null) {
      source = deps.createPointerSource({
        playArea,
        requestFrame: deps.requestFrame,
        cancelFrame: deps.cancelFrame,
      });
      void source.start();
    }
    progress = NO_ROUND;
    loop?.replace(createDriver(calibrationConfig()));
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
      case 'disposeCamera':
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
    const step = stepSetup(setup, event);
    setup = step.state;
    for (const effect of step.effects) runEffect(effect);
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

  function read(): FrameReading {
    return { paused: setup.paused, hidden, frame: source?.latest() ?? null, hitAreas: hitAreas() };
  }

  /** One animation frame of the run: the session clock, the round, the drawing, and the notifications it needs. */
  function onStep(step: DriverStep): void {
    const before = progress;
    sessionMs += step.sessionDt;
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
    // The calibration screen draws its orbs from React, so it is notified every frame. The play area does not.
    if (progress !== before || setup.screen !== 'play') notify();
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
    const onVisibility = (): void => {
      hidden = document.hidden;
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    loop = startFrameLoop({
      initial: null,
      read,
      onStep,
      requestFrame: deps.requestFrame,
      cancelFrame: deps.cancelFrame,
    });
    notify();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribeAudio();
      loop?.stop();
      loop = null;
      disposeSource();
      tone?.dispose();
      tone = null;
    };
  }

  return {
    settings: deps.settings,
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
