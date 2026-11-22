// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCalibration,
  makeMapping,
  stepCalibration,
  TUNING,
  type CalibrationState,
  type HeadLandmarks,
  type Mapping,
  type Vec2,
  type WristId,
} from '../core';
import * as react from './index';
import { CalibrationScreen, type CalibrationPointer, type CalibrationScreenProps } from './calibrationScreen';
import { FIXTURE_COPY } from './copyFixture';
import { MarrowCopyProvider } from './marrowCopy';
// Requirements 11.12, 11.14, 11.16, 12.3, 12.6, 15.5 and 22.7 to 22.10. Every message and control is
// checked against the flag and the mode that decide it. The canvas context is a stub that counts
// the draws, so the test can see when the aura is redrawn. No test opens a camera.
/** The part of a 2d context the aura uses, as a counting stub. */
interface ContextStub {
  setTransform: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillStyle: string;
  globalAlpha: number;
}
let context: ContextStub;
beforeEach(() => {
  context = { setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '', globalAlpha: 1 };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});
const PLAY_ASPECT = 2;
const FRAME_ASPECT = 1.5;
const HEAD: HeadLandmarks = {
  nose: { pos: { x: 0.5, y: 0.3 }, valid: true },
  leftShoulder: { pos: { x: 0.6, y: 0.5 }, valid: true },
  rightShoulder: { pos: { x: 0.4, y: 0.5 }, valid: true },
};
/** A calibration in the painting phase, in the given mode, with the given wrists. */
function startState(mode: 'camera' | 'simulated', activeWrists: WristId[] = ['right']): CalibrationState {
  return createCalibration({
    activeWrists,
    mode,
    demand: { slots: [{ x: PLAY_ASPECT / 2, y: 0.5 }], n: 1, r: TUNING.hitRadius, m: 0 },
    frameAspect: FRAME_ASPECT,
    playAspect: PLAY_ASPECT,
    tuning: TUNING,
  });
}
/** Feeds `frames` consumed frames with the right wrist at `pos`, with no presence time passing. */
function paint(state: CalibrationState, pos: Vec2, frames: number): CalibrationState {
  let next = state;
  for (let i = 0; i < frames; i++) {
    next = stepCalibration(next, { pointers: { right: { valid: true, pos } }, frameConsumed: true, head: HEAD }, 0).state;
  }
  return next;
}
/** A state of one phase with the flags set by the caller. */
function withFlags(base: CalibrationState, flags: Partial<CalibrationState>): CalibrationState {
  return { ...base, ...flags };
}
const MAPPING: Mapping = makeMapping({
  playAspect: PLAY_ASPECT,
  frameAspect: FRAME_ASPECT,
  gain: 1,
  centre: { x: PLAY_ASPECT / 2, y: 0.5 },
});
const NO_POINTERS: readonly CalibrationPointer[] = [];
interface ScreenOptions {
  calibration: CalibrationState;
  pointers?: readonly CalibrationPointer[];
  noUsableSlot?: boolean;
  onRetry?: () => void;
  onWholeScreen?: () => void;
  onTryWithout?: () => void;
  onSkipHeadView?: () => void;
}
function renderScreen(options: ScreenOptions) {
  const props: CalibrationScreenProps = {
    calibration: options.calibration,
    mapping: MAPPING,
    pointers: options.pointers ?? NO_POINTERS,
    noUsableSlot: options.noUsableSlot ?? false,
    onRetry: options.onRetry ?? (() => undefined),
    onWholeScreen: options.onWholeScreen ?? (() => undefined),
    onTryWithout: options.onTryWithout ?? (() => undefined),
    onSkipHeadView: options.onSkipHeadView ?? (() => undefined),
  };
  return render(
    <MarrowCopyProvider value={FIXTURE_COPY}>
      <CalibrationScreen {...props} />
    </MarrowCopyProvider>,
  );
}
/** The buttons named by a copy string, or none. */
function hasButton(name: string): boolean {
  return screen.queryAllByRole('button', { name }).length > 0;
}
describe('the aura redraw (Requirement 15.5)', () => {
  it('redraws only when the number of valid cells changes', () => {
    const empty = startState('camera');
    const { rerender } = renderScreen({ calibration: empty });
    expect(context.clearRect).toHaveBeenCalledTimes(1);
    // The same count with a new pointer and a new mapping: no validity changed, so no redraw.
    rerender(
      <MarrowCopyProvider value={FIXTURE_COPY}>
        <CalibrationScreen
          calibration={withFlags(empty, { handHint: false })}
          mapping={makeMapping({ playAspect: PLAY_ASPECT, frameAspect: FRAME_ASPECT, gain: 1.2, centre: { x: 1, y: 0.5 } })}
          pointers={[{ wrist: 'right', valid: true, pos: { x: 0.5, y: 0.5 } }]}
          noUsableSlot={false}
          onRetry={() => undefined}
          onWholeScreen={() => undefined}
          onTryWithout={() => undefined}
          onSkipHeadView={() => undefined}
        />
      </MarrowCopyProvider>,
    );
    expect(context.clearRect).toHaveBeenCalledTimes(1);
    // One cell reaches the threshold: a validity change, so one more redraw.
    const painted = paint(empty, { x: 0.5, y: 0.5 }, TUNING.cellValidSamples);
    expect(painted.validCellCount).toBe(1);
    rerender(
      <MarrowCopyProvider value={FIXTURE_COPY}>
        <CalibrationScreen
          calibration={painted}
          mapping={MAPPING}
          pointers={NO_POINTERS}
          noUsableSlot={false}
          onRetry={() => undefined}
          onWholeScreen={() => undefined}
          onTryWithout={() => undefined}
          onSkipHeadView={() => undefined}
        />
      </MarrowCopyProvider>,
    );
    expect(context.clearRect).toHaveBeenCalledTimes(2);
  });
  it('paints one rectangle per valid cell, with the cell inside the play area', () => {
    const painted = paint(startState('camera'), { x: 0.5, y: 0.5 }, TUNING.cellValidSamples);
    renderScreen({ calibration: painted });
    // One valid cell: one filled rectangle, even though the aura is drawn in one pass.
    expect(context.fillRect).toHaveBeenCalledTimes(1);
    const [x = NaN, y = NaN, width = NaN, height = NaN] = context.fillRect.mock.calls[0] as number[];
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(PLAY_ASPECT);
    expect(y + height).toBeLessThanOrEqual(1);
  });
});
describe('the aura and the orbs share one uniform scale (Requirement 22.7)', () => {
  /** jsdom has no layout, so the canvas box is fixed for one test and removed after it. */
  function stubCanvasBox(width: number, height: number): () => void {
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => width });
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, get: () => height });
    return () => {
      Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientWidth');
      Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientHeight');
    };
  }
  it('fits the play area in the box with one centred scale, so the aura is not stretched and the orbs are round', () => {
    const restore = stubCanvasBox(500, 200);
    try {
      const painted = paint(startState('camera'), { x: 0.5, y: 0.5 }, TUNING.cellValidSamples);
      const { container } = renderScreen({ calibration: painted });
      // The play area is PLAY_ASPECT (2) by 1. In a 500 by 200 box the scale is min(500 / 2, 200) = 200, and the
      // play area is 400 wide, so it is centred with an offset of 50 on x.
      const last = context.setTransform.mock.calls.at(-1);
      expect(last).toEqual([200, 0, 0, 200, 50, 0]);
      expect(container.querySelector('svg.marrow-aura-orbs')?.getAttribute('preserveAspectRatio')).toBeNull();
    } finally {
      restore();
    }
  });
});

