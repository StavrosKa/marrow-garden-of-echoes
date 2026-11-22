// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { addSample, createGrid, makeMapping, TUNING, type PoseFrame, type WristId } from '../core';
import { cellRectCamera } from '../core/comfortGrid';
import * as react from './index';
import { DebugOverlay, type DebugSnapshot } from './debugOverlay';
import { FIXTURE_COPY } from './copyFixture';
import { MarrowCopyProvider } from './marrowCopy';
// Requirement 25 and 28.9: the Debug Overlay shows the rates, validity, grids, hit areas, head offset
// and latency from its snapshot, in copy-only labels; it has nothing focusable and changes nothing.
// jsdom does not load marrow.css, so the no-pointer rule is checked in tests/marrow-styles.test.ts.
const NOW = 100 * TUNING.debugRateWindowMs;
const WINDOW = TUNING.debugRateWindowMs;
const PLAY_ASPECT = 2;
const FRAME_ASPECT = 1.5;
const MAPPING = makeMapping({ playAspect: PLAY_ASPECT, frameAspect: FRAME_ASPECT, gain: 1, centre: { x: PLAY_ASPECT / 2, y: 0.5 } });
/** A frame whose wrists and nose are given. The shoulders are valid and not shown. */
function frameWith(rightWrist: boolean, leftWrist: boolean, nose: boolean): PoseFrame {
  const at = { x: 0.5, y: 0.5 };
  return {
    t: NOW,
    aspect: FRAME_ASPECT,
    landmarks: {
      leftWrist: { pos: at, valid: leftWrist },
      rightWrist: { pos: at, valid: rightWrist },
      nose: { pos: at, valid: nose },
      leftShoulder: { pos: at, valid: true },
      rightShoulder: { pos: at, valid: true },
    },
  };
}
/** A snapshot with the defaults of a camera frame, changed by the overrides. */
function snapshotWith(overrides: Partial<DebugSnapshot>): DebugSnapshot {
  return {
    mode: 'camera',
    nowMs: NOW,
    renderTimesMs: [],
    newFrameTimesMs: [],
    frameDrawnAtMs: null,
    frame: frameWith(true, false, true),
    playAspect: PLAY_ASPECT,
    activeWrists: ['right'],
    mapping: MAPPING,
    grids: {},
    hitAreas: [],
    headOffset: { x: 0, y: 0 },
    ...overrides,
  };
}
function renderOverlay(snapshot: DebugSnapshot) {
  return render(
    <MarrowCopyProvider value={FIXTURE_COPY}>
      <DebugOverlay snapshot={snapshot} />
    </MarrowCopyProvider>,
  );
}
/** The figure shown next to a label, which is the next element after it. */
function figureAfter(label: string): string | null {
  return screen.getByText(label).nextElementSibling?.textContent ?? null;
}
describe('the rates (Requirement 25.2)', () => {
  it('shows the render rate and the inference rate over the last window', () => {
    renderOverlay(
      snapshotWith({
        renderTimesMs: [NOW - WINDOW / 4, NOW - WINDOW / 2, NOW - 2 * WINDOW],
        newFrameTimesMs: [NOW - WINDOW / 4],
      }),
    );
    expect(figureAfter(FIXTURE_COPY.debug.fps)).toBe(String(Math.round(2 * (1000 / WINDOW))));
    expect(figureAfter(FIXTURE_COPY.debug.inferenceHz)).toBe(String(Math.round(1000 / WINDOW)));
  });
  it('shows the pointer frame rate in place of the inference rate in simulated input', () => {
    renderOverlay(snapshotWith({ mode: 'simulated', newFrameTimesMs: [NOW] }));
    expect(screen.getByText(FIXTURE_COPY.debug.pointerHz)).toBeInTheDocument();
    expect(screen.queryByText(FIXTURE_COPY.debug.inferenceHz)).not.toBeInTheDocument();
  });
});
describe('latency and head offset', () => {
  it('shows the pipeline latency, labelled from the copy', () => {
    renderOverlay(snapshotWith({ frameDrawnAtMs: NOW + 42.4 }));
    expect(figureAfter(FIXTURE_COPY.debug.latency)).toBe('42');
  });
  it('shows the latency as the draw time minus frame.t, not the draw time itself', () => {
    renderOverlay(snapshotWith({ frame: { ...frameWith(true, false, true), t: NOW - 100 }, frameDrawnAtMs: NOW + 42.4 }));
    expect(figureAfter(FIXTURE_COPY.debug.latency)).toBe('142');
  });
  it('shows no latency row before the first frame is rendered', () => {
    renderOverlay(snapshotWith({ frameDrawnAtMs: null }));
    expect(screen.queryByText(FIXTURE_COPY.debug.latency)).not.toBeInTheDocument();
  });
  it('shows the head offset to two decimals', () => {
    renderOverlay(snapshotWith({ headOffset: { x: 0.5, y: -0.25 } }));
    expect(screen.getByText(FIXTURE_COPY.debug.headOffset).nextElementSibling?.textContent).toBe('0.50');
    expect(screen.getByText('-0.25')).toBeInTheDocument();
  });
});
describe('validity of the active wrists and the nose', () => {
  it('shows each active wrist and the nose with valid or invalid, from the copy', () => {
    renderOverlay(snapshotWith({ frame: frameWith(true, false, false), activeWrists: ['right'] }));
    expect(screen.getByText(FIXTURE_COPY.debug.rightWrist).nextElementSibling?.textContent).toBe(FIXTURE_COPY.debug.valid);
    expect(screen.getByText(FIXTURE_COPY.debug.nose).nextElementSibling?.textContent).toBe(FIXTURE_COPY.debug.invalid);
    expect(screen.queryByText(FIXTURE_COPY.debug.leftWrist)).not.toBeInTheDocument();
  });
  it('shows the left wrist row only for a mode whose active wrists include the left wrist', () => {
    const activeWrists: WristId[] = ['left', 'right'];
    renderOverlay(snapshotWith({ frame: frameWith(true, true, true), activeWrists }));
    expect(screen.getByText(FIXTURE_COPY.debug.leftWrist).nextElementSibling?.textContent).toBe(FIXTURE_COPY.debug.valid);
  });
});
describe('the grids and the hit areas (Requirement 25.2)', () => {
  it('draws each cell that holds a sample through the mapping, valid cells in their own class', () => {
    let dense = createGrid(TUNING);
    for (let i = 0; i < TUNING.cellValidSamples; i++) dense = addSample(dense, { x: 0.75, y: 0.75 });
    const { container } = renderOverlay(snapshotWith({ grids: { right: dense }, activeWrists: ['right'] }));
    expect(container.querySelectorAll('rect.marrow-debug-cell--valid')).toHaveLength(1);
    expect(container.querySelectorAll('rect.marrow-debug-cell--invalid')).toHaveLength(0);
    // The valid cell's rectangle is where the mapping puts the cell of the 0.75 sample.
    const rect = cellRectCamera(Math.floor(0.75 * TUNING.gridCols), Math.floor(0.75 * TUNING.gridRows), TUNING);
    const a = MAPPING.toScreen({ x: rect.x0, y: rect.y0 });
    const b = MAPPING.toScreen({ x: rect.x1, y: rect.y1 });
    const drawn = container.querySelector('rect.marrow-debug-cell--valid');
    expect(Number(drawn?.getAttribute('x'))).toBeCloseTo(Math.min(a.x, b.x), 9);
    expect(Number(drawn?.getAttribute('y'))).toBeCloseTo(Math.min(a.y, b.y), 9);
  });
  it('draws a cell with fewer samples than the threshold as invalid', () => {
    const sparse = addSample(createGrid(TUNING), { x: 0.25, y: 0.25 });
    const { container } = renderOverlay(snapshotWith({ grids: { right: sparse } }));
    expect(container.querySelectorAll('rect.marrow-debug-cell--invalid')).toHaveLength(1);
    expect(container.querySelectorAll('rect.marrow-debug-cell--valid')).toHaveLength(0);
  });
  it('draws every hit area of the frame as a circle in screen space', () => {
    const hitAreas = [
      { targetId: 'a', activationId: 'a1', centre: { x: 0.5, y: 0.5 }, radius: TUNING.hitRadius },
      { targetId: 'b', activationId: 'b1', centre: { x: 1.5, y: 0.25 }, radius: TUNING.hitRadius },
    ];
    const { container } = renderOverlay(snapshotWith({ hitAreas }));
    const circles = container.querySelectorAll('circle.marrow-debug-hit');
    expect(circles).toHaveLength(2);
    expect(Number(circles[1]?.getAttribute('cx'))).toBeCloseTo(1.5, 9);
    expect(Number(circles[1]?.getAttribute('r'))).toBeCloseTo(TUNING.hitRadius, 9);
  });
});
describe('no input and no state (Requirement 25.4, 25.5)', () => {
  it('has nothing focusable', () => {
    const { container } = renderOverlay(snapshotWith({ hitAreas: [{ targetId: 'a', activationId: 'a1', centre: { x: 0.5, y: 0.5 }, radius: TUNING.hitRadius }] }));
    expect(container.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')).toHaveLength(0);
  });
  it('is the root of the no-pointer class in marrow.css', () => {
    const { container } = renderOverlay(snapshotWith({}));
    expect(container.firstElementChild).toHaveClass('marrow-debug');
  });
  it('draws a frozen snapshot without writing to it', () => {
    const snapshot = deepFreeze(
      snapshotWith({
        renderTimesMs: [NOW - WINDOW / 2],
        newFrameTimesMs: [NOW - WINDOW / 4],
        frameDrawnAtMs: NOW + 12,
        grids: { right: addSample(createGrid(TUNING), { x: 0.25, y: 0.25 }) },
        hitAreas: [{ targetId: 'a', activationId: 'a1', centre: { x: 0.5, y: 0.5 }, radius: TUNING.hitRadius }],
        headOffset: { x: 0.1, y: 0.2 },
      }),
    );
    const before = JSON.stringify(snapshot);
    renderOverlay(snapshot);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(Object.isFrozen(snapshot.grids)).toBe(true);
  });
});
describe('labels come from the copy', () => {
  it('shows every label from the copy', () => {
    renderOverlay(snapshotWith({ frameDrawnAtMs: NOW + 7 }));
    for (const label of [
      FIXTURE_COPY.debug.fps,
      FIXTURE_COPY.debug.inferenceHz,
      FIXTURE_COPY.debug.headOffset,
      FIXTURE_COPY.debug.latency,
      FIXTURE_COPY.debug.validity,
      FIXTURE_COPY.debug.rightWrist,
      FIXTURE_COPY.debug.nose,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
describe('the barrel', () => {
  it('exports DebugOverlay from marrow/react', () => {
    expect(react.DebugOverlay).toBe(DebugOverlay);
  });
});
/** Freezes every object and array in the graph. Functions are left alone, since they are not data. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}
