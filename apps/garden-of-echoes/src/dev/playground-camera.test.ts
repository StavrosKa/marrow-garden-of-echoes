// @vitest-environment jsdom
// The playground's camera mode (Req 5, 18.9, 23.6 to 23.10). Every camera here is a fake that records its calls: no
// test opens a camera. The tests run the real controller, so the setup flow, the driver and the tracking lifecycle
// are the ones the page uses. Numbers come from TUNING or from the fixtures below.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TUNING, type Mapping, type PoseFrame, type Vec2 } from 'marrow/core';
import type { CameraSourceOptions, PoseSource, StartOutcome } from 'marrow/input';
import { createSettingsStore, type HandChoice } from 'marrow/react';
import type { ToneContext } from '../audio/tonePlayer';
import { createPlaygroundController, dimsPlayArea, type PlaygroundController } from './playgroundController';
import { PLAY_ASPECT } from './playAreaPlan';
import { readPlaygroundContent, type PlaygroundContent } from './playgroundContent';
import shipped from './playground-content.json';

const BASE_PATH = '/garden/';
const STEP_MS = 100;
/** Enough ticks for the painting cap (calibCapMs) and the calm hold, with room to spare. */
const MAX_CALIBRATION_TICKS = Math.ceil((TUNING.calibCapMs + TUNING.calmHoldMs) / STEP_MS) + 50;
/**
 * Ticks the painted hand stays on one cell before it moves on. The one-euro filter on the wrist
 * (oneEuroMinCutoffHz) takes about a second to settle, so a hand that jumps every tick between
 * cells is smoothed into their middle and paints only the middle cell.
 */
const DWELL_TICKS = 10;
/** Added to hitRadius, in screen units, so that the painted disc includes the cells it only grazes. */
const PAINT_MARGIN = 0.01;
/** The spacing of the screen points sampled in the painted disc, in screen units. Finer than a cell's edge. */
const PAINT_STEP = 0.001;

/** A camera that records its calls and whose start outcome the test decides. */
class FakeCamera implements PoseSource {
  frame: PoseFrame | null = null;
  starts = 0;
  disposed = 0;
  private finish: ((outcome: StartOutcome) => void) | null = null;
  constructor(readonly options: CameraSourceOptions) {}
  start(): Promise<StartOutcome> {
    this.starts += 1;
    // The real source asks for the camera first thing in start (Req 5.1). The fake does the same, through the option.
    void this.options.getUserMedia?.({ video: true, audio: false });
    return new Promise((resolve) => {
      this.finish = resolve;
    });
  }
  /** Ends the start with an outcome, as the source would when it is ready or has failed. */
  finishStart(outcome: StartOutcome): void {
    this.finish?.(outcome);
  }
  latest(): PoseFrame | null {
    return this.frame;
  }
  dispose(): void {
    this.disposed += 1;
  }
}

/** A frame callback queue that the test runs by hand. */
function frameQueue() {
  let next = 1;
  const pending = new Map<number, (timestampMs: number) => void>();
  return {
    pending,
    request(callback: (timestampMs: number) => void): number {
      const handle = next;
      next += 1;
      pending.set(handle, callback);
      return handle;
    },
    cancel(handle: number): void {
      pending.delete(handle);
    },
    run(timestampMs: number): void {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(timestampMs);
    },
  };
}

