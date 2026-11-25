// The setup flow of the app (garden-level requirements 3.1 to 3.4; design 2.11). A pure step function: each event gives the
// new state and the effects to run. The only effect is the camera request, which the component runs from the click that
// caused it, so the camera is never requested on render and never before Start (Req 3.2). Pure code: no React, no DOM.
//
// A camera that is denied, or missing, enters simulated input at once (Req 3.3). Camera play is not built in this task,
// so a granted camera also ends in simulated input after the hand choice. Simulated input shows its label on the stage.

/** The camera failures the setup can report (the marrow/react type of a failed camera start). */
export type CameraFailure = 'denied' | 'no-camera' | 'model-failed';

/** The outcome of a camera request: ready, or a failure. */
export type CameraOutcome = 'ready' | CameraFailure;

export type SetupScreen = 'home' | 'cameraPermission' | 'handChoice' | 'simulated' | 'noUsableSlot';

export interface SetupState {
  readonly screen: SetupScreen;
  /** The last camera failure, kept for the record. It never changes the screen by itself. */
  readonly failure: CameraFailure | null;
}

export const INITIAL_SETUP: SetupState = { screen: 'home', failure: null };

export type SetupEvent =
  /** "Start" on Home (Req 3.1). */
  | { readonly kind: 'start' }
  /** "Use the camera" on the permission screen. The camera is requested from this click (Req 3.2). */
  | { readonly kind: 'useCamera' }
  /** "Try without camera" on any screen that offers it (Req 3.3). */
  | { readonly kind: 'tryWithout' }
  /** The result of a camera request. */
  | { readonly kind: 'cameraOutcome'; readonly outcome: CameraOutcome }
  /** Continue on the hand choice. The hand is stored by marrow/react, so the flow stores nothing. */
  | { readonly kind: 'handChosen' }
  /** A stage placed no target: no usable slot (Req 10.6). */
  | { readonly kind: 'noSlot' }
  /** "Retry calibration" on the no-usable-slot screen (Req 10.6). Simulated input has no calibration of its own, so
   *  retry starts the stage again. */
  | { readonly kind: 'retryCalibration' };

export type SetupEffect = { readonly kind: 'requestCamera' };

export interface SetupStep {
  readonly state: SetupState;
  readonly effects: readonly SetupEffect[];
}

const NO_EFFECTS: readonly SetupEffect[] = [];

function unchanged(state: SetupState): SetupStep {
  return { state, effects: NO_EFFECTS };
}

/** The next state of the setup flow for one event. An event that does not apply to the current screen changes nothing. */
export function stepSetup(state: SetupState, event: SetupEvent): SetupStep {
  switch (event.kind) {
    case 'start':
      return state.screen === 'home' ? unchanged({ ...state, screen: 'cameraPermission' }) : unchanged(state);

    case 'useCamera':
      if (state.screen !== 'cameraPermission') return unchanged(state);
      return { state: { ...state, failure: null }, effects: [{ kind: 'requestCamera' }] };

    case 'tryWithout':
      if (state.screen === 'simulated') return unchanged(state);
      return unchanged({ ...state, screen: 'simulated' });

    case 'cameraOutcome':
      if (state.screen !== 'cameraPermission') return unchanged(state);
      if (event.outcome === 'ready') return unchanged({ ...state, screen: 'handChoice' });
      return unchanged({ ...state, screen: 'simulated', failure: event.outcome });

    case 'handChosen':
      return state.screen === 'handChoice' ? unchanged({ ...state, screen: 'simulated' }) : unchanged(state);

    case 'noSlot':
      return state.screen === 'simulated' ? unchanged({ ...state, screen: 'noUsableSlot' }) : unchanged(state);

    case 'retryCalibration':
      return state.screen === 'noUsableSlot' ? unchanged({ ...state, screen: 'simulated' }) : unchanged(state);
  }
}
