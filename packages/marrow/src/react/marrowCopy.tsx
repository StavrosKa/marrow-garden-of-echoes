// Every string that marrow/react shows (Requirement 21, design section 7). The package holds no
// player-facing text of its own: the app fills this object in its copy/ folder and passes it to
// MarrowCopyProvider at the top of the tree. A missing entry is a type error.
import { createContext, useContext, type ReactNode } from 'react';

export interface MarrowCopy {
  start: { title: string; start: string };
  camera: {
    /** One sentence: the camera follows the hands and head; video stays on this device (Req 21.5). */
    explanation: string;
    useCamera: string;
    tryWithout: string;
    deniedMessage: string;
    noCameraMessage: string;
    modelFailedMessage: string;
    retry: string;
    /** Accessible name of the camera preview. */
    previewLabel: string;
  };
  hands: { question: string; right: string; left: string; both: string; continue: string };
  calibration: {
    wholeScreen: string;
    handHint: string;
    noUsableSlot: string;
    retryCalibration: string;
  };
  headView: { keepInView: string; skip: string };
  tracking: {
    stepBackIn: string;
    recover: string;
    oneWristHint: string;
    /** Accessible name of the placeholder picture (Req 23.7). */
    pictureLabel: string;
  };
  pause: { pause: string; resume: string; recalibrate: string; exit: string };
  settings: {
    motion: string;
    full: string;
    gentle: string;
    reduced: string;
    sound: string;
    mute: string;
    volume: string;
  };
  simulatedInputLabel: string;
  debug: {
    fps: string;
    inferenceHz: string;
    pointerHz: string;
    validity: string;
    headOffset: string;
    latency: string;
  };
  instructions: {
    painting: string;
    calmHold: string;
  };
}

const MarrowCopyContext = createContext<MarrowCopy | null>(null);

export interface MarrowCopyProviderProps {
  value: MarrowCopy;
  children: ReactNode;
}

export function MarrowCopyProvider({ value, children }: MarrowCopyProviderProps) {
  return <MarrowCopyContext.Provider value={value}>{children}</MarrowCopyContext.Provider>;
}

/** The copy the nearest MarrowCopyProvider supplies. Throws when there is no provider. */
export function useMarrowCopy(): MarrowCopy {
  const copy = useContext(MarrowCopyContext);
  if (copy === null) throw new Error('useMarrowCopy must be used inside a MarrowCopyProvider.');
  return copy;
}
