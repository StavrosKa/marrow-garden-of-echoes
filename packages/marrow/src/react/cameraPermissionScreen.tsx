// The camera permission screen (Requirements 5.1, 22.2, 22.3). It shows the camera explanation with
// "Use the camera" and "Try without camera". After a failed start it shows that outcome's own
// message with Retry and "Try without camera". The app holds the outcome; this component holds nothing.
import type { MarrowCopy } from './marrowCopy';
import { useMarrowCopy } from './marrowCopy';
import { Button, InstructionLine, Panel } from './primitives';

/** The outcomes that leave the camera unusable (Requirement 5.2). `ready` moves on to hand choice. */
export type CameraFailure = 'denied' | 'no-camera' | 'model-failed';

export interface CameraPermissionScreenProps {
  /** The failed outcome of the last start, or null before the first one. */
  failure: CameraFailure | null;
  /** Called by "Use the camera" and by Retry. The app starts the camera from this click (Requirement 5.1). */
  onStartCamera: () => void;
  /** Called by "Try without camera". */
  onTryWithout: () => void;
}

/** The sentence shown as the instruction: the explanation, or the calm message of the failed outcome. */
function messageFor(copy: MarrowCopy, failure: CameraFailure | null): string {
  switch (failure) {
    case null:
      return copy.camera.explanation;
    case 'denied':
      return copy.camera.deniedMessage;
    case 'no-camera':
      return copy.camera.noCameraMessage;
    case 'model-failed':
      return copy.camera.modelFailedMessage;
  }
}

export function CameraPermissionScreen({ failure, onStartCamera, onTryWithout }: CameraPermissionScreenProps) {
  const copy = useMarrowCopy();
  return (
    <Panel label={copy.camera.useCamera}>
      <InstructionLine text={messageFor(copy, failure)} />
      <Button variant="primary" onClick={onStartCamera}>
        {failure === null ? copy.camera.useCamera : copy.camera.retry}
      </Button>
      <Button onClick={onTryWithout}>{copy.camera.tryWithout}</Button>
    </Panel>
  );
}
