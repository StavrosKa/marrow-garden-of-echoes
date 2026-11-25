// The stage screen of the ?start shortcut (garden-level design 2.7, 3; requirements 4, 18, 20, 22). Simulated input over
// the whole frame, and no camera. The frame loop does three things: marrow's clocks give the time, marrow's Pointer
// Source gives the pointer, and stepGarden does the rest. The Scene Manager (Pixi, loaded when the screen starts) draws
// the forest and the lanterns, and the DOM draws the one instruction line, the label and the entry title. Each lantern
// also has a transparent DOM marker at its position, so a test can aim at it.
import { useEffect, useReducer, useRef, useState, type ReactElement } from 'react';
import type { CSSProperties } from 'react';
import {
  createHeadView,
  makeMapping,
  stepClocks,
  stepHeadView,
  TUNING as MARROW_TUNING,
  type HeadViewInput,
  type MotionLevel,
  type PointerInput,
  type PoseLandmarks,
  type Vec2,
} from 'marrow/core';
import { createPointerSource, type PoseSource } from 'marrow/input';
import { createSettingsStore, type SettingsStore } from 'marrow/react';
import { createLowRate, stepLowRate, takeHint } from '../session/lowRate';
import { TUNING as WORLD_TUNING } from 'world-view';
import type { SceneManager } from 'world-view/pixi';
import { createGardenAudio, type GardenAudio } from '../audio/gardenAudio';
import { createTonePlayer } from '../audio/tonePlayer';
import { loadSegments } from '../journeys/journeys';
import segmentsJson from '../journeys/segments.json';
import { APP_SESSION_TUNING, headScaleOf } from '../session/tuning';
import { loadLanternGlade } from '../stages/lantern-glade/content';
import lanternJson from '../stages/lantern-glade/content.json';
import { loadWhisperGlade } from '../stages/whisper-glade/content';
import whisperGladeJson from '../stages/whisper-glade/content.json';
import { loadWhisperHall } from '../stages/whisper-hall/content';
import whisperHallJson from '../stages/whisper-hall/content.json';
import { loadBloom } from '../stages/bloom/content';
import bloomJson from '../stages/bloom/content.json';
import { lanternColoursOf } from '../stages/lantern-glade/scene';
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
import { motionAt } from './motion';
import { InstructionLine } from './InstructionLine';
import { PauseScreen } from './PauseScreen';
import { PlayArea } from './PlayArea';

/** The play area is 16:9, as the playground's is. The scene's aspect and the pointer's aspect are both this. */
const ASPECT = 16 / 9;
const CENTRE_Y = 0.5;
const NOT_VALID_POINTER = { wrist: 'right', valid: false } as const;
/** The head offset at rest. Literal zeros, so it is never -0. */
const REST_HEAD: Vec2 = { x: 0, y: 0 };
/** The simulated head reads no landmark: the pointer alone sets the offset (Req 6.7), so every landmark is left out as invalid. */
const NO_LANDMARK = { pos: REST_HEAD, valid: false } as const;
const NO_LANDMARKS: PoseLandmarks = {
  leftWrist: NO_LANDMARK,
  rightWrist: NO_LANDMARK,
  nose: NO_LANDMARK,
  leftShoulder: NO_LANDMARK,
  rightShoulder: NO_LANDMARK,
};
/** The head offset scaled by the motion level. A zero scale gives a literal zero, so it is never -0. */
function scaledHead(offset: Vec2, scale: number): Vec2 {
  return scale === 0 ? REST_HEAD : { x: offset.x * scale, y: offset.y * scale };
}
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

/**
 * The copy key of the instruction the player must act on now, or null (Req 15.3). An instruction is pending while the
 * session is entering a stage, playing it, or in Bloom. Travel, celebration and the end card have none, so the quiet hint
 * may show then.
 */
