// The setup flow of the input playground (design section 14.1, Req 22, 23). A pure step function: each event
// gives the new state and the effects the component must run. The component runs an effect from the click or
// key handler that caused the event, so the camera is requested only from a click (Req 5.1, 22.2).
// PAUSE and the tracking overlay are flags: they never change the active screen (Req 18.11, 23.3).
import type { PlacementResult } from 'marrow/core';
import type { StartOutcome } from 'marrow/input';
import type { CameraFailure, HandChoice } from 'marrow/react';

export type SetupMode = 'camera' | 'simulated';

export type Screen = 'start' | 'cameraPermission' | 'handChoice' | 'cameraError' | 'calibrating' | 'play' | 'noUsableSlot';

export interface SetupState {
  readonly screen: Screen;
  /** Camera mode, or simulated input. Simulated input never requests the camera (Req 6.10). */
  readonly mode: SetupMode;
  /** The failed outcome shown on the camera error screen, or null. */
  readonly failure: CameraFailure | null;
  /** Pause is open (Req 23.1). A flag: it never changes the screen. */
  readonly paused: boolean;
  /** The "Step back into view" overlay is shown (Req 23.7). A flag: it never changes the screen. */
  readonly trackingLost: boolean;
  /** A Recover is in progress: its camera outcome keeps the screen (Req 23.8). */
  readonly recovering: boolean;
}

export const INITIAL_SETUP: SetupState = {
  screen: 'start',
  mode: 'camera',
  failure: null,
  paused: false,
  trackingLost: false,
  recovering: false,
};

export type SetupEvent =
  | { readonly kind: 'start' }
  /** "Use the camera", or Retry on the camera error screen (Req 22.2, 22.3). */
  | { readonly kind: 'useCamera' }
  /** "Try without camera" on any screen that offers it (Req 22.3, 23.9). */
  | { readonly kind: 'tryWithout' }
  /** The outcome of a camera start, or of a Recover restart (Req 5.2). */
  | { readonly kind: 'cameraOutcome'; readonly outcome: StartOutcome }
  /** Continue on hand choice. HandChoiceScreen has already stored the hand (Req 22.4), so the flow stores nothing. */
  | { readonly kind: 'handChosen'; readonly hand: HandChoice }
  /** The result of Placement, after calibration (Req 26.4) or in a round of play (design section 14.3). */
  | { readonly kind: 'placed'; readonly placement: PlacementResult['kind'] }
  /** "Retry calibration", or Retry during calibration (Req 11.13, 22.8). */
  | { readonly kind: 'retryCalibration' }
  /** "Use the whole screen" (Req 11.15). Ignored in camera mode (Req 11.16). */
  | { readonly kind: 'wholeScreen' }
  /** Escape toggles Pause on every screen after the start screen (Req 23.1). */
  | { readonly kind: 'escape' }
  /** The Pause control opens Pause (Req 23.2). */
  | { readonly kind: 'pauseControl' }
  | { readonly kind: 'resume' }
  /** Recalibrate in Pause (Req 23.5). */
  | { readonly kind: 'recalibrate' }
  /** Exit in Pause or in the tracking overlay (Req 23.6). */
  | { readonly kind: 'exit' }
  /** Recover in the tracking overlay (Req 23.8). */
  | { readonly kind: 'recover' }
  /** The tracking lifecycle shows the overlay (Req 18.4). */
  | { readonly kind: 'overlayShown' }
  /** The tracking hold has ended (Req 18.6): the overlay closes. */
  | { readonly kind: 'holdEnded' };

export type SetupEffect =
  | { readonly kind: 'requestCamera' }
  | { readonly kind: 'disposeCamera' }
  | { readonly kind: 'startCalibration'; readonly mode: SetupMode }
  /** Simulated input only: mark every cell valid and complete calibration at once (Req 11.15). */
  | { readonly kind: 'completeWholeScreen' }
  | { readonly kind: 'discardCalibration' };

export interface SetupStep {
  readonly state: SetupState;
  readonly effects: readonly SetupEffect[];
}

/** The screens that offer "Try without camera" (Req 22.3, 22.8, 23.9). */
const TRY_WITHOUT_SCREENS: readonly Screen[] = ['cameraPermission', 'cameraError', 'calibrating', 'play', 'noUsableSlot'];
const NO_EFFECTS: readonly SetupEffect[] = [];

