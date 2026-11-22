// @vitest-environment jsdom
// The Debug Overlay of the playground (Req 25.1, 25.5; task 17.9). The pure parts are checked directly. The overlay is
// rendered only with debug=1. The refresh is throttled to DEBUG_REFRESH_MS of frame time, except at a change a player
// sees. Nothing here opens a camera: the simulated-input path and fake parts only.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TUNING, type PoseFrame } from 'marrow/core';
import type { PoseSource } from 'marrow/input';
import { createSettingsStore } from 'marrow/react';
import { readPlaygroundContent } from './playgroundContent';
import { createPlaygroundController } from './playgroundController';
import { DEBUG_REFRESH_MS, isDebugRequested, keepDebugWindow, refreshDue } from './playgroundDebug';
import { Playground, type PlaygroundParts } from './playground';
import shipped from './playground-content.json';

const TICK_MS = 16;

function readContent() {
  const result = readPlaygroundContent(shipped);
  if (!result.ok) throw new Error(result.message);
  return result.content;
}

/** A frame queue that the test runs by hand. */
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

/** A pointer source whose frame the test sets. Without a frame it gives none, as the overlay tests need. */
class FakePointer implements PoseSource {
  frame: PoseFrame | null = null;
  start(): Promise<'ready'> {
    return Promise.resolve('ready');
  }
  latest(): PoseFrame | null {
    return this.frame;
  }
  dispose(): void {
    return undefined;
  }
}

function silentPointer(): FakePointer {
  return new FakePointer();
}

function toneStub() {
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
    createOscillator: () => ({ type: '', frequency: param, connect: () => undefined, start: () => undefined, stop: () => undefined }),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

function controllerWith(debug: boolean, extra: { now?: () => number; pointer?: FakePointer } = {}) {
  const raf = frameQueue();
  const controller = createPlaygroundController({
    content: readContent(),
    settings: createSettingsStore({ prefix: 'test.debug.', prefersReducedMotion: false, storage: null }),
    basePath: '/',
    now: extra.now,
    createPointerSource: () => extra.pointer ?? silentPointer(),
    createCameraSource: () => {
      throw new Error('this file never requests a camera');
    },
    getUserMedia: () => Promise.reject(new Error('this file never requests a camera')),
    requestFrame: (callback) => raf.request(callback),
    cancelFrame: (handle) => raf.cancel(handle),
    debug,
    createToneContext: () => toneStub(),
  });
  const clock = { now: 0 };
  /** Runs `ms` of frames at TICK_MS each. */
  function run(ms: number): void {
    for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
      clock.now += TICK_MS;
      raf.run(clock.now);
    }
  }
  return { controller, run, raf };
}

describe('the URL and the window (Req 25.1)', () => {
  it('asks for the overlay with debug=1 and with nothing else', () => {
    expect(isDebugRequested('?playground=1&debug=1')).toBe(true);
    expect(isDebugRequested('?debug=1')).toBe(true);
    expect(isDebugRequested('?debug=0')).toBe(false);
    expect(isDebugRequested('?debug=true')).toBe(false);
    expect(isDebugRequested('?playground=1')).toBe(false);
    expect(isDebugRequested('')).toBe(false);
  });

  it('keeps the times in the debug window, half-open like the rate count', () => {
    const now = 10 * TUNING.debugRateWindowMs;
    const kept = keepDebugWindow([now - TUNING.debugRateWindowMs, now - TUNING.debugRateWindowMs + 1, now], now);
    expect(kept).toEqual([now - TUNING.debugRateWindowMs + 1, now]);
  });

  it('refreshes for a change a player sees at once, and otherwise after DEBUG_REFRESH_MS of frame time', () => {
    expect(refreshDue({ changed: true, nowMs: 5, lastMs: 4 })).toBe(true);
    expect(refreshDue({ changed: false, nowMs: 4 + DEBUG_REFRESH_MS - 1, lastMs: 4 })).toBe(false);
    expect(refreshDue({ changed: false, nowMs: 4 + DEBUG_REFRESH_MS, lastMs: 4 })).toBe(true);
  });
});

describe('the overlay is rendered only with debug=1', () => {
  it('is rendered on the start screen with debug=1 in the URL, and not without it', () => {
    const parts: Partial<PlaygroundParts> = {
      createPointerSource: () => silentPointer(),
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      createToneContext: () => toneStub(),
      settingsStorage: null,
    };
    const on = render(<Playground parts={parts} debug={true} />);
    expect(on.container.querySelector('.marrow-debug')).not.toBeNull();
    on.unmount();
    const off = render(<Playground parts={parts} debug={false} />);
    expect(off.container.querySelector('.marrow-debug')).toBeNull();
    off.unmount();
  });

  it('reads debug=1 from the page URL when no flag is passed', () => {
    const parts: Partial<PlaygroundParts> = {
      createPointerSource: () => silentPointer(),
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      createToneContext: () => toneStub(),
      settingsStorage: null,
    };
    window.history.replaceState({}, '', '/?playground=1&debug=1');
    const withUrl = render(<Playground parts={parts} />);
    expect(withUrl.container.querySelector('.marrow-debug')).not.toBeNull();
    withUrl.unmount();
    window.history.replaceState({}, '', '/?playground=1');
    const withoutUrl = render(<Playground parts={parts} />);
    expect(withoutUrl.container.querySelector('.marrow-debug')).toBeNull();
    withoutUrl.unmount();
  });
});

