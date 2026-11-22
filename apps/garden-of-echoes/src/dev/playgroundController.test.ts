// @vitest-environment jsdom
// The controller of the playground on the simulated-input path (Req 6.10, 22, 23, 26, 27). The browser parts are
// fakes: a Pointer Source whose frame the test sets, a frame callback the test runs by hand, and a tone context that
// records the frequency of each oscillator. Numbers come from TUNING, from the app constants, or from the fixtures.
import { describe, expect, it } from 'vitest';
import { TUNING, type PoseFrame, type Vec2 } from 'marrow/core';
import { createSettingsStore } from 'marrow/react';
import type { PoseSource } from 'marrow/input';
import { TONES_HZ, type ToneContext } from '../audio/tonePlayer';
import { createPlaygroundController, type PlaygroundController } from './playgroundController';
import { PLAY_ASPECT } from './playAreaPlan';
import { readPlaygroundContent } from './playgroundContent';
import { ROUND_PAUSE_MS } from './playgroundRounds';
import shipped from './playground-content.json';

const STEP_MS = 50;
/** A safety bound on the frames a target may take to be selected: dwell needs the dwell time, so this is generous. */
const SELECT_STEP_LIMIT = Math.ceil((2 * TUNING.dwellMs) / STEP_MS) + 10;

