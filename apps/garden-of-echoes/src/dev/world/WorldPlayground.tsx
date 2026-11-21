// The World Playground: the DOM screens of the forest slice (design 8.1, 8.2; Req 11, 12, 13, 14). Each
// screen reads the session and calls it. The rules are in the files of task 6 and in worldSession.ts.
// The route is `?playground=world` (main.tsx loads this file only then). The global
// `window.__worldPlayground` exists only on that route (design 8.2, Req 15.4).
import { useEffect, useReducer, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { MotionLevel, Vec2, WristId } from 'marrow/core';
import { createSettingsStore, type SettingsStore } from 'marrow/react';
import { formatIssues, TUNING, validateTuning, type ValidationIssue } from 'world-view';
import { copy } from '../../copy';
import { theme } from '../../ui/theme';
import { DebugPanel } from './DebugPanel';
import { isWorldRoute } from './route';
import { StartPanel } from './StartPanel';
import { loadWorldContent, type ContentResult, type WorldContent } from './worldContent';
import {
  createWorldSession,
  type NoticeKind,
  type SegmentKind,
  type SessionDeps,
  type WorldSession,
  type WorldSnapshot,
} from './worldSession';
import './world.css';

const STORAGE_PREFIX = 'garden-of-echoes:';
const REDUCED_QUERY = '(prefers-reduced-motion:reduce)';
const ZERO = 0;
const HEAD_MIN = -1;
const HEAD_MAX = 1;
const HEAD_STEP = 0.01;

/** The handle of the Playwright test and of a developer (Req 12.10, 15.4). Read-only apart from setHead. */
export interface WorldPlaygroundHandle {
  snapshot(): WorldSnapshot;
  setHead(head: Vec2 | null): void;
}

declare global {
  interface Window {
    __worldPlayground?: WorldPlaygroundHandle;
  }
}

export interface WorldPlaygroundProps {
  /** The content to show. The default reads the slice's JSON and validates it (Req 1.5). */
  readonly loadContent?: () => ContentResult;
  /** The tuning issues to show. The default validates the shipped tuning. */
  readonly tuningIssues?: readonly ValidationIssue[];
  /** The browser objects of the session. Tests replace them; the default is the real one. */
  readonly deps?: Partial<SessionDeps>;
}

const MOTION_OPTIONS: readonly { readonly level: MotionLevel; readonly label: string }[] = [
  { level: 'full', label: copy.worldPlayground.motionFull },
  { level: 'gentle', label: copy.worldPlayground.motionGentle },
  { level: 'reduced', label: copy.worldPlayground.motionReduced },
];

const SEGMENT_OPTIONS: readonly { readonly kind: SegmentKind; readonly label: string }[] = [
  { kind: 'journey', label: copy.worldPlayground.segmentJourney },
  { kind: 'door', label: copy.worldPlayground.segmentDoor },
];

/** The colours of the slice come from the theme module (art-and-motion.md). The CSS takes them as variables. */
function themeVariables(): CSSProperties {
  const variables: Record<string, string> = {
    '--slice-ground': theme.night,
    '--slice-text': theme.grey7,
    '--slice-accent': theme.lanternWarm,
    '--slice-glow': theme.lanternGlow,
    '--slice-cover': theme.grey0,
  };
  return variables as CSSProperties;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_QUERY).matches;
}

function noticeText(kind: NoticeKind): string {
  const text = copy.worldPlayground;
  if (kind === 'placementNotSimultaneous') return text.noticePlacementNotSimultaneous;
  if (kind === 'placementNone') return text.noticePlacementNone;
  return text.noticeSceneUnavailable;
}

export function WorldPlayground(props: WorldPlaygroundProps): ReactElement {
  const [loaded] = useState<ContentResult>(() => (props.loadContent ?? loadWorldContent)());
  const [tuningProblems] = useState<readonly ValidationIssue[]>(() => props.tuningIssues ?? validateTuning(TUNING));
  if (!loaded.ok || tuningProblems.length > ZERO) {
    const issues = loaded.ok ? tuningProblems : loaded.issues;
    return (
      <main className="world" style={themeVariables()}>
        <h1>{copy.worldPlayground.title}</h1>
        <p role="alert">{copy.worldPlayground.contentInvalid}</p>
        <pre>{formatIssues(copy.worldPlayground.issuesHeading, issues)}</pre>
      </main>
    );
  }
  return <Slice content={loaded.content} deps={props.deps} />;
}

