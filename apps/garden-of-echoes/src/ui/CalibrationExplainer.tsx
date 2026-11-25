// The calibration explainer (garden-level requirements 11.1 to 11.4; design gap G5). It shows the painted area of reach, a
// progress ring toward the nominal calibration time, and the sentence "Reach ends where the camera's view ends." The ring has
// no number, no seconds count and no countdown: its only text is its accessible name (Req 11.2). The ring fills from the
// calibration's painting time over TUNING.calibNominalMs (Req 11.2).
import { useId, type ReactElement } from 'react';
import { TUNING } from 'marrow/core';
import { gardenMarrowCopy } from '../copy/gardenMarrowCopy';
import { GARDEN_COPY } from '../copy/garden';
import './setup.css';

/** The circle of the ring in its unit box: centre and radius, in the ring's viewBox of 0 to 1. */
const RING_CENTRE = 0.5;
const RING_RADIUS = 0.4;
const RING_STROKE = 0.08;

/**
 * The part of the ring that is filled, from 0 to 1: the painting time over the nominal time, capped at 1. A time that is
 * not a finite number, or is 0 or less, fills nothing.
 */
export function ringFraction(paintingMs: number): number {
  if (!Number.isFinite(paintingMs) || paintingMs <= 0) return 0;
  return Math.min(1, paintingMs / TUNING.calibNominalMs);
}

export interface CalibrationExplainerProps {
  /** The time the player has spent painting, from the calibration state (marrow's paintingMs). */
  readonly paintingMs: number;
}

export function CalibrationExplainer({ paintingMs }: CalibrationExplainerProps): ReactElement {
  const sentenceId = useId();
  const fraction = ringFraction(paintingMs);
  return (
    <div className="garden-calibration">
      <div className="garden-painted-area" role="img" aria-labelledby={sentenceId} />
      <svg className="garden-ring" role="img" aria-label={gardenMarrowCopy.instructions.painting} viewBox="0 0 1 1">
        <circle
          className="garden-ring__track"
          cx={RING_CENTRE}
          cy={RING_CENTRE}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          style={{ stroke: 'var(--marrow-color-progress-track)' }}
        />
        <circle
          className="garden-ring__progress"
          cx={RING_CENTRE}
          cy={RING_CENTRE}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - fraction}
          style={{ stroke: 'var(--marrow-color-progress)' }}
        />
      </svg>
      <p id={sentenceId} className="garden-calibration__sentence">
        {GARDEN_COPY.calibrate.edge}
      </p>
    </div>
  );
}
