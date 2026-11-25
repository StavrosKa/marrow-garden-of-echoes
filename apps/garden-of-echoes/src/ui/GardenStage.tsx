// The stage screen of the ?start shortcut (garden-level design 2.7, 3; requirements 4, 18, 20, 22). Simulated input over
// the whole frame, and no camera. The frame loop does three things: marrow's clocks give the time, marrow's Pointer
// Source gives the pointer, and stepGarden does the rest. The Scene Manager (Pixi, loaded when the screen starts) draws
// the forest and the lanterns, and the DOM draws the one instruction line, the label and the entry title. Each lantern
// also has a transparent DOM marker at its position, so a test can aim at it.
import { useEffect, useReducer, useRef, useState, type ReactElement } from 'react';
import type { CSSProperties } from 'react';
import { makeMapping, stepClocks, TUNING as MARROW_TUNING, type MotionLevel, type PointerInput } from 'marrow/core';
import { createPointerSource, type PoseSource } from 'marrow/input';
import { createSettingsStore, type SettingsStore } from 'marrow/react';
import { TUNING as WORLD_TUNING } from 'world-view';
import type { SceneManager } from 'world-view/pixi';
import { createGardenAudio, type GardenAudio } from '../audio/gardenAudio';
import { createTonePlayer } from '../audio/tonePlayer';
import { loadSegments } from '../journeys/journeys';
import segmentsJson from '../journeys/segments.json';
import { APP_SESSION_TUNING } from '../session/tuning';
import { loadLanternGlade } from '../stages/lantern-glade/content';
import lanternJson from '../stages/lantern-glade/content.json';
import { loadWhisperGlade } from '../stages/whisper-glade/content';
import whisperGladeJson from '../stages/whisper-glade/content.json';
import { loadWhisperHall } from '../stages/whisper-hall/content';
import whisperHallJson from '../stages/whisper-hall/content.json';
import { loadBloom } from '../stages/bloom/content';
import bloomJson from '../stages/bloom/content.json';
import { colourNumber, theme } from './theme';
import {
  backdropOf,
  type Backdrop,
  COVER_TOKEN,
  frameDataOf,
  sceneKeyOf,
  sceneLayersOf,
  sceneTargetsOf,
  TARGET_VISUAL_RATIO,
} from '../scene/sceneSetup';
import {
  createGarden,
  drawnTargetsOf,
  instructionKeyOf,
  stepGarden,
  type DrawnTarget,
  type GardenEnv,
  type GardenFrame,
  type GardenState,
} from '../session/stageDriver';
import type { StageId, TitleId } from '../session/stageOrder';
import { SIMULATED_WRISTS, wholeFrameReach } from '../session/wholeFrame';
import { browserFrames } from './frames';
import { textOf } from './copyLookup';
import { EndCard } from './EndCard';
import { InstructionLine } from './InstructionLine';
import { PauseScreen } from './PauseScreen';
import { PlayArea } from './PlayArea';

/** The play area is 16:9, as the playground's is. The scene's aspect and the pointer's aspect are both this. */
const ASPECT = 16 / 9;
const CENTRE_Y = 0.5;
const NOT_VALID_POINTER = { wrist: 'right', valid: false } as const;
const REDUCED_QUERY = '(prefers-reduced-motion:reduce)';
const PERCENT = 100;
/** The centring of a marker on its target's centre. */
const CENTRED = 'translate(-50%, -50%)';

/**
 * The style of a target's marker (Req 5.6, 8.1). A lantern marker stays transparent, as before. Each whisper marker is a
 * visible shape, so its shape and not only its colour tells the targets apart: a blue drop, a gold leaf, the fireflies (a
 * round glow) and the candles (a tall block). Colours come from the theme.
 */
export function markerStyleOf(shape: DrawnTarget['shape']): CSSProperties {
  switch (shape) {
    case 'lantern':
      return { opacity: 0 };
    case 'drop':
      return { background: theme.grey6, borderRadius: '50% 50% 50% 0', transform: `${CENTRED} rotate(-45deg)` };
    case 'leaf':
      return { background: theme.lanternWarm, borderRadius: '0 50%' };
    case 'fireflies':
      return { background: theme.lanternGlow, borderRadius: '50%' };
    case 'candles':
      return { background: theme.grey7, borderRadius: '0.15em' };
  }
}

/** A seed for one session, so each play is different (the simulator and the tests give their own seeds). */
function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

function motionNow(): MotionLevel {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_QUERY).matches ? 'reduced' : 'full';
}