function Slice(props: { readonly content: WorldContent; readonly deps?: Partial<SessionDeps> }): ReactElement {
  const [settings] = useState<SettingsStore>(() =>
    createSettingsStore({ prefix: STORAGE_PREFIX, prefersReducedMotion: prefersReducedMotion() }),
  );
  const playRef = useRef<HTMLDivElement>(null);
  const rightOrbRef = useRef<HTMLDivElement>(null);
  const leftOrbRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [session] = useState<WorldSession>(() =>
    createWorldSession({
      content: props.content,
      settings,
      playArea: () => playRef.current,
      handOrb: (wrist: WristId) => (wrist === 'left' ? leftOrbRef.current : rightOrbRef.current),
      video: () => videoRef.current,
      deps: props.deps,
    }),
  );
  const [, rerender] = useReducer((count: number) => count + 1, ZERO);

  useEffect(() => session.subscribe(rerender), [session]);
  useEffect(() => {
    if (!isWorldRoute(window.location.search)) return undefined;
    window.__worldPlayground = {
      snapshot: () => session.snapshot(),
      setHead: (head) => session.setHead(head),
    };
    return () => {
      delete window.__worldPlayground;
    };
  }, [session]);
  useEffect(() => () => session.dispose(), [session]);

  const snap = session.snapshot();
  const { screen } = snap;
  const text = copy.worldPlayground;
  return (
    <main className="world" style={themeVariables()}>
      <h1>{text.title}</h1>
      {screen === 'start' ? (
        <StartPanel
          segment={snap.segment}
          onSegment={(kind) => session.setSegmentKind(kind)}
          onMouse={() => session.startMouse()}
          onCamera={() => session.startCamera()}
        />
      ) : null}
      {screen === 'camera-starting' ? <p role="status">{text.cameraStarting}</p> : null}
      {screen === 'notice' && snap.notice !== null && snap.notice !== undefined ? (
        <section>
          <p role="alert">{noticeText(snap.notice)}</p>
          <button type="button" onClick={() => session.exit()}>
            {text.back}
          </button>
        </section>
      ) : null}
      <div className="play-stack">
        <div
          ref={playRef}
          data-testid="world-play-area"
          role="region"
          aria-label={text.playArea}
          className="play-area"
          style={{ touchAction: 'none' }}
          hidden={screen !== 'running'}
        />
        {/* Siblings of the Pixi host, on top of it, one per active wrist. The session moves them at the frame rate (Req 14.9). */}
        <div ref={rightOrbRef} className="hand-orb" data-wrist="right" aria-hidden="true" hidden={screen !== 'running'} />
        <div ref={leftOrbRef} className="hand-orb" data-wrist="left" aria-hidden="true" hidden={screen !== 'running'} />
      </div>
      {screen === 'running' ? <Running session={session} snap={snap} settings={settings} /> : null}
      <video ref={videoRef} className="camera-feed" muted playsInline autoPlay aria-hidden="true" />
    </main>
  );
}

function Running(props: { readonly session: WorldSession; readonly snap: WorldSnapshot; readonly settings: SettingsStore }): ReactElement {
  const { session, snap, settings } = props;
  const text = copy.worldPlayground;
  const [driver, setDriver] = useState<Vec2>({ x: ZERO, y: ZERO });
  const camera = snap.inputMode === 'camera';
  const paused = snap.paused === true;
  const motion = settings.get().motion;
  const setDriverAxis = (axis: 'x' | 'y', value: number): void => {
    const next: Vec2 = axis === 'x' ? { x: value, y: driver.y } : { x: driver.x, y: value };
    setDriver(next);
    session.setHead(next);
  };
  return (
    <section>
      <p aria-live="polite">{text.instruction}</p>
      {camera ? null : <p>{text.simulatedInput}</p>}
      {camera && snap.waitingForHead === true ? <p aria-live="polite">{text.waitingForHead}</p> : null}
      {snap.cameraNotice === true ? <p role="status">{text.cameraUnavailable}</p> : null}
      {snap.hold === true ? <p role="status">{text.trackingHold}</p> : null}
      <div className="controls">
        <button type="button" onClick={() => session.setPaused(!paused)}>
          {paused ? text.resume : text.pause}
        </button>
        <button type="button" onClick={() => session.exit()}>
          {text.exit}
        </button>
        {snap.restartAvailable === true ? (
          <button type="button" onClick={() => session.restart()}>
            {text.restart}
          </button>
        ) : null}
        {camera ? (
          <button type="button" onClick={() => session.setCentre()}>
            {text.setCentre}
          </button>
        ) : null}
      </div>
      <fieldset>
        <legend>{text.motionLegend}</legend>
        {MOTION_OPTIONS.map((option) => (
          <label key={option.level}>
            <input
              type="radio"
              name="world-motion"
              value={option.level}
              checked={motion === option.level}
              onChange={() => settings.update({ motion: option.level })}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{text.nextRestartLegend}</legend>
        {SEGMENT_OPTIONS.map((option) => (
          <label key={option.kind}>
            <input
              type="radio"
              name="world-next-segment"
              value={option.kind}
              checked={snap.segment === option.kind}
              onChange={() => session.setSegmentKind(option.kind)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{text.driverLegend}</legend>
        <label>
          {text.driverX}
          <input
            type="range"
            min={HEAD_MIN}
            max={HEAD_MAX}
            step={HEAD_STEP}
            value={driver.x}
            onChange={(event) => setDriverAxis('x', Number(event.target.value))}
          />
        </label>
        <label>
          {text.driverY}
          <input
            type="range"
            min={HEAD_MIN}
            max={HEAD_MAX}
            step={HEAD_STEP}
            value={driver.y}
            onChange={(event) => setDriverAxis('y', Number(event.target.value))}
          />
        </label>
        <button type="button" onClick={() => session.setHead(null)}>
          {text.driverOff}
        </button>
      </fieldset>
      <DebugPanel snapshot={snap} />
    </section>
  );
}
