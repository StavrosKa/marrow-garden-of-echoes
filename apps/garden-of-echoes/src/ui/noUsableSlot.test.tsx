// @vitest-environment jsdom
// The no-usable-slot screen (requirement 10.6). The comfort grids are read before and after a placement that has no usable
// slot, and they must be unchanged: the app never enlarges the comfort map.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TUNING, createHelp } from 'marrow/core';
import { ATTENTION_TUNING } from 'marrow/challenges';
import { TUNING as WORLD_TUNING, type WorldPoint } from 'world-view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gardenMarrowCopy } from '../copy/gardenMarrowCopy';
import { GARDEN_COPY } from '../copy/garden';
import { INTERACTION_LAYER } from '../scene/forestLayers';
import { SIMULATED_WRISTS, wholeFrameReach } from '../session/wholeFrame';
import { placeRound } from '../stages/shared/placeRound';
import { NoUsableSlot } from './NoUsableSlot';

const ASPECT = 16 / 9;
/** A slot far off the frame, so it is culled and no slot is usable. */
const OFF_SCREEN = 1e6;

let getUserMedia: ReturnType<typeof vi.fn>;
const ORIGINAL = Object.getOwnPropertyDescriptor(globalThis.navigator, 'mediaDevices');

beforeEach(() => {
  getUserMedia = vi.fn(() => Promise.reject(new Error('the camera must not be requested here')));
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});

afterEach(() => {
  if (ORIGINAL !== undefined) Object.defineProperty(globalThis.navigator, 'mediaDevices', ORIGINAL);
  else Reflect.deleteProperty(globalThis.navigator, 'mediaDevices');
});

describe('the no-usable-slot screen (requirement 10.6)', () => {
  it('10.6: shows "Retry calibration" and "Try without camera" with the no-slot message', () => {
    render(<NoUsableSlot onRetry={() => undefined} onTryWithout={() => undefined} />);
    expect(screen.getByRole('button', { name: gardenMarrowCopy.calibration.retryCalibration })).toBeTruthy();
    expect(screen.getByRole('button', { name: GARDEN_COPY.home.noCamera })).toBeTruthy();
    expect(screen.getByText(gardenMarrowCopy.calibration.noUsableSlot)).toBeTruthy();
  });

  it('10.6: "Retry calibration" calls onRetry and requests no camera', async () => {
    const onRetry = vi.fn();
    render(<NoUsableSlot onRetry={onRetry} onTryWithout={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: gardenMarrowCopy.calibration.retryCalibration }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('10.6: "Try without camera" calls onTryWithout and requests no camera', async () => {
    const onTryWithout = vi.fn();
    render(<NoUsableSlot onRetry={() => undefined} onTryWithout={onTryWithout} />);
    await userEvent.click(screen.getByRole('button', { name: GARDEN_COPY.home.noCamera }));
    expect(onTryWithout).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('10.6: a placement with no usable slot gives none, and the comfort grids are unchanged', () => {
    const reach = wholeFrameReach(ASPECT);
    const before = JSON.stringify(reach.grids);
    const far: WorldPoint = { x: OFF_SCREEN, y: OFF_SCREEN, depth: INTERACTION_LAYER.depth, anchor: INTERACTION_LAYER.anchor, factor: WORLD_TUNING.interactionFactor };
    const placed = placeRound({
      worldSlots: [far],
      n: 1,
      help: createHelp(TUNING),
      grids: reach.grids,
      activeWrists: SIMULATED_WRISTS,
      mapping: reach.mapping,
      view: { travel: 0, head: { x: 0, y: 0 } },
      frame: { aspect: ASPECT, sceneScale: 1 },
      layer: { depth: INTERACTION_LAYER.depth, anchor: INTERACTION_LAYER.anchor, factor: WORLD_TUNING.interactionFactor },
      bandY: ATTENTION_TUNING.restingBandY,
      core: TUNING,
    });
    expect(placed.kind).toBe('none');
    expect(placed.points).toEqual([]);
    expect(JSON.stringify(reach.grids)).toBe(before);
  });
});