/** Exit without an app above the stage: the page goes to its own address, which has no ?start value and so shows Home. */
function leaveToStartAddress(): void {
  window.location.assign(window.location.pathname);
}

/**
 * The opacity of the entry title over its time (Req 9.4, art-and-motion.md). It fades in and out over the world-view
 * fade length and is held in between. The timer is the session's time left in ENTERING.
 */
export function titleOpacity(timerMs: number): number {
  const fade = WORLD_TUNING.minFadeMs;
  const elapsed = APP_SESSION_TUNING.entryTitleMs - timerMs;
  return Math.max(0, Math.min(1, elapsed / fade, timerMs / fade));
}

/** The content and the reach of a run, built once for the screen. */
function environment(): GardenEnv {
  const reach = wholeFrameReach(ASPECT);
  return {
    content: {
      lantern: loadLanternGlade(lanternJson),
      whisper: loadWhisperGlade(whisperGladeJson),
      placeholders: {
        'whisper-hall': loadWhisperHall(whisperHallJson),
        bloom: loadBloom(bloomJson),
      },
    },
    reach: { grids: reach.grids, activeWrists: SIMULATED_WRISTS, mapping: reach.mapping, frame: { aspect: ASPECT, sceneScale: 1 } },
  };
}

/** The pointer mapping of the play area: the whole play area is the screen, with gain 1 (marrow Req 6.3). */
const POINTER_MAPPING = makeMapping({ playAspect: ASPECT, frameAspect: ASPECT, gain: 1, centre: { x: ASPECT / 2, y: CENTRE_Y } });

/** The pointer of this frame: the right wrist of the pointer source, in screen units (simulated input). */
function pointerOf(source: PoseSource): PointerInput[] {
  const wrist = source.latest()?.landmarks.rightWrist;
  if (wrist === undefined || !wrist.valid) return [NOT_VALID_POINTER];
  return [{ wrist: 'right', valid: true, pos: POINTER_MAPPING.toScreen(wrist.pos) }];
}

/** The prefix of the settings this app keeps. The App and a bare ?start stage use the same store key (Req 17.4). */
export const SETTINGS_PREFIX = 'garden-of-echoes.';

/** The stage that a restart begins at (Req 24.5). */
const RESTART_STAGE: StageId = 'lantern-glade';

export interface GardenStageProps {
  readonly stage: StageId;
  readonly onNoSlot?: () => void;
  /** Leaves the stage for Home (Pause "Exit", Req 24.5). Left out, the page goes to its address without the ?start value. */
  readonly onExit?: () => void;
  /** The settings store of the app. Left out, the stage keeps its own store of the same key. */
  readonly settings?: SettingsStore;
}