function toneStub(): ToneContext {
  const param = {
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    cancelScheduledValues: () => undefined,
  };
  return {
    currentTime: 0,
    destination: 'out',
    createGain: () => ({ gain: param, connect: () => undefined }),
    createOscillator: () => ({
      type: '',
      frequency: param,
      connect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    }),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

function readContent(): PlaygroundContent {
  const result = readPlaygroundContent(shipped);
  if (!result.ok) throw new Error(result.message);
  return result.content;
}

/** A frame with the wrists at the given camera positions (null: invalid). The nose and the shoulders are valid. */
function poseFrame(now: number, right: Vec2 | null, left: Vec2 | null = null): PoseFrame {
  const at = { x: 0.5, y: 0.5 };
  return {
    t: now,
    aspect: PLAY_ASPECT,
    landmarks: {
      leftWrist: left === null ? { pos: at, valid: false } : { pos: left, valid: true },
      rightWrist: right === null ? { pos: at, valid: false } : { pos: right, valid: true },
      nose: { pos: { x: 0.5, y: 0.3 }, valid: true },
      leftShoulder: { pos: { x: 0.65, y: 0.5 }, valid: true },
      rightShoulder: { pos: { x: 0.35, y: 0.5 }, valid: true },
    },
  };
}

interface Harness {
  readonly controller: PlaygroundController;
  readonly cameras: FakeCamera[];
  readonly getUserMediaCalls: MediaStreamConstraints[];
  readonly raf: ReturnType<typeof frameQueue>;
  /** Runs `ms` of frames; each frame gives the newest camera a new frame with the given wrist positions. */
  run(ms: number, right: Vec2 | null, left?: Vec2 | null): void;
  readonly cleanup: () => void;
}

function harness(): Harness {
  const raf = frameQueue();
  const cameras: FakeCamera[] = [];
  const getUserMediaCalls: MediaStreamConstraints[] = [];
  const controller = createPlaygroundController({
    content: readContent(),
    settings: createSettingsStore({ prefix: 'test.camera.', prefersReducedMotion: false, storage: null }),
    basePath: BASE_PATH,
    createPointerSource: () => {
      throw new Error('the pointer source is not used in camera mode');
    },
    createCameraSource: (options) => {
      const camera = new FakeCamera(options);
      cameras.push(camera);
      return camera;
    },
    getUserMedia: (constraints) => {
      getUserMediaCalls.push(constraints);
      return Promise.resolve({} as MediaStream);
    },
    requestFrame: (callback) => raf.request(callback),
    cancelFrame: (handle) => raf.cancel(handle),
    debug: false,
    createToneContext: () => toneStub(),
  });
  const cleanup = controller.mount();
  const clock = { now: 0 };
  return {
    controller,
    cameras,
    getUserMediaCalls,
    raf,
    run(ms, right, left = null) {
      for (let elapsed = 0; elapsed < ms; elapsed += STEP_MS) {
        clock.now += STEP_MS;
        const camera = cameras.at(-1);
        if (camera !== undefined) camera.frame = poseFrame(clock.now, right, left);
        raf.run(clock.now);
      }
    },
    cleanup,
  };
}

/** Lets the promise callbacks of the camera run (outcome and stream) happen. */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * The camera-space centres of the cells that the disc of radius hitRadius + PAINT_MARGIN around a
 * screen point touches. Screen points of the disc are sampled on a fine grid and mapped to camera
 * space, and each cell that a sample falls in is painted. The margin makes the disc slightly larger
 * than the slot's own, so that the sampling does not miss a cell at its corner.
 */
function cellsTouchedBy(mapping: Mapping, screenPoint: Vec2): Vec2[] {
  const reach = TUNING.hitRadius + PAINT_MARGIN;
  const cells = new Map<string, Vec2>();
  const steps = Math.ceil(reach / PAINT_STEP);
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      const dx = i * PAINT_STEP;
      const dy = j * PAINT_STEP;
      if (dx * dx + dy * dy > reach * reach) continue;
      const camera = mapping.toCamera({ x: screenPoint.x + dx, y: screenPoint.y + dy });
      if (camera.x < 0 || camera.x > 1 || camera.y < 0 || camera.y > 1) continue;
      const col = Math.min(Math.floor(camera.x * TUNING.gridCols), TUNING.gridCols - 1);
      const row = Math.min(Math.floor(camera.y * TUNING.gridRows), TUNING.gridRows - 1);
      const key = `${col},${row}`;
      if (!cells.has(key)) cells.set(key, { x: (col + 0.5) / TUNING.gridCols, y: (row + 0.5) / TUNING.gridRows });
    }
  }
  return [...cells.values()];
}

/**
 * Starts the camera, lets it become ready, chooses the hands, and paints the cells the first slot's disc touches until
 * calibration ends. The first slot's cells cover one usable slot, so Placement gives a sequential round, and the
 * page reaches play (Req 26.4).
 */
