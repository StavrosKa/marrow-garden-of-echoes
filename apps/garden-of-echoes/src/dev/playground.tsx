// The input playground (Req 26). On load it validates the tuning and the content, and shows the first problem instead
// of running. Then it runs the setup flow, the round and the play area through the controller (playgroundController.ts).
// Camera mode (17.8) uses the Camera Source from marrow/input; simulated input uses the Pointer Source.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { formatTuningErrors, TUNING, validateTuning, type Tuning } from 'marrow/core';
import { createCameraSource, createPointerSource } from 'marrow/input';
import {
  AudioSettings,
  CalibrationScreen,
  CameraPermissionScreen,
  CameraPreview,
  createSettingsStore,
  HandChoiceScreen,
  MarrowCopyProvider,
  PauseOverlay,
  SettingsProvider,
  SimulatedInputLabel,
  StartScreen,
  TrackingLostOverlay,
  type SettingsStorage,
} from 'marrow/react';
import type { ToneContext } from '../audio/tonePlayer';
import { copy } from '../copy';
import { ThemeProvider } from '../ui/themeProvider';
import {
  createPlaygroundController,
  type CreateCameraSource,
  type CreatePointerSource,
  type PlaygroundController,
} from './playgroundController';
import { readPlaygroundContent, type PlaygroundContent } from './playgroundContent';
import shipped from './playground-content.json';
import { PlayArea } from './playArea';
import './playground.css';

/** The storage prefix of the playground's settings. Not player-facing text. */
const STORAGE_PREFIX = 'marrow-input-playground.';
/** The largest width of the camera preview, in CSS px (Req 22.5). An app value, listed in Appendix B. */
const PREVIEW_MAX_PX = 320;

