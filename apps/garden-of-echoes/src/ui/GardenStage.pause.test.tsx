// @vitest-environment jsdom
// Pause stops the session's time (garden-level requirement 1.4). The stage runs its frame loop by hand: each frame is one
// call of the callback the stage asks for, with the time given. The pointer comes from a fake Pointer Source, so the test
// decides where the hand is. The Pixi scene and the audio are replaced, because they need a browser canvas and sound.
import { act, render } from '@testing-library/react';
import { makeMapping, TUNING } from 'marrow/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GardenStage } from './GardenStage';

const hoisted = vi.hoisted(() => ({
  /** The callback the stage asked for last. Each call of `runFrame` runs it once, with the time given. */
  next: null as ((timestamp: number) => void) | null,
  /** The pose the fake Pointer Source reports, or null. */
  pose: null as null | { readonly landmarks: { readonly rightWrist: { readonly pos: { x: number; y: number }; readonly valid: boolean } } },
}));

vi.mock('./frames', () => ({
  browserFrames: {
    request: (callback: (timestamp: number) => void): number => {
      hoisted.next = callback;
      return 1;
    },
    cancel: (): void => undefined,
  },
}));

vi.mock('marrow/input', () => ({
  createPointerSource: () => ({
    start: async (): Promise<void> => undefined,
    latest: () => hoisted.pose,
    dispose: (): void => undefined,
  }),
}));

vi.mock('../audio/gardenAudio', () => ({
  createGardenAudio: () => ({
    setMuted: (): void => undefined,
    setVolume: (): void => undefined,
    start: (): void => undefined,
    playNote: (): void => undefined,
    dispose: (): void => undefined,
  }),
}));

vi.mock('../audio/tonePlayer', () => ({
  createTonePlayer: () => ({}),
}));

vi.mock('world-view/pixi', () => ({
  createSceneManager: () => ({
    start: async (): Promise<void> => undefined,
    setTargets: (): void => undefined,
    setTargetColour: (): void => undefined,
    dispose: (): void => undefined,
  }),
}));

/** The aspect of the play area, as GardenStage has it (16:9). */
const ASPECT = 16 / 9;
/** The frame step of the test: the largest step the clocks allow, so no frame is clamped (marrow TUNING). */
const STEP = TUNING.maxClockStepMs;
/** The mapping of the play area, the same as GardenStage's: the whole area is the screen, with gain 1. */
const MAPPING = makeMapping({ playAspect: ASPECT, frameAspect: ASPECT, gain: 1, centre: { x: ASPECT / 2, y: 0.5 } });

let clock = 0;

/** Runs one frame of the stage's loop at the next time step. */
function runFrame(): void {
  const callback = hoisted.next;
  if (callback === null) throw new Error('the stage asked for no frame');
  clock += STEP;
  hoisted.next = null;
  act(() => callback(clock));
}

function runFrames(count: number): void {
  for (let i = 0; i < count; i++) runFrame();
}

function stage(): HTMLElement {
  const element = document.querySelector<HTMLElement>('main.garden-stage');
  if (element === null) throw new Error('the stage element is not rendered');
  return element;
}

function timerMs(): number {
  return Number(stage().getAttribute('data-timer-ms'));
}

/** The lantern marker's screen centre, read from its DOM style (the drawn lantern sits at the same point). */
function lanternCentre(id: string): { x: number; y: number } {
  const marker = document.querySelector<HTMLElement>(`[data-target="${id}"]`);
  if (marker === null) throw new Error(`no marker ${id}`);
  return { x: (Number.parseFloat(marker.style.left) / 100) * ASPECT, y: Number.parseFloat(marker.style.top) / 100 };
}

/** The pose that puts the right hand over a screen point. */
function handAt(point: { x: number; y: number }): void {
  hoisted.pose = { landmarks: { rightWrist: { pos: MAPPING.toCamera(point), valid: true } } };
}

/**
 * Puts the hand on a lantern's centre. The head view moves the lantern with the hand, so the hand follows the lantern's
 * centre as it moves, for a few frames.
 */
function settleHandOn(id: string): void {
  for (let i = 0; i < 3; i++) {
    handAt(lanternCentre(id));
    runFrame();
  }
}

function lit(id: string): string | null {
  return document.querySelector(`[data-target="${id}"]`)?.getAttribute('data-lit') ?? null;
}

function pressEscape(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
}

describe('Pause stops the session time (requirement 1.4)', () => {
  beforeEach(() => {
    clock = 0;
    hoisted.next = null;
    hoisted.pose = null;
  });

  it('1.4: with the stage paused the session timer does not move, and a dwell on the first lantern lights nothing; after resume the same dwell lights it', async () => {
    render(<GardenStage stage="lantern-glade" />);
    runFrame();
    // Play until the first lantern is the active one (the entry title runs first, then the stage is in play).
    for (let i = 0; i < 200 && document.querySelector('[data-target="lantern-0"][data-active="yes"]') === null; i++) {
      runFrame();
    }
    expect(document.querySelector('[data-target="lantern-0"][data-active="yes"]')).not.toBeNull();
    // Playing, the timer moves: the check below is not vacuous.
    const beforePlaying = timerMs();
    runFrames(3);
    expect(timerMs()).toBeGreaterThan(beforePlaying);

    // Paused: the hand rests on the first lantern for longer than its dwell. The timer does not move and nothing lights.
    // The head view follows the hand, which moves the lantern a little, so the hand is set on it over a few frames.
    pressEscape();
    settleHandOn('lantern-0');
    const paused = timerMs();
    runFrames(40);
    expect(timerMs(), 'the session timer while paused').toBe(paused);
    expect(lit('lantern-0'), 'the first lantern while paused').toBe('no');

    // Resumed: the same hand on the same lantern lights it within a dwell.
    pressEscape();
    runFrames(40);
    expect(lit('lantern-0'), 'the first lantern after resume').toBe('yes');
    expect(timerMs()).toBeGreaterThan(paused);
  });
});