export function GardenStage(props: GardenStageProps): ReactElement {
  const { onNoSlot, onExit, settings: settingsProp } = props;
  // A restart changes `plan`, which starts the frame loop again at RESTART_STAGE (Req 24.5, the same as Retry in 10.4).
  const [plan, setPlan] = useState({ stage: props.stage, count: 0 });
  const stage = plan.stage;
  const [ownSettings] = useState(() =>
    createSettingsStore({ prefix: SETTINGS_PREFIX, prefersReducedMotion: motionNow() === 'reduced' }),
  );
  const settings = settingsProp ?? ownSettings;
  // Pause is a suspension flag (Req 1.4, 1.5). The ref is what the frame loop reads, and the state draws the screen.
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  // "Continue with help" counts presses in a ref. The frame loop sends one help request for each new press.
  const helpRef = useRef(0);
  const helpSeenRef = useRef(0);
  // The level title on screen and the session time it has left (Req 9.4). It starts at the machine's titleShown effect.
  const titleRef = useRef<{ readonly title: TitleId; readonly timerMs: number } | null>(null);
  // The help offer "Want a hint?" (Req 7.3). It is on after the offerHelp output, and off when the presentation completes.
  const offerRef = useRef(false);
  // The frame loop is set up once, so it reads the callback through a ref that holds the latest one.
  const noSlotRef = useRef(onNoSlot);
  noSlotRef.current = onNoSlot;
  const playRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GardenState | null>(null);
  const envRef = useRef<GardenEnv | null>(null);
  const audioRef = useRef<GardenAudio | null>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const [, redraw] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const area = playRef.current;
    if (area === null) return undefined;
    const env = environment();
    envRef.current = env;
    const segments = loadSegments(segmentsJson);
    gameRef.current = createGarden(segments, randomSeed());
    const audio = createGardenAudio(createTonePlayer(() => new AudioContext()));
    audioRef.current = audio;
    // The sound setting (Req 18.5, 18.6) reaches the audio at once, and the stage plays fully with it muted.
    const applySound = (): void => {
      const sound = settings.get();
      audio.setMuted(sound.mute);
      audio.setVolume(sound.volume);
    };
    applySound();
    const unsubscribe = settings.subscribe(applySound);
    const source = createPointerSource({ playArea: area, requestFrame: browserFrames.request, cancelFrame: browserFrames.cancel });
    void source.start();
    let last: number | null = null;
    let first = true;
    let handle = 0;
    let alive = true;
    let sceneKey = '';
    /** The backdrop the scene should show. It moves once, from the lantern forest to the Whisper Glade (Req 2.4). */
    let wanted: Backdrop = stage === 'lantern-glade' ? 'lantern' : 'whisper';

    const frameTargets = (state: GardenState) => drawnTargetsOf(state, env.reach.frame);
    const tick = (now: number): void => {
      if (!alive) return;
      const current = gameRef.current;
      if (current === null) return;
      const rawDt = last === null ? 0 : now - last;
      last = now;
      // Pause stops the presence clock and so the session clock too (marrow clocks). The motion setting is read here, so a
      // change in the Pause screen takes effect in this frame (Req 17.4).
      const paused = pausedRef.current;
      const clocks = stepClocks(rawDt, { paused, hidden: document.hidden, holdActive: false }, MARROW_TUNING);
      const helpRequested = helpRef.current !== helpSeenRef.current;
      helpSeenRef.current = helpRef.current;
      const frameInput: GardenFrame = {
        event: first ? { kind: 'startAt', stage } : null,
        presenceDt: clocks.presenceDt,
        sessionDt: clocks.sessionDt,
        motion: settings.get().motion,
        suspension: { paused, holdActive: false },
        pointers: pointerOf(source),
        helpRequested,
      };
      first = false;
      const step = stepGarden(env, current, frameInput);
      gameRef.current = step.state;
      for (const effect of step.effects) {
        if (effect.kind === 'lanternLit') audio.playNote(effect.index);
        // No usable slot (Req 10.6): the app shows the no-usable-slot screen in place of the stage.
        if (effect.kind === 'noSlot') noSlotRef.current?.();
        // A level title starts its time when the machine shows it (Req 9.4).
        if (effect.kind === 'session' && effect.effect.kind === 'titleShown') {
          titleRef.current = { title: effect.effect.title, timerMs: APP_SESSION_TUNING.entryTitleMs };
        }
        if (effect.kind === 'help' && effect.output.kind === 'offerHelp') offerRef.current = true;
        if (effect.kind === 'attention' && effect.event.kind === 'presentationCompleted') offerRef.current = false;
      }
      // The title's time runs on the session clock, so a pause holds it (Req 9.4, art-and-motion.md).
      const titleNow = titleRef.current;
      if (titleNow !== null) {
        titleRef.current = { ...titleNow, timerMs: Math.max(0, titleNow.timerMs - frameInput.sessionDt) };
      }
      const nextBackdrop = backdropOf(step.state.session, frameInput.motion, wanted);
      if (nextBackdrop !== wanted) {
        wanted = nextBackdrop;
        sceneRef.current?.dispose();
        sceneRef.current = null;
        sceneKey = '';
        buildScene(wanted);
      }
      const scene = sceneRef.current;
      const key = sceneKeyOf(step.state);
      if (scene !== null && key !== sceneKey) {
        sceneKey = key;
        scene.setTargets(sceneTargetsOf(step.state));
      }
      redraw();
      handle = browserFrames.request(tick);
    };

    // The longest travel ends at the last segment's `to`, which bounds the backdrop of the scene (Req 2.4).
    const travelTo = Math.max(...Object.values(segments).map((segment) => segment.to));
    const idleSession = createGarden(segments).session;

    // The scene is built for one backdrop. A switch of backdrop (Req 2.4) disposes it and builds the next one, because the
    // Scene Manager takes its layers once. A build that finishes after the backdrop has moved on is disposed.
    const buildScene = (backdrop: Backdrop): void => {
      void import('world-view/pixi').then(async (pixi) => {
        if (!alive) return;
        const scene = pixi.createSceneManager({
          host: area,
          layers: sceneLayersOf(backdrop),
          targets: [],
          sceneScale: 1,
          travelRange: { from: 0, to: travelTo },
          coverColour: colourNumber(COVER_TOKEN),
          targetVisualRatio: TARGET_VISUAL_RATIO,
          getFrame: () => {
            const state = gameRef.current;
            if (state === null) return frameDataOf({ session: idleSession, active: [], shown: [] });
            const targets = frameTargets(state);
            return frameDataOf({
              session: state.session,
              active: targets.filter((target) => target.active).map((target) => target.id),
              shown: targets.map((target) => target.id),
            });
          },
        });
        await scene.start();
        if (!alive) {
          scene.dispose();
          return;
        }
        if (backdrop !== wanted) {
          scene.dispose();
          buildScene(wanted);
          return;
        }
        sceneRef.current = scene;
      });
    };
    buildScene(wanted);
    handle = browserFrames.request(tick);
    return () => {
      alive = false;
      browserFrames.cancel(handle);
      unsubscribe();
      source.dispose();
      audio.dispose();
      sceneRef.current?.dispose();
      sceneRef.current = null;
      audioRef.current = null;
    };
  }, [stage, plan.count, settings]);

  // Escape opens Pause, and a second Escape closes it (Req 3.5). The listener belongs to the stage screen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      pausedRef.current = !pausedRef.current;
      setPaused(pausedRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Shows the game again: the pause flag is cleared in the ref at once, so the next frame runs. */
  function resume(): void {
    pausedRef.current = false;
    setPaused(false);
  }

  /** "Continue with help" from Pause (Req 24.4): the stage resumes and gets one help request in its next frame (Req 7.5). */
  function continueWithHelp(): void {
    helpRef.current += 1;
    resume();
  }

  /** Restart and Recalibrate (Req 24.5): the stage begins again at RESTART_STAGE, with no confirmation. */
  function restart(): void {
    resume();
    setPlan((current) => ({ stage: RESTART_STAGE, count: current.count + 1 }));
  }

  /** "Continue with help" in the stage (Req 7.3): one help request, for the next frame. */
  function requestHelp(): void {
    helpRef.current += 1;
  }

  const leave = onExit ?? leaveToStartAddress;

  const state = gameRef.current;
  const title = titleRef.current;
  const ended = state !== null && state.session.phase === 'SAVED';
  const inRound = state !== null && state.session.phase === 'PLAYING' && state.stage?.kind === 'whisper';
  const env = envRef.current;
  const targets = state !== null && env !== null ? drawnTargetsOf(state, env.reach.frame) : [];
  const line = state === null ? null : instructionKeyOf(state);
  return (
    <main
      className="garden-stage"
      data-phase={state?.session.phase ?? 'NONE'}
      data-stage={state?.session.stage ?? ''}
      data-travel-style={state?.session.travel?.part?.style ?? ''}
      data-travel-ms={state?.session.travel?.part?.elapsedMs ?? 0}
      data-travel-length={state?.session.travel?.part?.remainingMs ?? 0}
    >
      <p className="garden-label">{textOf('label.simulated')}</p>
      {title !== null && title.timerMs > 0 ? (
        <h1 className="garden-title" style={{ opacity: titleOpacity(title.timerMs) }}>
          {textOf(title.title === 'lantern' ? 'title.lantern' : 'title.hall')}
        </h1>
      ) : null}
      <InstructionLine required={ended || line === null ? null : textOf(line)} />
      {inRound ? (
        <div className="garden-help">
          {offerRef.current ? <p className="garden-help__offer">{textOf('help.offer')}</p> : null}
          <button type="button" className="garden-button" onClick={requestHelp}>
            {textOf('help.continue')}
          </button>
        </div>
      ) : null}
      <PlayArea aspect={ASPECT} areaRef={playRef} onPointerDown={() => audioRef.current?.start({ kind: 'pointerdown' })}>
        {targets.map((target) =>
          target.centre === null ? null : (
            <div
              key={target.id}
              data-target={target.id}
              data-lit={target.lit ? 'yes' : 'no'}
              data-active={target.active ? 'yes' : 'no'}
              data-shape={target.shape}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: `${(target.centre.x / ASPECT) * PERCENT}%`,
                top: `${target.centre.y * PERCENT}%`,
                width: `${(target.radius * 2 * PERCENT) / ASPECT}%`,
                height: `${target.radius * 2 * PERCENT}%`,
                transform: CENTRED,
                borderRadius: '50%',
                pointerEvents: 'none',
                ...markerStyleOf(target.shape),
              }}
            />
          ),
        )}
      </PlayArea>
      {ended ? <EndCard onExit={leave} /> : null}
      {paused ? (
        <PauseScreen
          settings={settings}
          onResume={resume}
          onContinueHelp={continueWithHelp}
          onRecalibrate={restart}
          onRestart={restart}
          onExit={leave}
        />
      ) : null}
    </main>
  );
}
