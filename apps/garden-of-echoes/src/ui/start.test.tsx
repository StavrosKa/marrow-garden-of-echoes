// @vitest-environment jsdom
// The ?start shortcut (garden-level requirements 20.1 to 20.5). The entry itself is unchanged (startEntry.ts): this file
// tests what the entry shows. A stage plan shows the stage in simulated input with its label and never asks for the camera.
// An unknown id shows Home. The Pixi scene and the frame loop are replaced by stubs, so the test runs in jsdom.
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GARDEN_COPY } from '../copy/garden';
import { startPlan } from '../session/startEntry';
import { STAGE_IDS } from '../session/stageOrder';
import { App } from './App';
import { GardenStage } from './GardenStage';

// The Scene Manager needs a canvas, and the frame loop needs animation frames. Neither is in jsdom, so both are stubbed.
vi.mock('world-view/pixi', () => ({
  createSceneManager: () => ({ start: async () => undefined, dispose: () => undefined, setTargets: () => undefined }),
}));
vi.mock('./frames', () => ({ browserFrames: { request: () => 0, cancel: () => undefined } }));

let getUserMedia: ReturnType<typeof vi.fn>;
const ORIGINAL = Object.getOwnPropertyDescriptor(globalThis.navigator, 'mediaDevices');

beforeEach(() => {
  getUserMedia = vi.fn(() => Promise.reject(new Error('the camera must not be requested by ?start')));
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});

afterEach(() => {
  if (ORIGINAL !== undefined) Object.defineProperty(globalThis.navigator, 'mediaDevices', ORIGINAL);
  else Reflect.deleteProperty(globalThis.navigator, 'mediaDevices');
});

/** Renders what main.tsx renders for a query string: the stage for a stage plan, the app otherwise. */
function renderEntry(search: string): void {
  const plan = startPlan(search);
  if (plan.kind === 'stage') render(<GardenStage stage={plan.stage} />);
  else render(<App />);
}

describe('the ?start entry (requirements 20.1 to 20.5)', () => {
  it('20.1: each of the four stage ids gives a stage plan for that stage', () => {
    for (const stage of STAGE_IDS) {
      expect(startPlan(`?start=${stage}`)).toMatchObject({ kind: 'stage', stage, input: 'simulated', reach: 'frame' });
    }
  });

  it.each(STAGE_IDS)('20.2 20.3 20.4: ?start=%s shows the stage in simulated input with its label, and no camera is requested', (stage) => {
    renderEntry(`?start=${stage}`);
    expect(screen.getByText(GARDEN_COPY.label.simulated)).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('20.5: an unknown stage id shows Home, and does not crash or ask for the camera', () => {
    expect(startPlan('?start=nowhere')).toEqual({ kind: 'app' });
    renderEntry('?start=nowhere');
    expect(screen.getByRole('button', { name: GARDEN_COPY.home.start })).toBeTruthy();
    expect(screen.getByRole('button', { name: GARDEN_COPY.home.noCamera })).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('20.5: a missing start value also shows Home', () => {
    renderEntry('');
    expect(screen.getByRole('button', { name: GARDEN_COPY.home.start })).toBeTruthy();
  });
});
