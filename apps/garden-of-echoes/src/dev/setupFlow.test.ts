// The setup flow (design section 14.1, Req 22, 23): one test per transition, and the flags never change the screen.
import { describe, expect, it } from 'vitest';
import { INITIAL_SETUP, stepSetup, type SetupEffect, type SetupEvent, type SetupState } from './setupFlow';

/** Runs events from a state, and returns the last state and every effect in order. */
function run(events: readonly SetupEvent[], from: SetupState = INITIAL_SETUP): { state: SetupState; effects: SetupEffect[] } {
  let state = from;
  const effects: SetupEffect[] = [];
  for (const event of events) {
    const step = stepSetup(state, event);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

/** A state on the given screen, reached with the events of the flow. */
function on(events: readonly SetupEvent[]): SetupState {
  return run(events).state;
}

const START: SetupEvent = { kind: 'start' };
const READY: SetupEvent = { kind: 'cameraOutcome', outcome: 'ready' };
const TRY_WITHOUT: SetupEvent = { kind: 'tryWithout' };
const CALIBRATED: SetupEvent = { kind: 'placed', placement: 'simultaneous' };
const PAUSE: SetupEvent = { kind: 'escape' };
const hand: SetupEvent = { kind: 'handChosen', hand: 'right' };

const onPermission = (): SetupState => on([START]);
const onHandChoice = (): SetupState => on([START, READY]);
const onCalibratingCamera = (): SetupState => on([START, READY, hand]);
const onPlayCamera = (): SetupState => on([START, READY, hand, CALIBRATED]);
const onPlaySimulated = (): SetupState => on([START, TRY_WITHOUT, CALIBRATED]);

describe('start and the camera permission screen', () => {
  it('Start goes to the permission screen in camera mode, with no effect', () => {
    const { state, effects } = run([START]);
    expect(state.screen).toBe('cameraPermission');
    expect(state.mode).toBe('camera');
    expect(effects).toEqual([]);
  });

  it('Start is ignored once the flow has started', () => {
    expect(run([START, START]).state).toEqual(onPermission());
  });

  it('"Use the camera" requests the camera and keeps the permission screen', () => {
    const { state, effects } = run([START, { kind: 'useCamera' }]);
    expect(state.screen).toBe('cameraPermission');
    expect(effects).toEqual([{ kind: 'requestCamera' }]);
  });

  it('a ready outcome goes to hand choice', () => {
    expect(run([START, READY]).state.screen).toBe('handChoice');
  });

  it.each(['denied', 'no-camera', 'model-failed'] as const)('the %s outcome goes to the camera error screen with that outcome', (outcome) => {
    const { state } = run([START, { kind: 'cameraOutcome', outcome }]);
    expect(state.screen).toBe('cameraError');
    expect(state.failure).toBe(outcome);
  });

  it('Retry on the camera error screen requests the camera again', () => {
    const failed = on([START, { kind: 'cameraOutcome', outcome: 'denied' }]);
    const { state, effects } = run([{ kind: 'useCamera' }], failed);
    expect(state.screen).toBe('cameraPermission');
    expect(state.failure).toBeNull();
    expect(effects).toEqual([{ kind: 'requestCamera' }]);
  });
});

describe('try without camera', () => {
  it('goes to calibration with the pointer, disposing the camera, and never requests it', () => {
    const { state, effects } = run([START, TRY_WITHOUT]);
    expect(state.screen).toBe('calibrating');
    expect(state.mode).toBe('simulated');
    expect(effects).toEqual([{ kind: 'disposeCamera' }, { kind: 'startCalibration', mode: 'simulated' }]);
  });

  it('is offered on every screen that allows it, and not on hand choice', () => {
    const offered = [onPermission(), on([START, { kind: 'cameraOutcome', outcome: 'denied' }]), onCalibratingCamera(), onPlayCamera()];
    for (const state of offered) {
      expect(stepSetup(state, TRY_WITHOUT).state.mode).toBe('simulated');
    }
    expect(stepSetup(onHandChoice(), TRY_WITHOUT).state).toEqual(onHandChoice());
  });
});

describe('hand choice and calibration', () => {
  it('Continue starts camera calibration; the flow stores nothing', () => {
    const { state, effects } = run([START, READY, hand]);
    expect(state.screen).toBe('calibrating');
    expect(state.mode).toBe('camera');
    expect(effects).toEqual([{ kind: 'startCalibration', mode: 'camera' }]);
  });

  it('a placement other than none ends calibration in play', () => {
    expect(run([START, READY, hand, { kind: 'placed', placement: 'sequential' }]).state.screen).toBe('play');
  });

  it('a placement of none ends calibration on the no-usable-slot screen', () => {
    expect(run([START, READY, hand, { kind: 'placed', placement: 'none' }]).state.screen).toBe('noUsableSlot');
  });

  it('a placement during play of none goes to the no-usable-slot screen; any other placement does not change play', () => {
    expect(run([{ kind: 'placed', placement: 'none' }], onPlayCamera()).state.screen).toBe('noUsableSlot');
    expect(run([{ kind: 'placed', placement: 'sequential' }], onPlayCamera()).state.screen).toBe('play');
  });

  it('Retry calibration restarts calibration from calibration or the no-usable-slot screen', () => {
    const none = on([START, READY, hand, { kind: 'placed', placement: 'none' }]);
    expect(run([{ kind: 'retryCalibration' }], none).effects).toEqual([{ kind: 'startCalibration', mode: 'camera' }]);
    expect(run([{ kind: 'retryCalibration' }], onCalibratingCamera()).effects).toEqual([
      { kind: 'startCalibration', mode: 'camera' },
    ]);
    expect(stepSetup(onPlayCamera(), { kind: 'retryCalibration' }).effects).toEqual([]);
  });

  it('"Use the whole screen" completes calibration only in simulated input', () => {
    const simulated = on([START, TRY_WITHOUT]);
    expect(run([{ kind: 'wholeScreen' }], simulated).effects).toEqual([{ kind: 'completeWholeScreen' }]);
    expect(run([{ kind: 'wholeScreen' }], onCalibratingCamera()).effects).toEqual([]);
  });
});

describe('the flags: Pause and the tracking overlay', () => {
  it('Escape opens Pause and Escape again closes it, and does nothing on the start screen', () => {
    expect(stepSetup(INITIAL_SETUP, PAUSE).state).toEqual(INITIAL_SETUP);
    const open = run([START, PAUSE]).state;
    expect(open.paused).toBe(true);
    expect(run([PAUSE], open).state.paused).toBe(false);
  });

  it('the Pause control opens Pause, and not on the start screen', () => {
    expect(run([START, { kind: 'pauseControl' }]).state.paused).toBe(true);
    expect(stepSetup(INITIAL_SETUP, { kind: 'pauseControl' }).state).toEqual(INITIAL_SETUP);
  });

  it('Resume closes Pause', () => {
    expect(run([START, PAUSE, { kind: 'resume' }]).state.paused).toBe(false);
  });

  it('the overlay shows only in camera play, and the hold end clears it', () => {
    expect(run([{ kind: 'overlayShown' }], onCalibratingCamera()).state.trackingLost).toBe(false);
    const shown = run([{ kind: 'overlayShown' }], onPlayCamera()).state;
    expect(shown.trackingLost).toBe(true);
    expect(run([{ kind: 'holdEnded' }], shown).state.trackingLost).toBe(false);
  });

  it('Pause and the overlay never change the screen', () => {
    const play = onPlayCamera();
    const events: SetupEvent[] = [PAUSE, { kind: 'pauseControl' }, { kind: 'resume' }, { kind: 'overlayShown' }, { kind: 'holdEnded' }];
    for (const event of events) {
      expect(stepSetup(play, event).state.screen).toBe('play');
    }
    const flagged = run([{ kind: 'overlayShown' }, PAUSE], play).state;
    expect(run([PAUSE, { kind: 'holdEnded' }], flagged).state.screen).toBe('play');
  });
});

describe('recalibrate and exit (Pause)', () => {
  it('Recalibrate in camera mode goes to hand choice and keeps the camera running', () => {
    const paused = run([PAUSE], onPlayCamera()).state;
    const { state, effects } = run([{ kind: 'recalibrate' }], paused);
    expect(state.screen).toBe('handChoice');
    expect(state.paused).toBe(false);
    expect(effects).toEqual([]);
  });

  it('Recalibrate in simulated input goes straight to calibration', () => {
    const paused = run([PAUSE], onPlaySimulated()).state;
    const { state, effects } = run([{ kind: 'recalibrate' }], paused);
    expect(state.screen).toBe('calibrating');
    expect(effects).toEqual([{ kind: 'startCalibration', mode: 'simulated' }]);
  });

  it('Recalibrate is ignored when Pause is not open', () => {
    expect(stepSetup(onPlayCamera(), { kind: 'recalibrate' }).state).toEqual(onPlayCamera());
  });

  it('Exit from camera mode disposes the camera, discards calibration and returns to the start screen', () => {
    const paused = run([PAUSE], onPlayCamera()).state;
    const { state, effects } = run([{ kind: 'exit' }], paused);
    expect(state).toEqual(INITIAL_SETUP);
    expect(effects).toEqual([{ kind: 'disposeCamera' }, { kind: 'discardCalibration' }]);
  });

  it('Exit from simulated input discards calibration without touching a camera', () => {
    const paused = run([PAUSE], onPlaySimulated()).state;
    expect(run([{ kind: 'exit' }], paused).effects).toEqual([{ kind: 'discardCalibration' }]);
  });
});

describe('Recover (tracking overlay)', () => {
  const overlay = (): SetupState => run([{ kind: 'overlayShown' }], onPlayCamera()).state;

  it('restarts the camera from the click and keeps the screen', () => {
    const { state, effects } = run([{ kind: 'recover' }], overlay());
    expect(state.screen).toBe('play');
    expect(state.recovering).toBe(true);
    expect(effects).toEqual([{ kind: 'disposeCamera' }, { kind: 'requestCamera' }]);
  });

  it('a ready outcome stays in play, and the overlay stays until the hold ends', () => {
    const recovered = run([{ kind: 'recover' }, READY], overlay()).state;
    expect(recovered.screen).toBe('play');
    expect(recovered.trackingLost).toBe(true);
    expect(recovered.recovering).toBe(false);
    expect(run([{ kind: 'holdEnded' }], recovered).state.trackingLost).toBe(false);
  });

  it('a non-ready outcome goes to the camera error screen with that outcome', () => {
    const { state } = run([{ kind: 'recover' }, { kind: 'cameraOutcome', outcome: 'model-failed' }], overlay());
    expect(state.screen).toBe('cameraError');
    expect(state.failure).toBe('model-failed');
    expect(state.trackingLost).toBe(false);
  });

  it('is ignored without the overlay and in simulated input', () => {
    expect(stepSetup(onPlayCamera(), { kind: 'recover' }).effects).toEqual([]);
    expect(stepSetup(onPlaySimulated(), { kind: 'recover' }).effects).toEqual([]);
  });
});

describe('the whole simulated path', () => {
  it('never produces a requestCamera effect', () => {
    const events: SetupEvent[] = [
      START,
      TRY_WITHOUT,
      CALIBRATED,
      PAUSE,
      { kind: 'recalibrate' },
      { kind: 'wholeScreen' },
      { kind: 'placed', placement: 'sequential' },
      PAUSE,
      { kind: 'exit' },
    ];
    const { effects } = run(events);
    expect(effects.map((effect) => effect.kind)).not.toContain('requestCamera');
    expect(effects).toContainEqual({ kind: 'completeWholeScreen' });
  });
});