async function reachPlay(h: Harness, hand: HandChoice): Promise<void> {
  h.controller.pressStart();
  h.controller.send({ kind: 'useCamera' });
  const camera = h.cameras.at(-1);
  if (camera === undefined) throw new Error('no camera was started');
  camera.frame = poseFrame(0, null);
  camera.finishStart('ready');
  await flush();
  if (h.controller.getView().setup.screen !== 'handChoice') throw new Error('the camera did not open hand choice');
  h.controller.send({ kind: 'handChosen', hand });
  // Only the right wrist paints. With the hand "both" the left wrist is out of view, which is the one-wrist case.
  // The first tick after the choice starts the run, because the run waits for the first frame.
  h.run(STEP_MS, null);
  const mapping = h.controller.getView().mapping;
  const slot = readContent().slots[0];
  if (mapping === null || slot === undefined) throw new Error('no mapping or slot');
  const cells = cellsTouchedBy(mapping, slot);
  if (cells.length === 0) throw new Error('no cell near the slot');
  for (let tick = 0; tick < MAX_CALIBRATION_TICKS; tick++) {
    if (h.controller.getView().setup.screen === 'play') return;
    const cell = cells[Math.floor(tick / DWELL_TICKS) % cells.length];
    h.run(STEP_MS, cell ?? null);
  }
  throw new Error(`calibration did not reach play (screen ${h.controller.getView().setup.screen})`);
}

describe('the camera is requested only from a click, with every URL under the base path', () => {
  it('Use the camera starts one camera source, with the base path, and asks for the camera inside that click', async () => {
    const h = harness();
    h.controller.pressStart();
    expect(h.cameras).toHaveLength(0);
    h.controller.send({ kind: 'useCamera' });
    // Both checks run right after `send` returns: the camera was requested in that call, not later.
    expect(h.cameras).toHaveLength(1);
    expect(h.cameras[0]?.options.basePath).toBe(BASE_PATH);
    expect(h.cameras[0]?.starts).toBe(1);
    expect(h.getUserMediaCalls).toHaveLength(1);
    expect(h.getUserMediaCalls[0]?.video).toBeTruthy();
    h.cleanup();
  });

  it('a ready camera opens hand choice with the preview stream; a denied one shows its screen; Retry starts again', async () => {
    const h = harness();
    h.controller.pressStart();
    h.controller.send({ kind: 'useCamera' });
    const first = h.cameras[0];
    if (first === undefined) throw new Error('no camera');
    first.frame = poseFrame(0, null);
    first.finishStart('denied');
    await flush();
    expect(h.controller.getView().setup.screen).toBe('cameraError');
    expect(h.controller.getView().setup.failure).toBe('denied');
    h.controller.send({ kind: 'useCamera' });
    expect(h.cameras).toHaveLength(2);
    expect(h.cameras[1]?.starts).toBe(1);
    h.cameras[1]?.finishStart('ready');
    await flush();
    expect(h.controller.getView().setup.screen).toBe('handChoice');
    expect(h.controller.getView().previewStream).not.toBeNull();
    h.cleanup();
  });
});