function unchanged(state: SetupState): SetupStep {
  return { state, effects: NO_EFFECTS };
}

function withEffects(state: SetupState, effects: readonly SetupEffect[]): SetupStep {
  return { state, effects };
}

export function stepSetup(state: SetupState, event: SetupEvent): SetupStep {
  switch (event.kind) {
    case 'start':
      if (state.screen !== 'start') return unchanged(state);
      return unchanged({ ...INITIAL_SETUP, screen: 'cameraPermission' });

    case 'useCamera':
      if (state.mode !== 'camera' || (state.screen !== 'cameraPermission' && state.screen !== 'cameraError')) {
        return unchanged(state);
      }
      return withEffects({ ...state, screen: 'cameraPermission', failure: null }, [{ kind: 'requestCamera' }]);

    case 'tryWithout':
      if (state.mode !== 'camera' || !TRY_WITHOUT_SCREENS.includes(state.screen)) return unchanged(state);
      return withEffects(
        {
          ...state,
          screen: 'calibrating',
          mode: 'simulated',
          failure: null,
          paused: false,
          trackingLost: false,
          recovering: false,
        },
        [{ kind: 'disposeCamera' }, { kind: 'startCalibration', mode: 'simulated' }],
      );

    case 'cameraOutcome':
      if (state.recovering) {
        if (event.outcome === 'ready') return unchanged({ ...state, recovering: false });
        return unchanged({
          ...state,
          recovering: false,
          screen: 'cameraError',
          failure: event.outcome,
          paused: false,
          trackingLost: false,
        });
      }
      if (state.screen !== 'cameraPermission') return unchanged(state);
      if (event.outcome === 'ready') return unchanged({ ...state, screen: 'handChoice' });
      return unchanged({ ...state, screen: 'cameraError', failure: event.outcome });

    case 'handChosen':
      if (state.screen !== 'handChoice') return unchanged(state);
      return withEffects({ ...state, screen: 'calibrating', mode: 'camera' }, [{ kind: 'startCalibration', mode: 'camera' }]);

    case 'placed':
      if (state.screen !== 'calibrating' && state.screen !== 'play') return unchanged(state);
      if (event.placement === 'none') return unchanged({ ...state, screen: 'noUsableSlot' });
      if (state.screen === 'calibrating') return unchanged({ ...state, screen: 'play' });
      return unchanged(state);

    case 'retryCalibration':
      if (state.screen !== 'calibrating' && state.screen !== 'noUsableSlot') return unchanged(state);
      return withEffects({ ...state, screen: 'calibrating' }, [{ kind: 'startCalibration', mode: state.mode }]);

    case 'wholeScreen':
      if (state.mode !== 'simulated' || (state.screen !== 'calibrating' && state.screen !== 'noUsableSlot')) {
        return unchanged(state);
      }
      return withEffects({ ...state, screen: 'calibrating' }, [{ kind: 'completeWholeScreen' }]);

    case 'escape':
      if (state.screen === 'start') return unchanged(state);
      return unchanged({ ...state, paused: !state.paused });

    case 'pauseControl':
      if (state.screen === 'start') return unchanged(state);
      return unchanged({ ...state, paused: true });

    case 'resume':
      return unchanged({ ...state, paused: false });

    case 'recalibrate':
      if (!state.paused) return unchanged(state);
      // Camera mode keeps the camera running and goes to hand choice (Req 23.5, design section 14.1).
      if (state.mode === 'camera') return unchanged({ ...state, screen: 'handChoice', paused: false });
      return withEffects({ ...state, screen: 'calibrating', paused: false }, [{ kind: 'startCalibration', mode: 'simulated' }]);

    case 'exit': {
      if (state.screen === 'start') return unchanged(state);
      const camera: SetupEffect[] = state.mode === 'camera' ? [{ kind: 'disposeCamera' }] : [];
      return withEffects(INITIAL_SETUP, [...camera, { kind: 'discardCalibration' }]);
    }

    case 'recover':
      if (state.mode !== 'camera' || !state.trackingLost) return unchanged(state);
      return withEffects({ ...state, recovering: true }, [{ kind: 'disposeCamera' }, { kind: 'requestCamera' }]);

    case 'overlayShown':
      if (state.screen !== 'play' || state.mode !== 'camera') return unchanged(state);
      return unchanged({ ...state, trackingLost: true });

    case 'holdEnded':
      return unchanged({ ...state, trackingLost: false });
  }
}
