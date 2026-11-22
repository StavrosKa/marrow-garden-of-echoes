// The calibration screen (Requirements 11.12, 11.14, 11.16, 12.3, 12.6, 15.5, 22.7, 22.8). It draws
// the comfort aura on a canvas, one orb per valid active wrist, the current instruction, and the
// controls and messages the flags and the mode call for (the table in the plan, and below).
//
// The aura is redrawn only when a cell's validity changes. That is when calibration.validCellCount
// changes: the count of valid cells over the active grids, which only changes in such a step. The
// mapping is read through a ref, so a new mapping object alone does not redraw. Each draw sizes the
// canvas to its CSS box and paints in play-area units, so a resize only stretches the last picture
// until the next validity change.
//
// The orbs are SVG circles in a viewBox of 0 0 A 1, with A the play-area aspect. Their positions come
// from the mapping, so they need no style attribute (tests/marrow-styles.test.ts forbids one).
//
// The mapping and the no-usable-slot flag come from the app: the app keeps the transform of the
// current grids and runs Placement on completion (design sections 14.1 and 14.2).
import { useEffect, useRef } from 'react';
import { auraIntensity, isCellValid, TUNING, type CalibrationState, type Mapping, type Vec2, type WristId } from '../core';
import { cellRectCamera } from '../core/comfortGrid';
import { useMarrowCopy } from './marrowCopy';
import { Button, InstructionLine, Panel } from './primitives';

/** One active wrist's filtered pointer, in camera space (valid only while `valid` is true). */
export interface CalibrationPointer {
  readonly wrist: WristId;
  readonly valid: boolean;
  readonly pos: Vec2;
}

export interface CalibrationScreenProps {
  /** The calibration state. Its phase, flags and mode decide every message and control below. */
  calibration: CalibrationState;
  /** The mapping of the current grids: the reach gain and centre computed from them (Requirement 13). */
  mapping: Mapping;
  /** The filtered pointers of the active wrists, for the orbs. */
  pointers: readonly CalibrationPointer[];
  /** True when Placement gave `none` for the completed calibration (Requirement 22.8). */
  noUsableSlot: boolean;
  onRetry: () => void;
  /** "Use the whole screen": simulated-input mode only. */
  onWholeScreen: () => void;
  onTryWithout: () => void;
  onSkipHeadView: () => void;
}

/** The orb radius in play-area units. A visual size, not an interaction value, so it is not in the tuning. */
const ORB_RADIUS = 0.02;
/** The custom property that holds the aura colour; the canvas reads it, so no colour is in the source. */
const AURA_COLOUR = '--marrow-color-aura';

/** The aura's inputs as the last render saw them. The draw effect reads them, so it does not depend on them. */
interface AuraInputs {
  readonly calibration: CalibrationState;
  readonly mapping: Mapping;
}

/** Paints the aura of every valid cell of every active grid, in play-area units (Requirement 15.1, 15.5). */
function drawAura(canvas: HTMLCanvasElement, { calibration, mapping }: AuraInputs): void {
  const context = canvas.getContext('2d');
  if (context === null) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width;
  canvas.height = height;
  context.setTransform(width / calibration.cfg.playAspect, 0, 0, height, 0, 0);
  context.clearRect(0, 0, calibration.cfg.playAspect, 1);
  context.fillStyle = getComputedStyle(canvas).getPropertyValue(AURA_COLOUR).trim();
  for (const wrist of calibration.cfg.activeWrists) {
    const grid = calibration.grids[wrist];
    if (grid === undefined) continue;
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        if (!isCellValid(grid, col, row, TUNING)) continue;
        const rect = cellRectCamera(col, row, TUNING);
        // The mapping is affine, so a cell's rectangle maps to an axis-aligned one.
        const a = mapping.toScreen({ x: rect.x0, y: rect.y0 });
        const b = mapping.toScreen({ x: rect.x1, y: rect.y1 });
        const x0 = Math.min(a.x, b.x);
        const y0 = Math.min(a.y, b.y);
        const x1 = Math.max(a.x, b.x);
        const y1 = Math.max(a.y, b.y);
        // A valid cell has one intensity, so the centre gives it (aura.ts).
        const alpha = auraIntensity({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, calibration.grids, mapping, TUNING);
        if (alpha <= 0) continue;
        context.globalAlpha = alpha;
        context.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }
  context.globalAlpha = 1;
}

export function CalibrationScreen({
  calibration,
  mapping,
  pointers,
  noUsableSlot,
  onRetry,
  onWholeScreen,
  onTryWithout,
  onSkipHeadView,
}: CalibrationScreenProps) {
  const copy = useMarrowCopy();
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef<AuraInputs>({ calibration, mapping });
  const { phase, cfg } = calibration;
  const camera = cfg.mode === 'camera';
  const painting = phase === 'painting';
  const calm = phase === 'calm';
  const inCalibration = painting || calm;

  // Keep the latest inputs for the draw. This effect has no dependencies, so it runs first, before the draw.
  useEffect(() => {
    latest.current = { calibration, mapping };
  });
  // Redraw only when the number of valid cells changes, that is, when a cell's validity changes (Requirement 15.5).
  useEffect(() => {
    if (canvas.current !== null) drawAura(canvas.current, latest.current);
    // The count is the signal; the other inputs are read from `latest`.
  }, [calibration.validCellCount]);

  // Which message or control shows (plan table; Requirements 11.12, 11.14, 11.16, 12.3, 12.6, 22.8).
  const hint = camera && calibration.handHint;
  const keepInView = calm && calibration.keepInView;
  const skipOffered = calm && calibration.skipOffered;
  const wholeScreen = !camera && (inCalibration || noUsableSlot);
  const instruction = noUsableSlot
    ? copy.calibration.noUsableSlot
    : painting
      ? copy.instructions.painting
      : calm
        ? copy.instructions.calmHold
        : '';
  const activePointers = pointers.filter((p) => p.valid && cfg.activeWrists.includes(p.wrist));

  return (
    <Panel label={instruction}>
      <div className="marrow-calibration-stage">
        <canvas ref={canvas} className="marrow-aura" aria-hidden="true" />
        <svg className="marrow-aura-orbs" viewBox={`0 0 ${cfg.playAspect} 1`} preserveAspectRatio="none" aria-hidden="true">
          {activePointers.map((p) => {
            const at = mapping.toScreen(p.pos);
            return <circle key={p.wrist} className="marrow-orb" cx={at.x} cy={at.y} r={ORB_RADIUS} />;
          })}
        </svg>
      </div>
      <InstructionLine text={instruction} />
      {hint ? <p className="marrow-label">{copy.calibration.handHint}</p> : null}
      {hint ? <Button onClick={onTryWithout}>{copy.camera.tryWithout}</Button> : null}
      {keepInView ? <p className="marrow-label">{copy.headView.keepInView}</p> : null}
      {skipOffered ? <Button onClick={onSkipHeadView}>{copy.headView.skip}</Button> : null}
      {inCalibration && !noUsableSlot ? <Button onClick={onRetry}>{copy.camera.retry}</Button> : null}
      {wholeScreen ? <Button onClick={onWholeScreen}>{copy.calibration.wholeScreen}</Button> : null}
      {noUsableSlot ? <Button variant="primary" onClick={onRetry}>{copy.calibration.retryCalibration}</Button> : null}
      {noUsableSlot && camera ? <Button onClick={onTryWithout}>{copy.camera.tryWithout}</Button> : null}
    </Panel>
  );
}