describe('the camera is disposed on Exit, on switching to simulated input, on unmount and on pagehide', () => {
  it('disposes the camera on Exit', async () => {
    const h = harness();
    await reachPlay(h, 'right');
    h.controller.send({ kind: 'pauseControl' });
    h.controller.send({ kind: 'exit' });
    expect(h.cameras[0]?.disposed).toBe(1);
    expect(h.controller.getView().previewStream).toBeNull();
    h.cleanup();
  });

  it('disposes the camera when the page switches to simulated input', () => {
    const h = harness();
    h.controller.pressStart();
    h.controller.send({ kind: 'useCamera' });
    h.controller.send({ kind: 'tryWithout' });
    expect(h.cameras[0]?.disposed).toBe(1);
    expect(h.controller.getView().setup.mode).toBe('simulated');
    h.cleanup();
  });

  it('disposes the camera on unmount', () => {
    const h = harness();
    h.controller.pressStart();
    h.controller.send({ kind: 'useCamera' });
    h.cleanup();
    expect(h.cameras[0]?.disposed).toBe(1);
  });

  it('disposes the camera on pagehide', () => {
    const h = harness();
    h.controller.pressStart();
    h.controller.send({ kind: 'useCamera' });
    window.dispatchEvent(new Event('pagehide'));
    expect(h.cameras[0]?.disposed).toBe(1);
    h.cleanup();
  });

  it('does not dispose the camera on a tab switch: visibilitychange only sets the hidden flag', () => {
    const h = harness();
    h.controller.pressStart();
    h.controller.send({ kind: 'useCamera' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h.cameras[0]?.disposed).toBe(0);
    h.cleanup();
  });
});

describe('the play area dims only where the tracking-lost overlay can show (Req 23.10)', () => {
  it('dims on the play screen during a hold, and on no other screen', () => {
    expect(dimsPlayArea('play', true)).toBe(true);
    expect(dimsPlayArea('play', false)).toBe(false);
    for (const screen of ['calibrating', 'noUsableSlot', 'handChoice', 'cameraPermission', 'cameraError', 'start'] as const) {
      expect(dimsPlayArea(screen, true)).toBe(false);
    }
  });

  it('reports the dim in the view while a hold runs on the play screen', async () => {
    const h = harness();
    await reachPlay(h, 'right');
    expect(h.controller.getView().dimmed).toBe(false);
    // The hand leaves the frame for longer than the hold threshold, which begins a hold on the play screen.
    h.run(TUNING.trackingHoldAfterMs + STEP_MS * 2, null);
    expect(h.controller.getView().dimmed).toBe(true);
    h.cleanup();
  });
});

describe('Recover, the tracking-lost overlay and the hold', () => {
  it('Recover disposes the camera and starts another from its click, keeps the calibration, and the overlay stays until the hold ends', async () => {
    const h = harness();
    await reachPlay(h, 'right');
    const calibrationBefore = h.controller.getView().calibration;
    // The hand leaves the frame: the hold begins, and after the overlay threshold the overlay shows.
    h.run(TUNING.trackingOverlayAfterMs + TUNING.trackingHoldAfterMs + STEP_MS * 3, null);
    expect(h.controller.getView().setup.trackingLost).toBe(true);

    h.controller.send({ kind: 'recover' });
    expect(h.cameras).toHaveLength(2);
    expect(h.cameras[0]?.disposed).toBe(1);
    expect(h.cameras[1]?.starts).toBe(1);
    expect(h.controller.getView().calibration).toBe(calibrationBefore);
    // The overlay is still up while the restart runs.
    expect(h.controller.getView().setup.trackingLost).toBe(true);

    h.cameras[1]?.finishStart('ready');
    await flush();
    expect(h.controller.getView().setup.screen).toBe('play');
    expect(h.controller.getView().setup.trackingLost).toBe(true);

    // The hand returns: valid time reaches the resume time, the hold ends, and the overlay goes.
    h.run(TUNING.trackingResumeMs + STEP_MS, { x: 0.5, y: 0.5 });
    expect(h.controller.getView().setup.trackingLost).toBe(false);
    h.cleanup();
  });

  it('a Recover whose restart fails shows that outcome instead of play', async () => {
    const h = harness();
    await reachPlay(h, 'right');
    h.run(TUNING.trackingOverlayAfterMs + TUNING.trackingHoldAfterMs + STEP_MS * 3, null);
    h.controller.send({ kind: 'recover' });
    h.cameras[1]?.finishStart('no-camera');
    await flush();
    expect(h.controller.getView().setup.screen).toBe('cameraError');
    expect(h.controller.getView().setup.failure).toBe('no-camera');
    h.cleanup();
  });

  it('the one-wrist hint shows when one hand is out of view for more than oneWristHintMs while the other is in view', async () => {
    const h = harness();
    await reachPlay(h, 'both');
    h.run(TUNING.oneWristHintMs + STEP_MS * 2, { x: 0.5, y: 0.5 }, null);
    expect(h.controller.getView().oneWristHint).toBe(true);
    h.cleanup();
  });

  it('the play area dims during a hold, with a fade of at least uiMinLightEaseMs (Req 23.10)', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(path.join(here, 'playground.css'), 'utf8');
    const held = css.match(/\.playground-field--held \.playground-area\s*\{[^}]*\}/);
    expect(held).not.toBeNull();
    const fade = css.match(/\.playground-area\s*\{[^}]*transition:\s*opacity\s+(\d+)ms/);
    expect(fade).not.toBeNull();
    expect(Number(fade?.[1])).toBeGreaterThanOrEqual(TUNING.uiMinLightEaseMs);
  });
});
