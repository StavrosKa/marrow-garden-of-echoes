// A complete MarrowCopy for the component tests of this folder. It is not exported from the
// package. Each string is distinct, so a test that finds one on screen knows where it came from.
import type { MarrowCopy } from './marrowCopy';

export const FIXTURE_COPY: MarrowCopy = {
  start: { title: 'Fixture start title', start: 'Fixture start' },
  camera: {
    explanation: 'Fixture camera explanation.',
    useCamera: 'Fixture use camera',
    tryWithout: 'Fixture try without',
    deniedMessage: 'Fixture denied message',
    noCameraMessage: 'Fixture no camera message',
    modelFailedMessage: 'Fixture model failed message',
    retry: 'Fixture retry',
    previewLabel: 'Fixture preview label',
  },
  hands: {
    question: 'Fixture which hand',
    right: 'Fixture right',
    left: 'Fixture left',
    both: 'Fixture both',
    continue: 'Fixture continue',
  },
  calibration: {
    wholeScreen: 'Fixture whole screen',
    handHint: 'Fixture hand hint',
    noUsableSlot: 'Fixture no usable slot',
    retryCalibration: 'Fixture retry calibration',
  },
  headView: { keepInView: 'Fixture keep in view', skip: 'Fixture skip head view' },
  tracking: {
    stepBackIn: 'Fixture step back in',
    recover: 'Fixture recover',
    oneWristHint: 'Fixture one wrist hint',
    pictureLabel: 'Fixture picture label',
  },
  pause: {
    pause: 'Fixture pause',
    resume: 'Fixture resume',
    recalibrate: 'Fixture recalibrate',
    exit: 'Fixture exit',
  },
  settings: {
    motion: 'Fixture motion',
    full: 'Fixture full',
    gentle: 'Fixture gentle',
    reduced: 'Fixture reduced',
    sound: 'Fixture sound',
    mute: 'Fixture mute',
    volume: 'Fixture volume',
  },
  simulatedInputLabel: 'Fixture simulated input',
  debug: {
    fps: 'Fixture fps',
    inferenceHz: 'Fixture inference',
    pointerHz: 'Fixture pointer',
    validity: 'Fixture validity',
    leftWrist: 'Fixture left wrist',
    rightWrist: 'Fixture right wrist',
    nose: 'Fixture nose',
    valid: 'Fixture valid',
    invalid: 'Fixture invalid',
    headOffset: 'Fixture head offset',
    latency: 'Fixture latency',
  },
  instructions: {
    painting: 'Fixture painting instruction',
    calmHold: 'Fixture calm hold instruction',
  },
};