describe('the orbs (Requirement 22.7)', () => {
  it('shows one orb at the mapped position of each valid active wrist, and none for an invalid or inactive one', () => {
    const { container } = renderScreen({
      calibration: startState('camera', ['right']),
      pointers: [
        { wrist: 'right', valid: true, pos: { x: 0.25, y: 0.5 } },
        { wrist: 'left', valid: true, pos: { x: 0.75, y: 0.5 } },
      ],
    });
    const orbs = container.querySelectorAll('circle.marrow-orb');
    expect(orbs).toHaveLength(1);
    const at = MAPPING.toScreen({ x: 0.25, y: 0.5 });
    expect(Number(orbs[0]?.getAttribute('cx'))).toBeCloseTo(at.x, 9);
    expect(Number(orbs[0]?.getAttribute('cy'))).toBeCloseTo(at.y, 9);
  });
  it('shows no orb for a wrist that is not valid', () => {
    const { container } = renderScreen({
      calibration: startState('camera'),
      pointers: [{ wrist: 'right', valid: false, pos: { x: 0.25, y: 0.5 } }],
    });
    expect(container.querySelectorAll('circle.marrow-orb')).toHaveLength(0);
  });
});
describe('each message and control shows only when its flag or mode says so', () => {
  it('shows the painting instruction while painting and the calm-hold instruction in the calm hold', () => {
    const { unmount } = renderScreen({ calibration: startState('camera') });
    expect(screen.getByText(FIXTURE_COPY.instructions.painting)).toBeInTheDocument();
    unmount();
    renderScreen({ calibration: withFlags(startState('camera'), { phase: 'calm' }) });
    expect(screen.getByText(FIXTURE_COPY.instructions.calmHold)).toBeInTheDocument();
    expect(screen.queryByText(FIXTURE_COPY.instructions.painting)).not.toBeInTheDocument();
  });
  it('shows the hand hint with "Try without camera" in camera mode when the hint flag is set', () => {
    renderScreen({ calibration: withFlags(startState('camera'), { handHint: true }) });
    expect(screen.getByText(FIXTURE_COPY.calibration.handHint)).toBeInTheDocument();
    expect(hasButton(FIXTURE_COPY.camera.tryWithout)).toBe(true);
  });
  it('shows neither the hand hint nor its control without the flag, and never in simulated input', () => {
    const { unmount } = renderScreen({ calibration: startState('camera') });
    expect(screen.queryByText(FIXTURE_COPY.calibration.handHint)).not.toBeInTheDocument();
    expect(hasButton(FIXTURE_COPY.camera.tryWithout)).toBe(false);
    unmount();
    renderScreen({ calibration: withFlags(startState('simulated'), { handHint: true }) });
    expect(screen.queryByText(FIXTURE_COPY.calibration.handHint)).not.toBeInTheDocument();
    expect(hasButton(FIXTURE_COPY.camera.tryWithout)).toBe(false);
  });
  it('shows "Keep your face and shoulders in view" only in the calm hold with the keep-in-view flag', () => {
    const { unmount } = renderScreen({
      calibration: withFlags(startState('camera'), { phase: 'calm', keepInView: true }),
    });
    expect(screen.getByText(FIXTURE_COPY.headView.keepInView)).toBeInTheDocument();
    unmount();
    renderScreen({ calibration: withFlags(startState('camera'), { phase: 'painting', keepInView: true }) });
    expect(screen.queryByText(FIXTURE_COPY.headView.keepInView)).not.toBeInTheDocument();
  });
  it('offers "Skip head view" only in the calm hold once it is offered', () => {
    const { unmount } = renderScreen({
      calibration: withFlags(startState('camera'), { phase: 'calm', skipOffered: true }),
    });
    expect(hasButton(FIXTURE_COPY.headView.skip)).toBe(true);
    unmount();
    renderScreen({ calibration: withFlags(startState('camera'), { phase: 'painting', skipOffered: true }) });
    expect(hasButton(FIXTURE_COPY.headView.skip)).toBe(false);
  });
  it('offers Retry during painting and the calm hold, and not in the no-usable-slot state', () => {
    const { unmount } = renderScreen({ calibration: startState('camera') });
    expect(hasButton(FIXTURE_COPY.camera.retry)).toBe(true);
    unmount();
    renderScreen({ calibration: withFlags(startState('camera'), { phase: 'calm' }) });
    expect(hasButton(FIXTURE_COPY.camera.retry)).toBe(true);
  });
  it('shows "Use the whole screen" in simulated input during painting and the calm hold', () => {
    const { unmount } = renderScreen({ calibration: startState('simulated') });
    expect(hasButton(FIXTURE_COPY.calibration.wholeScreen)).toBe(true);
    unmount();
    renderScreen({ calibration: withFlags(startState('simulated'), { phase: 'calm' }) });
    expect(hasButton(FIXTURE_COPY.calibration.wholeScreen)).toBe(true);
  });
  it('shows the no-usable-slot message with "Retry calibration" and "Try without camera" in camera mode', () => {
    renderScreen({ calibration: withFlags(startState('camera'), { phase: 'complete' }), noUsableSlot: true });
    expect(screen.getByText(FIXTURE_COPY.calibration.noUsableSlot)).toBeInTheDocument();
    expect(hasButton(FIXTURE_COPY.calibration.retryCalibration)).toBe(true);
    expect(hasButton(FIXTURE_COPY.camera.tryWithout)).toBe(true);
    expect(hasButton(FIXTURE_COPY.camera.retry)).toBe(false);
  });
  it('shows the no-usable-slot message with "Retry calibration" and "Use the whole screen" in simulated input', () => {
    renderScreen({ calibration: withFlags(startState('simulated'), { phase: 'complete' }), noUsableSlot: true });
    expect(screen.getByText(FIXTURE_COPY.calibration.noUsableSlot)).toBeInTheDocument();
    expect(hasButton(FIXTURE_COPY.calibration.retryCalibration)).toBe(true);
    expect(hasButton(FIXTURE_COPY.calibration.wholeScreen)).toBe(true);
    expect(hasButton(FIXTURE_COPY.camera.tryWithout)).toBe(false);
  });
});
describe('whole_screen_never_in_camera_mode (Requirement 11.16, 28.9)', () => {
  it('never renders "Use the whole screen" in camera mode, in any phase, with or without a usable slot', () => {
    for (const phase of ['painting', 'calm', 'complete'] as const) {
      for (const noUsableSlot of [false, true]) {
        for (const handHint of [false, true]) {
          const calibration = withFlags(startState('camera'), { phase, handHint, skipOffered: true, keepInView: true });
          const { unmount } = renderScreen({ calibration, noUsableSlot });
          expect(hasButton(FIXTURE_COPY.calibration.wholeScreen), `${phase}/${noUsableSlot}/${handHint}`).toBe(false);
          expect(screen.queryByText(FIXTURE_COPY.calibration.wholeScreen)).not.toBeInTheDocument();
          unmount();
        }
      }
    }
  });
});
describe('the controls call their callbacks by mouse and by keyboard', () => {
  it('calls Retry, "Use the whole screen" and "Skip head view" once each, by mouse and keyboard', async () => {
    const onRetry = vi.fn();
    const onWholeScreen = vi.fn();
    const onSkipHeadView = vi.fn();
    const user = userEvent.setup();
    renderScreen({
      calibration: withFlags(startState('simulated'), { phase: 'calm', skipOffered: true }),
      onRetry,
      onWholeScreen,
      onSkipHeadView,
    });
    await user.click(screen.getByRole('button', { name: FIXTURE_COPY.camera.retry }));
    await user.click(screen.getByRole('button', { name: FIXTURE_COPY.calibration.wholeScreen }));
    screen.getByRole('button', { name: FIXTURE_COPY.headView.skip }).focus();
    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onWholeScreen).toHaveBeenCalledTimes(1);
    expect(onSkipHeadView).toHaveBeenCalledTimes(1);
  });
  it('calls "Try without camera" next to the hand hint, by the keyboard', async () => {
    const onTryWithout = vi.fn();
    const user = userEvent.setup();
    renderScreen({ calibration: withFlags(startState('camera'), { handHint: true }), onTryWithout });
    screen.getByRole('button', { name: FIXTURE_COPY.camera.tryWithout }).focus();
    await user.keyboard(' ');
    expect(onTryWithout).toHaveBeenCalledTimes(1);
  });
  it('calls Retry calibration by the keyboard in the no-usable-slot state', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderScreen({ calibration: withFlags(startState('camera'), { phase: 'complete' }), noUsableSlot: true, onRetry });
    screen.getByRole('button', { name: FIXTURE_COPY.calibration.retryCalibration }).focus();
    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
describe('the barrel', () => {
  it('exports CalibrationScreen from marrow/react', () => {
    expect(react.CalibrationScreen).toBe(CalibrationScreen);
  });
});