class FakeSource implements PoseSource {
  frame: PoseFrame | null = null;
  started = 0;
  disposed = 0;
  start(): Promise<'ready'> {
    this.started += 1;
    return Promise.resolve('ready');
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

/** A tone context that records the frequency of every oscillator it makes, in the order they are set. */
class FakeTone implements ToneContext {
  readonly currentTime = 0;
  readonly destination = 'out';
  readonly frequencies: number[] = [];
  closed = 0;
  createGain() {
    const param = {
      value: 0,
      setValueAtTime: () => undefined,
      linearRampToValueAtTime: () => undefined,
      cancelScheduledValues: () => undefined,
    };
    return { gain: param, connect: () => undefined };
  }
  createOscillator() {
    const frequencies = this.frequencies;
    const frequency = {
      stored: 0,
      get value(): number {
        return this.stored;
      },
      set value(next: number) {
        this.stored = next;
        frequencies.push(next);
      },
      setValueAtTime: () => undefined,
      linearRampToValueAtTime: () => undefined,
      cancelScheduledValues: () => undefined,
    };
    return { type: '', frequency, connect: () => undefined, start: () => undefined, stop: () => undefined };
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }
}

function readContent() {
  const result = readPlaygroundContent(shipped);
  if (!result.ok) throw new Error(result.message);
  return result.content;
}

/** A frame with the right wrist at `pos`, or invalid for null. The nose and shoulders are always valid. */
function frameAt(now: number, pos: Vec2 | null): PoseFrame {
  const at = { x: 0.5, y: 0.5 };
  return {
    t: now,
    aspect: PLAY_ASPECT,
    landmarks: {
      leftWrist: { pos: at, valid: false },
      rightWrist: pos === null ? { pos: at, valid: false } : { pos, valid: true },
      nose: { pos: { x: 0.5, y: 0.3 }, valid: true },
      leftShoulder: { pos: { x: 0.65, y: 0.5 }, valid: true },
      rightShoulder: { pos: { x: 0.35, y: 0.5 }, valid: true },
    },
  };
}

function build() {
  const raf = frameQueue();
  const sources: FakeSource[] = [];
  const tones: FakeTone[] = [];
  const settings = createSettingsStore({ prefix: 'test.', prefersReducedMotion: false, storage: null });
  const controller = createPlaygroundController({
    content: readContent(),
    settings,
    basePath: '/',
    createCameraSource: () => {
      throw new Error('the simulated-input tests never request a camera');
    },
    getUserMedia: () => Promise.reject(new Error('the simulated-input tests never request a camera')),
    createPointerSource: () => {
      const source = new FakeSource();
      sources.push(source);
      return source;
    },
    requestFrame: (callback) => raf.request(callback),
    cancelFrame: (handle) => raf.cancel(handle),
    createToneContext: () => {
      const tone = new FakeTone();
      tones.push(tone);
      return tone;
    },
  });
  const clock = { now: 0 };
  /** Runs `ms` of frames. Each frame gets a new PoseFrame object, as the Pointer Source makes one per animation frame. */
  function run(ms: number, pos: Vec2 | null): void {
    for (let elapsed = 0; elapsed < ms; elapsed += STEP_MS) {
      clock.now += STEP_MS;
      const source = sources.at(-1);
      if (source !== undefined) source.frame = frameAt(clock.now, pos);
      raf.run(clock.now);
    }
  }
  return { controller, raf, sources, tones, run };
}

type Harness = ReturnType<typeof build>;

/** The camera-space position of a screen point under the base mapping of the run. */
function cameraOf(controller: PlaygroundController, screen: Vec2): Vec2 {
  const mapping = controller.getView().mapping;
  if (mapping === null) throw new Error('no mapping yet');
  return mapping.toCamera(screen);
}

/** Holds the pointer over one open target until the target is selected. */
function selectTarget(harness: Harness, targetId: string): void {
  const { controller, run } = harness;
  const target = controller.getView().shown.find((t) => t.id === targetId);
  if (target === undefined) throw new Error(`target ${targetId} is not shown`);
  const cam = cameraOf(controller, target.slot);
  for (let step = 0; step < SELECT_STEP_LIMIT; step++) {
    run(STEP_MS, cam);
    if (controller.getView().completedIds.includes(targetId)) return;
  }
  throw new Error(`target ${targetId} was not selected`);
}

describe('the playground controller on the simulated path', () => {
  it('creates the audio only on Start, and one pointer source on Try without camera', () => {
    const { controller, raf, sources, tones } = build();
    const cleanup = controller.mount();
    controller.attachPlayArea(document.createElement('div'));
    expect(tones).toHaveLength(0);
    expect(raf.pending.size).toBe(1);
    controller.pressStart();
    expect(tones).toHaveLength(1);
    expect(controller.getView().setup.screen).toBe('cameraPermission');
    controller.send({ kind: 'tryWithout' });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.started).toBe(1);
    expect(controller.getView().setup.screen).toBe('calibrating');
    expect(controller.getView().setup.mode).toBe('simulated');
    cleanup();
  });

  it('Recalibrate starts a new run, disposing the old source, so one source is live at a time', () => {
    const { controller, sources, run } = build();
    const cleanup = controller.mount();
    controller.attachPlayArea(document.createElement('div'));
    controller.pressStart();
    controller.send({ kind: 'tryWithout' });
    run(STEP_MS, null);
    controller.send({ kind: 'escape' });
    expect(controller.getView().setup.paused).toBe(true);
    controller.send({ kind: 'recalibrate' });
    expect(sources).toHaveLength(2);
    expect(sources[0]?.disposed).toBe(1);
    expect(sources[1]?.disposed).toBe(0);
    expect(controller.getView().setup.screen).toBe('calibrating');
    cleanup();
    expect(sources[1]?.disposed).toBe(1);
  });

  it('stops the loop, the source and the tone context when it unmounts', () => {
    const { controller, raf, sources, tones } = build();
    const cleanup = controller.mount();
    controller.attachPlayArea(document.createElement('div'));
    controller.pressStart();
    controller.send({ kind: 'tryWithout' });
    cleanup();
    expect(raf.pending.size).toBe(0);
    expect(sources.every((source) => source.disposed === 1)).toBe(true);
    expect(tones[0]?.closed).toBe(1);
  });

  it('the whole screen completes calibration and places a round of three targets', () => {
    const { controller } = build();
    const cleanup = controller.mount();
    controller.attachPlayArea(document.createElement('div'));
    controller.pressStart();
    controller.send({ kind: 'tryWithout' });
    controller.send({ kind: 'wholeScreen' });
    const view = controller.getView();
    expect(view.setup.screen).toBe('play');
    expect(view.shown).toHaveLength(readContent().targetCount);
    expect(view.completedIds).toEqual([]);
    cleanup();
  });

  it('a held pointer selects a target and plays its tone; a paused round waits, then a new round starts', () => {
    const harness = build();
    const { controller, tones, run } = harness;
    const cleanup = controller.mount();
    controller.attachPlayArea(document.createElement('div'));
    controller.pressStart();
    controller.send({ kind: 'tryWithout' });
    controller.send({ kind: 'wholeScreen' });
    const firstRound = controller.getView().shown.map((t) => t.id);
    expect(firstRound).toHaveLength(3);

    const first = firstRound[0];
    if (first === undefined) throw new Error('no first target');
    selectTarget(harness, first);
    // The first target of a round is index 0, so its tone is C5 (Req 27.3).
    expect(tones[0]?.frequencies).toEqual([TONES_HZ[0]]);
    expect(controller.getView().completedIds).toEqual([first]);

    for (const id of firstRound.slice(1)) selectTarget(harness, id);
    expect([...controller.getView().completedIds].sort()).toEqual([...firstRound].sort());
    expect(tones[0]?.frequencies).toHaveLength(3);

    // Paused during the wait: the session clock stands still, so the round does not change.
    controller.send({ kind: 'escape' });
    run(ROUND_PAUSE_MS * 2, null);
    expect(controller.getView().completedIds).toHaveLength(3);

    controller.send({ kind: 'escape' });
    run(ROUND_PAUSE_MS, null);
    const second = controller.getView().shown.map((t) => t.id);
    expect(second).toHaveLength(3);
    expect(controller.getView().completedIds).toEqual([]);
    for (const id of second) expect(firstRound).not.toContain(id);
    expect(second.every((id) => id.startsWith('r2-'))).toBe(true);
    cleanup();
  });
});
