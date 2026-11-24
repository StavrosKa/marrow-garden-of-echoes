// The stage screen of the ?start shortcut (garden-level design 2.7, 3; requirements 4, 18, 20). Simulated input over
// the whole frame, and no camera. The frame loop does three things: marrow's clocks give the time, marrow's Pointer
// Source gives the pointer, and stepGarden does the rest. The lanterns are drawn as DOM circles here. The Pixi scene
// (task 6.8) draws the same circles from the same drawnTargetsOf.
import { useEffect, useReducer, useRef, type ReactElement } from 'react';
import { makeMapping, stepClocks, TUNING as MARROW_TUNING, type MotionLevel, type PointerInput } from 'marrow/core';
import { createPointerSource, type PoseSource } from 'marrow/input';
import { TUNING as WORLD_TUNING } from 'world-view';
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
import {
  createGarden,
  drawnTargetsOf,
  instructionKeyOf,
  stepGarden,
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
const CENTRE_Y = 0.5;
const NOT_VALID_POINTER = { wrist: 'right', valid: false } as const;
const REDUCED_QUERY = '(prefers-reduced-motion:reduce)';

function motionNow(): MotionLevel {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_QUERY).matches ? 'reduced' : 'full';
}

/**
 * The opacity of the entry title over its time (Req 9.4, art-and-motion.md). It fades in and out over the world-view
 * fade length, and it is held in between. The timer is the session's time left in ENTERING.
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
      placeholders: {
        'whisper-glade': loadWhisperGlade(whisperGladeJson),
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
  const audioRef = useRef<GardenAudio | null>(null);
  const envRef = useRef<GardenEnv | null>(null);
  const [, redraw] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const area = playRef.current;
    if (area === null) return undefined;
    const env = environment();
    envRef.current = env;
    gameRef.current = createGarden(loadSegments(segmentsJson));
    const audio = createGardenAudio(createTonePlayer(() => new AudioContext()));
    audioRef.current = audio;
    const source = createPointerSource({ playArea: area, requestFrame: browserFrames.request, cancelFrame: browserFrames.cancel });
    void source.start();
    const motion = motionNow();
    let last: number | null = null;
    let first = true;
    let handle = 0;
    let alive = true;
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
      redraw();
      handle = browserFrames.request(tick);
    };
    handle = browserFrames.request(tick);
    return () => {
      alive = false;
      browserFrames.cancel(handle);
      source.dispose();
      audio.dispose();
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
        style={{ position: 'relative', width: '100%', aspectRatio: `${ASPECT}`, touchAction: 'none' }}
        onPointerDown={() => audioRef.current?.start({ kind: 'pointerdown' })}
      >
        {targets.map((target) =>
          target.centre === null ? null : (
            <div
              key={target.id}
              data-target={target.id}
              data-lit={target.lit ? 'yes' : 'no'}
              data-active={target.active ? 'yes' : 'no'}
              style={{
                position: 'absolute',
                left: `${(target.centre.x / ASPECT) * 100}%`,
                top: `${target.centre.y * 100}%`,
                width: `${(target.radius * 2 * 100) / ASPECT}%`,
                height: `${target.radius * 2 * 100}%`,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                border: '2px solid currentColor',
                opacity: target.active || target.lit ? 1 : 0.4,
              }}
            />
          ),
        )}
      </div>
    </main>
  );
}