export function requiredLineOf(state: GardenState): string | null {
  const phase = state.session.phase;
  if (phase !== 'ENTERING' && phase !== 'PLAYING' && phase !== 'BLOOM') return null;
  return instructionKeyOf(state);
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

/** A pose frame of the pointer source, or null before the first one. */
type Pose = ReturnType<PoseSource['latest']>;

/** The pointer of this frame: the right wrist of the pose frame, in screen units (simulated input). */
function pointerOf(pose: Pose): PointerInput[] {
  const wrist = pose?.landmarks.rightWrist;
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
  // Whether the quiet light hint has been shown in this play (Req 16.2: once per session).
  const hintShownRef = useRef(false);
  // The frame loop is set up once, so it reads the callback through a ref that holds the latest one.
  const noSlotRef = useRef(onNoSlot);
  noSlotRef.current = onNoSlot;
  const playRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GardenState | null>(null);
  // The session time of this play. It counts the session delta of each frame, so Pause holds it (Req 1.4). It is shown as
  // data-timer-ms on the stage element.
  const sessionClockRef = useRef(0);
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
    let lastPose: Pose = null;
    // The rate watch and its hint belong to one play, so a restart starts both again (Req 16.2).
    let rate = createLowRate();
    hintShownRef.current = false;
    let handle = 0;
    let alive = true;
    let sceneKey = '';
    // The session time of this play: the flicker of the lit lanterns runs on it (Req 17.2).
    sessionClockRef.current = 0;
    // The head view of the simulated pointer (marrow's head view, Req 6.7). It is reset with each play.
    let headState = createHeadView();
    /** The backdrop the scene should show. It moves once, from the lantern forest to the Whisper Glade (Req 2.4). */
    let wanted: Backdrop = stage === 'lantern-glade' ? 'lantern' : 'whisper';

    const frameTargets = (state: GardenState) => drawnTargetsOf(state, env.reach.frame, state.view.interaction);
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
      // A new pose frame is one the source built since the last frame (by reference, design 9.7). The rate watch counts them
      // on the presence clock, so a pause does not count as a low rate (Req 16.1, 16.2).
      const pose = source.latest();
      const delivered = pose !== null && pose !== lastPose ? 1 : 0;
      lastPose = pose;
      rate = stepLowRate(rate, { dtMs: clocks.presenceDt, delivered });
      const helpRequested = helpRef.current !== helpSeenRef.current;
      helpSeenRef.current = helpRef.current;
      const pointers = pointerOf(pose);
      const pointer = pointers[0] ?? NOT_VALID_POINTER;
      const headInput: HeadViewInput = {
        mode: 'simulated',
        tuning: MARROW_TUNING,
        landmarks: NO_LANDMARKS,
        frameAspect: ASPECT,
        neutral: null,
        skip: false,
        playAspect: ASPECT,
        pointer: pointer.valid ? { valid: true, pos: pointer.pos } : { valid: false, pos: REST_HEAD },
      };
      const headStep = stepHeadView(headState, headInput, clocks.presenceDt);
      headState = headStep.state;
      const motion = motionAt(settings);
      const frameInput: GardenFrame = {
        event: first ? { kind: 'startAt', stage } : null,
        presenceDt: clocks.presenceDt,
        sessionDt: clocks.sessionDt,
        motion,
        suspension: { paused, holdActive: false },
        pointers,
        helpRequested,
        head: scaledHead(headStep.offset, headScaleOf(motion)),
      };
      first = false;
      const step = stepGarden(env, current, frameInput);
      gameRef.current = step.state;
      // The quiet hint is taken only when no required line is pending, so it never replaces one (Req 15.3, 16.2).
      if (requiredLineOf(step.state) === null) {
        const taken = takeHint(rate);
        rate = taken.state;
        if (taken.shown) hintShownRef.current = true;
      }
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
      // The lit lanterns flicker on the session clock, so Pause freezes the flicker with the session (Req 17.2, 17.3).
      sessionClockRef.current += clocks.sessionDt;
      const lanternRule = step.state.stage?.kind === 'lantern' ? step.state.stage.rule : null;
      if (scene !== null && lanternRule !== null) {
        for (const lit of lanternColoursOf(lanternRule, sessionClockRef.current, frameInput.motion, colourNumber('lanternWarm'))) {
          scene.setTargetColour(lit.id, lit.colour);
        }
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
            if (state === null) return frameDataOf({ session: idleSession, active: [], shown: [], head: REST_HEAD, decorativeHead: REST_HEAD });
            const targets = frameTargets(state);
            return frameDataOf({
              session: state.session,
              active: targets.filter((target) => target.active).map((target) => target.id),
              shown: targets.map((target) => target.id),
              // The targets and their hit areas share the interaction head; the decorative layers follow the live one (steering 8).
              head: state.view.interaction,
              decorativeHead: state.view.live,
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
  const targets = state !== null && env !== null ? drawnTargetsOf(state, env.reach.frame, state.view.interaction) : [];
  const required = state === null || ended ? null : requiredLineOf(state);
  return (
    <main
      className="garden-stage"
      data-phase={state?.session.phase ?? 'NONE'}
      data-stage={state?.session.stage ?? ''}
      data-travel-style={state?.session.travel?.part?.style ?? ''}
      data-travel-ms={state?.session.travel?.part?.elapsedMs ?? 0}
      data-travel-length={state?.session.travel?.part?.remainingMs ?? 0}
      data-timer-ms={sessionClockRef.current}
      data-head-x={state?.view.interaction.x ?? 0}
      data-live-head-x={state?.view.live.x ?? 0}
    >
      <p className="garden-label">{textOf('label.simulated')}</p>
      {title !== null && title.timerMs > 0 ? (
        <h1 className="garden-title" style={{ opacity: titleOpacity(title.timerMs) }}>
          {textOf(title.title === 'lantern' ? 'title.lantern' : 'title.hall')}
        </h1>
      ) : null}
      <InstructionLine
        required={required === null ? null : textOf(required)}
        quiet={hintShownRef.current ? textOf('hint.light') : null}
      />
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
