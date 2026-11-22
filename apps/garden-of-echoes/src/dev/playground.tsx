// The input playground (Req 26). On load it validates the tuning and the content, and shows the first problem instead
// of running. Then it runs the setup flow, the round and the play area through the controller (playgroundController.ts).
// Only the simulated-input path runs in 17.7. "Use the camera" does nothing until 17.8.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { formatTuningErrors, TUNING, validateTuning, type Tuning } from 'marrow/core';
import { createPointerSource } from 'marrow/input';
import {
  AudioSettings,
  CalibrationScreen,
  CameraPermissionScreen,
  createSettingsStore,
  MarrowCopyProvider,
  PauseOverlay,
  SettingsProvider,
  SimulatedInputLabel,
  StartScreen,
  type SettingsStorage,
} from 'marrow/react';
import type { ToneContext } from '../audio/tonePlayer';
import { copy } from '../copy';
import { ThemeProvider } from '../ui/themeProvider';
import { createPlaygroundController, type CreatePointerSource, type PlaygroundController } from './playgroundController';
import { readPlaygroundContent, type PlaygroundContent } from './playgroundContent';
import shipped from './playground-content.json';
import { PlayArea } from './playArea';
import './playground.css';

/** The storage prefix of the playground's settings. Not player-facing text. */
const STORAGE_PREFIX = 'marrow-input-playground.';

export interface PlaygroundParts {
  readonly createPointerSource: CreatePointerSource;
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
      createPointerSource: parts.createPointerSource,
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

  function screenContent(): ReactElement | null {
    switch (screen) {
      case 'cameraPermission':
        // "Use the camera" has no handler until 17.8; the button is shown because CameraPermissionScreen requires it.
        return (
          <CameraPermissionScreen
            failure={null}
            onStartCamera={() => undefined}
            onTryWithout={() => controller.send({ kind: 'tryWithout' })}
          />
        );
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
          <p aria-live="polite" className="playground-instruction">
            {text.playInstruction}
          </p>
        );
      default:
        // Hand choice and the camera error screen come with the camera in 17.8.
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
          className="playground-field"
          ref={(element) => controller.attachPlayArea(element)}
        >
          {screen === 'play' ? (
            <PlayArea
              label={text.playArea}
              targets={view.shown}
              completedIds={view.completedIds}
              wrists={['right']}
              parts={controller.playAreaParts}
            />
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
