// The tracking-lost overlay (Requirements 23.7, 23.8, 23.9, 24.1). It asks the player to step back into
// view, with a simple placeholder picture, and offers Recover, "Try without camera" and Exit. The
// Tracking Lifecycle decides when it shows; the app decides what each control does. Focus moves to
// Recover when the overlay opens.
//
// The picture is an inline SVG. Its shapes take their colour from currentColor, which the class sets
// from --marrow-color-text-muted, so the source holds no colour. Its shape sizes are presentation only.
import { useEffect, useRef } from 'react';
import { useMarrowCopy } from './marrowCopy';
import { Button, InstructionLine } from './primitives';

export interface TrackingLostOverlayProps {
  onRecover: () => void;
  onTryWithout: () => void;
  onExit: () => void;
}

export function TrackingLostOverlay({ onRecover, onTryWithout, onExit }: TrackingLostOverlayProps) {
  const copy = useMarrowCopy();
  const recover = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    recover.current?.focus();
  }, []);
  return (
    <div role="dialog" aria-label={copy.tracking.stepBackIn} className="marrow-overlay">
      <div className="marrow-panel">
        <InstructionLine text={copy.tracking.stepBackIn} />
        <svg role="img" aria-label={copy.tracking.pictureLabel} className="marrow-placeholder" viewBox="0 0 64 64">
          <rect x="4" y="4" width="56" height="56" rx="8" fill="none" stroke="currentColor" strokeWidth="3" />
          <circle cx="32" cy="24" r="9" fill="currentColor" />
          <path d="M18 56 C18 42 46 42 46 56" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
        <Button variant="primary" ref={recover} onClick={onRecover}>
          {copy.tracking.recover}
        </Button>
        <Button onClick={onTryWithout}>{copy.camera.tryWithout}</Button>
        <Button onClick={onExit}>{copy.pause.exit}</Button>
      </div>
    </div>
  );
}