describe('the refresh is throttled to DEBUG_REFRESH_MS of frame time', () => {
  it('notifies the overlay at most every DEBUG_REFRESH_MS while nothing changes', () => {
    const { controller, run } = controllerWith(true);
    const cleanup = controller.mount();
    const times: number[] = [];
    const unsubscribe = controller.subscribeDebug(() => {
      const snapshot = controller.getDebugSnapshot();
      if (snapshot !== null) times.push(snapshot.nowMs);
    });
    run(TUNING.debugRateWindowMs);
    // Each tick is TICK_MS, so the refreshes are the ticks that pass the throttle: one per DEBUG_REFRESH_MS, give or take.
    expect(times.length).toBeGreaterThan(0);
    for (let i = 1; i < times.length; i++) {
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(DEBUG_REFRESH_MS);
    }
    expect(times.length).toBeLessThanOrEqual(TUNING.debugRateWindowMs / DEBUG_REFRESH_MS + 2);
    unsubscribe();
    cleanup();
  });

  it('refreshes at once when the screen changes, without waiting for the throttle', () => {
    const { controller, run } = controllerWith(true);
    const cleanup = controller.mount();
    let notifications = 0;
    controller.subscribeDebug(() => {
      notifications += 1;
    });
    run(TICK_MS);
    const before = notifications;
    controller.pressStart();
    expect(notifications).toBe(before + 1);
    cleanup();
  });

  it('builds no snapshot when the debug flag is off', () => {
    const { controller, run } = controllerWith(false);
    const cleanup = controller.mount();
    run(TUNING.debugRateWindowMs);
    expect(controller.debugEnabled).toBe(false);
    expect(controller.getDebugSnapshot()).toBeNull();
    cleanup();
  });
});

describe('the draw time is read after the frame is drawn (Req 2.7)', () => {
  it('gives a latency of at least 0 when a frame arrives between the frame start and the draw', () => {
    const FRAME_START_MS = 100;
    const FRAME_T_MS = 105;
    const DRAWN_AT_MS = 110;
    const pointer = new FakePointer();
    const { controller, raf } = controllerWith(true, { now: () => DRAWN_AT_MS, pointer });
    const cleanup = controller.mount();
    controller.attachPlayArea(document.createElement('div'));
    controller.pressStart();
    controller.send({ kind: 'tryWithout' });
    // The frame's timestamp is after the animation frame's start and before the draw (the race of the camera).
    pointer.frame = {
      t: FRAME_T_MS,
      aspect: 1.6,
      landmarks: {
        leftWrist: { pos: { x: 0.5, y: 0.5 }, valid: false },
        rightWrist: { pos: { x: 0.5, y: 0.5 }, valid: true },
        nose: { pos: { x: 0.5, y: 0.3 }, valid: true },
        leftShoulder: { pos: { x: 0.65, y: 0.5 }, valid: true },
        rightShoulder: { pos: { x: 0.35, y: 0.5 }, valid: true },
      },
    };
    raf.run(FRAME_START_MS);
    const snapshot = controller.getDebugSnapshot();
    if (snapshot === null || snapshot.frame === null) throw new Error('no snapshot with a frame');
    expect(snapshot.frameDrawnAtMs).toBe(DRAWN_AT_MS);
    const latency = (snapshot.frameDrawnAtMs ?? NaN) - snapshot.frame.t;
    // The old draw time, the frame start, would give -5 here: a negative latency.
    expect(latency).toBeGreaterThanOrEqual(0);
    expect(latency).toBe(DRAWN_AT_MS - FRAME_T_MS);
    cleanup();
  });
});

describe('the overlay does not cover the title, the Pause control or the controls', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(path.join(here, 'playground.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('draws the overlay inside the field, so its drawing lines up with the play area', () => {
    expect(css).toMatch(/\.playground-field > \.marrow-debug\s*\{[^}]*position:\s*absolute/);
  });

  it('puts the figures in the bottom-right corner of the window', () => {
    expect(css).toMatch(/\.playground-root \.marrow-debug-text\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/\.playground-root \.marrow-debug-text\s*\{[^}]*right:\s*0\.5rem/);
    expect(css).toMatch(/\.playground-root \.marrow-debug-text\s*\{[^}]*bottom:\s*0\.5rem/);
  });
});

describe('the snapshot is the one the playground draws in the same frame', () => {
  it('shows the open targets of a live round and the frame times of the last window', () => {
    const { controller, run } = controllerWith(true);
    const cleanup = controller.mount();
    controller.attachPlayArea(document.createElement('div'));
    controller.pressStart();
    controller.send({ kind: 'tryWithout' });
    controller.send({ kind: 'wholeScreen' });
    expect(controller.getView().setup.screen).toBe('play');
    run(TUNING.debugRateWindowMs);
    const shown = controller.getView().shown.map((target) => target.id);
    const snapshot = controller.getDebugSnapshot();
    if (snapshot === null) throw new Error('no snapshot');
    expect(snapshot.hitAreas.map((area) => area.targetId)).toEqual(shown);
    expect(snapshot.mode).toBe('simulated');
    // Every tick is a render. The copy the overlay shows was refreshed at most DEBUG_REFRESH_MS before the end of the
    // run, so its window holds the ticks of the window less that interval, give or take one tick.
    expect(snapshot.renderTimesMs.length).toBeGreaterThanOrEqual(
      Math.floor((TUNING.debugRateWindowMs - DEBUG_REFRESH_MS) / TICK_MS) - 2,
    );
    expect(snapshot.renderTimesMs.every((time) => time > snapshot.nowMs - TUNING.debugRateWindowMs)).toBe(true);
    cleanup();
  });
});
