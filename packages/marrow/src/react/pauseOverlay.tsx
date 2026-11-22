// The Pause overlay (Requirements 23.1, 23.4, 23.5, 23.6, 24.1). It offers Resume, Recalibrate, the
// motion setting, mute, volume and Exit. Escape and the open/close state belong to the app, which
// also draws Pause and the mute control as chrome around the screens (plan, point 2). Focus moves
// to Resume when the overlay opens.
import { useEffect, useRef } from 'react';
import { AudioSettings, MotionSetting } from './settingsControls';
import { useMarrowCopy } from './marrowCopy';
import { Button, InstructionLine } from './primitives';

export interface PauseOverlayProps {
  onResume: () => void;
  onRecalibrate: () => void;
  onExit: () => void;
}

export function PauseOverlay({ onResume, onRecalibrate, onExit }: PauseOverlayProps) {
  const copy = useMarrowCopy();
  const resume = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    resume.current?.focus();
  }, []);
  return (
    <div role="dialog" aria-label={copy.pause.pause} className="marrow-overlay">
      <div className="marrow-panel">
        <InstructionLine text={copy.pause.pause} />
        <Button variant="primary" ref={resume} onClick={onResume}>
          {copy.pause.resume}
        </Button>
        <Button onClick={onRecalibrate}>{copy.pause.recalibrate}</Button>
        <MotionSetting />
        <AudioSettings />
        <Button onClick={onExit}>{copy.pause.exit}</Button>
      </div>
    </div>
  );
}
