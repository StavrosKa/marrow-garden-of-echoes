// The Debug Overlay (Requirement 25, design section 10.4). It draws the state of one frame, from the
// snapshot it is given and nothing else: no state, no effects, no refs, and no pointer input, so it
// cannot change the run. The frame driver records the times the rates are counted from, and the
// pipeline latency; this component only counts and shows them.
//
// The rates count the recorded times over debugRateWindowMs (debugRates.ts). The latency is the value
// the driver measured at the first render that draws a new frame, from that frame's timestamp.
//
// The grids are drawn through the current mapping, as rectangles of the cells that hold a sample. The
// hit areas are screen-space circles. The SVG uses the play-area viewBox (0 0 A 1), so these shapes
// need no style attribute. The panel's style comes from marrow.css, which gives the overlay
// `pointer-events: none` (tests/marrow-styles.test.ts checks that rule).
import { isCellValid, TUNING, type ComfortGrid, type HitArea, type Mapping, type PoseFrame, type Vec2, type WristId } from '../core';
import { cellRectCamera } from '../core/comfortGrid';
import type { ReactElement } from 'react';
import { ratePerSecond } from './debugRates';
import { useMarrowCopy, type MarrowCopy } from './marrowCopy';

/** Which rate the overlay shows as the second one: inference results from camera mode, pointer frames from simulated input (Req 25.3). */
export type DebugMode = 'camera' | 'simulated';

/**
 * One frame's debug state (Requirement 25.5). Times are in the clock the frame driver reads, the
 * same clock as PoseFrame.t, so the latency and the rates are measured in one clock.
 */
export interface DebugSnapshot {
  readonly mode: DebugMode;
  /** The driver's clock at this render. The rates end here. */
  readonly nowMs: number;
  /** The times of the recent renders, for the render rate (Req 25.2). */
  readonly renderTimesMs: readonly number[];
  /** The times at which a new PoseFrame was first seen, for the inference or pointer rate. */
  readonly newFrameTimesMs: readonly number[];
  /** The time from the current frame's timestamp to the first render that draws it, or null before one. Excludes camera and display latency. */
  readonly latencyMs: number | null;
  /** The current frame, for the validity of the wrists and the nose. Null before the first frame. */
  readonly frame: PoseFrame | null;
  /** The play-area aspect A, which sets the viewBox. */
  readonly playAspect: number;
  /** The wrists that are active in this mode. */
  readonly activeWrists: readonly WristId[];
  /** The mapping of the current grids, or null before calibration sets one. */
  readonly mapping: Mapping | null;
  /** One comfort grid per active wrist. */
  readonly grids: { readonly [W in WristId]?: ComfortGrid };
  /** The hit areas of this frame. */
  readonly hitAreas: readonly HitArea[];
  /** The head offset of this frame, in -1..1 on each axis. */
  readonly headOffset: Vec2;
}

export interface DebugOverlayProps {
  snapshot: DebugSnapshot;
}

/** The rectangle of one cell on screen: its top-left corner and its size. */
interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A cell's rectangle in play-area units. The mapping is affine, so the corners give an axis-aligned rectangle. */
function screenRectOf(mapping: Mapping, col: number, row: number): ScreenRect {
  const rect = cellRectCamera(col, row, TUNING);
  const a = mapping.toScreen({ x: rect.x0, y: rect.y0 });
  const b = mapping.toScreen({ x: rect.x1, y: rect.y1 });
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x, b.x) - x, height: Math.max(a.y, b.y) - y };
}

/** The rectangles of the cells that hold a sample, or are valid, for one wrist's grid. */
function gridRects(snapshot: DebugSnapshot, wrist: WristId, mapping: Mapping): ReactElement[] {
  const grid = snapshot.grids[wrist];
  if (grid === undefined) return [];
  const rects: ReactElement[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const valid = isCellValid(grid, col, row, TUNING);
      const samples = grid.counts[row * grid.cols + col] ?? 0;
      if (!valid && samples === 0) continue;
      const at = screenRectOf(mapping, col, row);
      const state = valid ? 'valid' : 'invalid';
      rects.push(
        <rect
          key={`${wrist}-${col}-${row}`}
          className={`marrow-debug-cell marrow-debug-cell--${state}`}
          x={at.x}
          y={at.y}
          width={at.width}
          height={at.height}
        />,
      );
    }
  }
  return rects;
}

/** The validity row of a wrist or the nose: its name from the copy, then valid or invalid. */
function validityRows(snapshot: DebugSnapshot, copy: MarrowCopy): ReactElement[] {
  const frame = snapshot.frame;
  if (frame === null) return [];
  const rows: { key: string; name: string; valid: boolean }[] = [];
  for (const wrist of snapshot.activeWrists) {
    const landmark = wrist === 'left' ? frame.landmarks.leftWrist : frame.landmarks.rightWrist;
    rows.push({
      key: wrist,
      name: wrist === 'left' ? copy.debug.leftWrist : copy.debug.rightWrist,
      valid: landmark.valid,
    });
  }
  rows.push({ key: 'nose', name: copy.debug.nose, valid: frame.landmarks.nose.valid });
  return rows.map((row) => (
    <div key={row.key}>
      <dt>{row.name}</dt>
      <dd>{row.valid ? copy.debug.valid : copy.debug.invalid}</dd>
    </div>
  ));
}

export function DebugOverlay({ snapshot }: DebugOverlayProps) {
  const copy = useMarrowCopy();
  const windowMs = TUNING.debugRateWindowMs;
  const renderRate = Math.round(ratePerSecond(snapshot.renderTimesMs, snapshot.nowMs, windowMs));
  const frameRate = Math.round(ratePerSecond(snapshot.newFrameTimesMs, snapshot.nowMs, windowMs));
  const frameRateLabel = snapshot.mode === 'camera' ? copy.debug.inferenceHz : copy.debug.pointerHz;
  const { headOffset } = snapshot;
  const { mapping } = snapshot;
  const grids =
    mapping === null ? [] : snapshot.activeWrists.flatMap((wrist) => gridRects(snapshot, wrist, mapping));
  return (
    <div className="marrow-debug">
      <svg className="marrow-debug-view" viewBox={`0 0 ${snapshot.playAspect} 1`} preserveAspectRatio="none" aria-hidden="true">
        {grids}
        {snapshot.hitAreas.map((hit) => (
          <circle key={hit.targetId} className="marrow-debug-hit" cx={hit.centre.x} cy={hit.centre.y} r={hit.radius} />
        ))}
      </svg>
      <div className="marrow-debug-text">
        <dl className="marrow-debug-figures">
          <dt>{copy.debug.fps}</dt>
          <dd>{renderRate}</dd>
          <dt>{frameRateLabel}</dt>
          <dd>{frameRate}</dd>
          <dt>{copy.debug.headOffset}</dt>
          <dd>{headOffset.x.toFixed(2)}</dd>
          <dd>{headOffset.y.toFixed(2)}</dd>
          {snapshot.latencyMs === null ? null : (
            <>
              <dt>{copy.debug.latency}</dt>
              <dd>{Math.round(snapshot.latencyMs)}</dd>
            </>
          )}
        </dl>
        <p className="marrow-label">{copy.debug.validity}</p>
        <dl className="marrow-debug-figures">{validityRows(snapshot, copy)}</dl>
      </div>
    </div>
  );
}
