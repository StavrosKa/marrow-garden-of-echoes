// The stage screen of the ?start shortcut (garden-level design 2.7, 3; requirements 4, 18, 20, 22). Simulated input over
// the whole frame, and no camera. The frame loop does three things: marrow's clocks give the time, marrow's Pointer
// Source gives the pointer, and stepGarden does the rest. The Scene Manager (Pixi, loaded when the screen starts) draws
// the forest and the lanterns, and the DOM draws the one instruction line, the label and the entry title. Each lantern
// also has a transparent DOM marker at its position, so a test can aim at it.
import { useEffect, useReducer, useRef, type ReactElement } from 'react';
import type { CSSProperties } from 'react';
import { makeMapping, stepClocks, TUNING as MARROW_TUNING, type MotionLevel, type PointerInput } from 'marrow/core';
import { createPointerSource, type PoseSource } from 'marrow/input';
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
import { COVER_TOKEN, forestSceneLayers, frameDataOf, sceneKeyOf, sceneTargetsOf, TARGET_VISUAL_RATIO } from '../scene/sceneSetup';
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
import type { StageId } from '../session/stageOrder';
import { SIMULATED_WRISTS, wholeFrameReach } from '../session/wholeFrame';
import { browserFrames } from './frames';
import { textOf } from './copyLookup';

/** The play area is 16:9, as the playground's is. The scene's aspect and the pointer's aspect are both this. */
const ASPECT = 16 / 9;
/** The space above the play area (the label, the heading and the instruction line), in rem. The box fits the window below it. */
const HEADER_REM = 12;
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

export function GardenStage(props: { readonly stage: StageId }): ReactElement {
  const { stage } = props;
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
    const source = createPointerSource({ playArea: area, requestFrame: browserFrames.request, cancelFrame: browserFrames.cancel });
    void source.start();
    const motion = motionNow();
    let last: number | null = null;
    let first = true;
    let handle = 0;
    let alive = true;
    let sceneKey = '';

    const frameTargets = (state: GardenState) => drawnTargetsOf(state, env.reach.frame);
    const tick = (now: number): void => {
      if (!alive) return;
      const current = gameRef.current;
      if (current === null) return;
      const rawDt = last === null ? 0 : now - last;
      last = now;
      const clocks = stepClocks(rawDt, { paused: false, hidden: document.hidden, holdActive: false }, MARROW_TUNING);
      const frameInput: GardenFrame = {
        event: first ? { kind: 'startAt', stage } : null,
        presenceDt: clocks.presenceDt,
        sessionDt: clocks.sessionDt,
        motion,
        suspension: { paused: false, holdActive: false },
        pointers: pointerOf(source),
      };
      first = false;
      const step = stepGarden(env, current, frameInput);
      gameRef.current = step.state;
      for (const effect of step.effects) {
        if (effect.kind === 'lanternLit') audio.playNote(effect.index);
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

    void import('world-view/pixi').then(async (pixi) => {
      if (!alive) return;
      const scene = pixi.createSceneManager({
        host: area,
        layers: forestSceneLayers(),
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
      sceneRef.current = scene;
    });
    handle = browserFrames.request(tick);
    return () => {
      alive = false;
      browserFrames.cancel(handle);
      source.dispose();
      audio.dispose();
      sceneRef.current?.dispose();
      sceneRef.current = null;
      audioRef.current = null;
    };
  }, [stage]);

  const state = gameRef.current;
  const env = envRef.current;
  const targets = state !== null && env !== null ? drawnTargetsOf(state, env.reach.frame) : [];
  const line = state === null ? null : instructionKeyOf(state);
  return (
    <main className="garden-stage">
      <p className="garden-label">{textOf('label.simulated')}</p>
      {state !== null && state.session.phase === 'ENTERING' ? (
        <h1 className="garden-title" style={{ opacity: titleOpacity(state.session.timerMs) }}>
          {textOf('title.lantern')}
        </h1>
      ) : null}
      {line !== null ? <p aria-live="polite">{textOf(line)}</p> : null}
      <div
        ref={playRef}
        className="garden-play"
        // A true 16:9 box, centred, at most the window's height below the header. overflow hidden stops the canvas
        // (which the Scene Manager sizes from this box) from making the box taller than 16:9.
        style={{
          position: 'relative',
          width: `min(100%, calc((100dvh - ${HEADER_REM}rem) * ${ASPECT}))`,
          aspectRatio: `${ASPECT}`,
          margin: '0 auto',
          overflow: 'hidden',
          touchAction: 'none',
        }}
        onPointerDown={() => audioRef.current?.start({ kind: 'pointerdown' })}
      >
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
      </div>
    </main>
  );
}