export interface PlaygroundParts {
  readonly createPointerSource: CreatePointerSource;
  readonly createCameraSource: CreateCameraSource;
  /** The browser's getUserMedia. The default is `navigator.mediaDevices.getUserMedia`. */
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** The app's base path. The default is `import.meta.env.BASE_URL`, so the camera's files come from under it. */
  readonly basePath: string;
  readonly requestFrame: (callback: (timestampMs: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly createToneContext: () => ToneContext;
  /** Where the settings are kept. Undefined: the browser's local storage. Null: memory only. Tests pass null. */
  readonly settingsStorage?: SettingsStorage | null;
}

export interface PlaygroundProps {
  /** The tuning object to check. The shipped TUNING by default (Req 1.4). */
  readonly tuning?: Tuning;
  /** The parsed playground-content.json. The shipped file by default (Req 26.3). */
  readonly content?: unknown;
  /** Replaces the browser parts. The defaults are the real ones. */
  readonly parts?: Partial<PlaygroundParts>;
}

/** What the playground can run with, or the one problem to show. */
export type PlaygroundLoad =
  | { readonly kind: 'ready'; readonly content: PlaygroundContent }
  | { readonly kind: 'tuning'; readonly message: string }
  | { readonly kind: 'content'; readonly message: string };

/** Checks the tuning first, then the content. The first failing check decides what is shown. */
export function loadPlayground(tuning: Tuning, content: unknown): PlaygroundLoad {
  const errors = validateTuning(tuning);
  if (errors.length > 0) return { kind: 'tuning', message: formatTuningErrors(errors) };
  const result = readPlaygroundContent(content);
  if (!result.ok) return { kind: 'content', message: result.message };
  return { kind: 'ready', content: result.content };
}

const BROWSER_PARTS: PlaygroundParts = {
  createPointerSource,
  createCameraSource,
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  basePath: import.meta.env.BASE_URL,
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  createToneContext: () => new AudioContext(),
};

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The first focusable control of the current screen, for focus after a screen change. */
function firstScreenControl(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>('.playground-screen button') ?? null;
}

interface RunProps {
  readonly content: PlaygroundContent;
  readonly parts: PlaygroundParts;
}

/** The running playground: one controller for the page, subscribed through useSyncExternalStore. */
function Run({ content, parts }: RunProps): ReactElement {
  const [controller] = useState<PlaygroundController>(() =>
    createPlaygroundController({
      content,
      settings: createSettingsStore({
        prefix: STORAGE_PREFIX,
        prefersReducedMotion: prefersReducedMotion(),
        storage: parts.settingsStorage,
      }),
      basePath: parts.basePath,
      createPointerSource: parts.createPointerSource,
      createCameraSource: parts.createCameraSource,
      getUserMedia: parts.getUserMedia,
      requestFrame: parts.requestFrame,
      cancelFrame: parts.cancelFrame,
      createToneContext: parts.createToneContext,
    }),
  );
  const view = useSyncExternalStore(controller.subscribe, controller.getView);
  const rootRef = useRef<HTMLDivElement>(null);
  const pauseRef = useRef<HTMLButtonElement>(null);
  const previous = useRef({ paused: false, screen: 'start' });
  // One loop, one tone player and one set of listeners per mount. StrictMode's second mount starts them again.
  useEffect(() => controller.mount(), [controller]);
  // Focus after a change: a new screen focuses its first control; closing Pause returns focus to the Pause control.
  useEffect(() => {
    const before = previous.current;
    previous.current = { paused: view.setup.paused, screen: view.setup.screen };
    if (before.screen !== view.setup.screen) {
      firstScreenControl(rootRef.current)?.focus();
      return;
    }
    if (before.paused && !view.setup.paused) pauseRef.current?.focus();
  }, [view.setup.paused, view.setup.screen]);

  const { setup } = view;
  const { screen } = setup;
  const text = copy.playground;
  const marrow = copy.marrow;
  const simulated = setup.mode === 'simulated';
  /** The preview is shown during hand choice and calibration only, and removed when play starts (17.8). */
  const showPreview =
    setup.mode === 'camera' &&
    view.previewStream !== null &&
    (screen === 'handChoice' || screen === 'calibrating' || screen === 'noUsableSlot');

  function screenContent(): ReactElement | null {
    switch (screen) {
      case 'cameraPermission':
        // Retry and "Use the camera" both start the camera from their click (Req 5.1).
        return (
          <CameraPermissionScreen
            failure={null}
            onStartCamera={() => controller.send({ kind: 'useCamera' })}
            onTryWithout={() => controller.send({ kind: 'tryWithout' })}
          />
        );
      case 'cameraError':
        return (
          <CameraPermissionScreen
            failure={setup.failure}
            onStartCamera={() => controller.send({ kind: 'useCamera' })}
            onTryWithout={() => controller.send({ kind: 'tryWithout' })}
          />
        );
      case 'handChoice':
        return <HandChoiceScreen onContinue={(hand) => controller.send({ kind: 'handChosen', hand })} />;
      case 'calibrating':
      case 'noUsableSlot':
        if (view.calibration === null || view.mapping === null) return null;
        return (
          <CalibrationScreen
            calibration={view.calibration}
            mapping={view.mapping}
            pointers={view.calibrationPointers}
            noUsableSlot={screen === 'noUsableSlot'}
            onRetry={() => controller.send({ kind: 'retryCalibration' })}
            onWholeScreen={() => controller.send({ kind: 'wholeScreen' })}
            onTryWithout={() => controller.send({ kind: 'tryWithout' })}
            onSkipHeadView={() => controller.skipHeadView()}
          />
        );
      case 'play':
        return (
          <>
            {view.oneWristHint ? (
              <p aria-live="polite" className="playground-hint">
                {marrow.tracking.oneWristHint}
              </p>
            ) : null}
            <p aria-live="polite" className="playground-instruction">
              {text.playInstruction}
            </p>
          </>
        );
      default:
        return null;
    }
  }

  if (screen === 'start') {
    return (
      <SettingsProvider store={controller.settings}>
        <div ref={rootRef} className="playground-root">
          <div className="playground-screen">
            <StartScreen onStart={() => controller.pressStart()} />
          </div>
        </div>
      </SettingsProvider>
    );
  }

  return (
    <SettingsProvider store={controller.settings}>
      <div ref={rootRef} className="playground-root">
        <div className="playground-chrome">
          <button
            ref={pauseRef}
            type="button"
            className="marrow-button"
            onClick={() => controller.send({ kind: 'pauseControl' })}
          >
            {marrow.pause.pause}
          </button>
          <AudioSettings />
          {simulated ? <SimulatedInputLabel /> : null}
        </div>
        <div
          className={view.holding ? 'playground-field playground-field--held' : 'playground-field'}
          ref={(element) => controller.attachPlayArea(element)}
        >
          {screen === 'play' ? (
            <PlayArea
              label={text.playArea}
              targets={view.shown}
              completedIds={view.completedIds}
              wrists={['left', 'right']}
              parts={controller.playAreaParts}
            />
          ) : null}
          {showPreview && view.previewStream !== null ? (
            <div className="playground-preview">
              <CameraPreview stream={view.previewStream} maxWidth={PREVIEW_MAX_PX} />
            </div>
          ) : null}
          <div className="playground-screen">{screenContent()}</div>
        </div>
        {setup.paused ? (
          <PauseOverlay
            onResume={() => controller.send({ kind: 'resume' })}
            onRecalibrate={() => controller.send({ kind: 'recalibrate' })}
            onExit={() => controller.send({ kind: 'exit' })}
          />
        ) : null}
        {setup.trackingLost && !setup.paused ? (
          <TrackingLostOverlay
            onRecover={() => controller.send({ kind: 'recover' })}
            onTryWithout={() => controller.send({ kind: 'tryWithout' })}
            onExit={() => controller.send({ kind: 'exit' })}
          />
        ) : null}
      </div>
    </SettingsProvider>
  );
}

export function Playground({ tuning = TUNING, content = shipped, parts = {} }: PlaygroundProps): ReactElement {
  const load = loadPlayground(tuning, content);
  const resolved: PlaygroundParts = { ...BROWSER_PARTS, ...parts };
  return (
    <ThemeProvider>
      <MarrowCopyProvider value={copy.marrow}>
        <main className="playground-main">
          <h1>{copy.playground.title}</h1>
          {load.kind === 'ready' ? (
            <Run content={load.content} parts={resolved} />
          ) : (
            <>
              <p role="alert">{load.kind === 'tuning' ? copy.playground.tuningInvalid : copy.playground.contentInvalid}</p>
              <h2>{copy.playground.detailHeading}</h2>
              <pre>{load.message}</pre>
            </>
          )}
        </main>
      </MarrowCopyProvider>
    </ThemeProvider>
  );
}
