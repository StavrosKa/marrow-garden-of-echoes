// The MarrowCopy of the garden (garden-level design 1.2 and 2.11; requirement 14.1). Ten fields take their text from
// GARDEN_COPY, because each has a Requirement 14 key by meaning. Every other field takes its text from copy.marrow,
// the existing infrastructure strings, which are not garden copy and are reviewed with the rest of the copy at the end.
// The spread of copy.marrow is typed MarrowCopy, so a field that is missing from it fails typecheck.
import type { MarrowCopy } from 'marrow/react';
import { GARDEN_COPY } from './garden';
import { copy } from './index';

export const gardenMarrowCopy: MarrowCopy = {
  ...copy.marrow,
  start: {
    ...copy.marrow.start,
    start: GARDEN_COPY.home.start,
    // "Input playground" is not garden copy, so the title is the app name.
    title: copy.appName,
  },
  camera: {
    ...copy.marrow.camera,
    explanation: GARDEN_COPY.camera.why,
    tryWithout: GARDEN_COPY.home.noCamera,
  },
  simulatedInputLabel: GARDEN_COPY.label.simulated,
  tracking: {
    ...copy.marrow.tracking,
    stepBackIn: GARDEN_COPY.tracking.step,
  },
  pause: {
    ...copy.marrow.pause,
    resume: GARDEN_COPY.pause.resume,
    recalibrate: GARDEN_COPY.pause.recalibrate,
    exit: GARDEN_COPY.pause.exit,
  },
  settings: {
    ...copy.marrow.settings,
    motion: GARDEN_COPY.pause.motion,
    sound: GARDEN_COPY.pause.sound,
  },
};
