// The no-usable-slot screen (garden-level requirement 10.6). It shows that no target fits, with "Retry calibration" and
// "Try without camera". It has no comfort map and no grid, so it never enlarges one. The two button texts are the marrow
// copy for retry and the garden copy for the camera choice, both from existing keys.
import type { ReactElement } from 'react';
import { gardenMarrowCopy } from '../copy/gardenMarrowCopy';
import { GARDEN_COPY } from '../copy/garden';
import './setup.css';

export interface NoUsableSlotProps {
  /** "Retry calibration": the app starts the stage again (Req 10.6). */
  readonly onRetry: () => void;
  /** "Try without camera": the app enters simulated input (Req 3.3). */
  readonly onTryWithout: () => void;
}

export function NoUsableSlot({ onRetry, onTryWithout }: NoUsableSlotProps): ReactElement {
  return (
    <main className="garden-no-slot">
      <p className="garden-explanation">{gardenMarrowCopy.calibration.noUsableSlot}</p>
      <div className="garden-actions">
        <button type="button" className="garden-button" onClick={onRetry}>
          {gardenMarrowCopy.calibration.retryCalibration}
        </button>
        <button type="button" className="garden-button" onClick={onTryWithout}>
          {GARDEN_COPY.home.noCamera}
        </button>
      </div>
    </main>
  );
}
