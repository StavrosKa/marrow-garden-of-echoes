// The app without a ?start value (garden-level requirements 3, 20). It shows Home, runs the setup flow, and enters the
// first stage in simulated input. The camera is requested only by the effect of "Use the camera", which runs from that
// click. A ?start value never reaches this file: main.tsx routes it to GardenStage (Req 20.2).
import { useRef, useState, type ReactElement } from 'react';
import { createSettingsStore } from 'marrow/react';
import { INITIAL_SETUP, stepSetup, type SetupEffect, type SetupEvent, type SetupState } from '../session/setupState';
import type { StageId } from '../session/stageOrder';
import { requestCameraAccess } from './cameraAccess';
import { GardenStage } from './GardenStage';
import { Home } from './Home';
import { NoUsableSlot } from './NoUsableSlot';
import { Setup } from './Setup';
import { ThemeProvider } from './themeProvider';

/** The prefix of the settings this app keeps. Not player-facing text. */
const SETTINGS_PREFIX = 'garden-of-echoes.';
/** The stage that simulated input starts in: the first stage of the route. */
const FIRST_STAGE: StageId = 'lantern-glade';
const REDUCED_QUERY = '(prefers-reduced-motion:reduce)';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_QUERY).matches;
}

export function App(): ReactElement {
  const [state, setState] = useState<SetupState>(INITIAL_SETUP);
  const latest = useRef<SetupState>(INITIAL_SETUP);
  const [settings] = useState(() => createSettingsStore({ prefix: SETTINGS_PREFIX, prefersReducedMotion: prefersReducedMotion() }));

  /** Applies one event: the state moves on, and each effect runs. The latest state is kept in a ref, for the async camera result. */
  function send(event: SetupEvent): void {
    const step = stepSetup(latest.current, event);
    latest.current = step.state;
    setState(step.state);
    for (const effect of step.effects) run(effect);
  }

  function run(effect: SetupEffect): void {
    if (effect.kind === 'requestCamera') {
      void requestCameraAccess().then((outcome) => send({ kind: 'cameraOutcome', outcome }));
    }
  }

  if (state.screen === 'home') {
    return (
      <ThemeProvider>
        <Home onStart={() => send({ kind: 'start' })} onTryWithout={() => send({ kind: 'tryWithout' })} />
      </ThemeProvider>
    );
  }
  if (state.screen === 'simulated') {
    return (
      <ThemeProvider>
        <GardenStage stage={FIRST_STAGE} onNoSlot={() => send({ kind: 'noSlot' })} />
      </ThemeProvider>
    );
  }
  if (state.screen === 'noUsableSlot') {
    return (
      <ThemeProvider>
        <NoUsableSlot onRetry={() => send({ kind: 'retryCalibration' })} onTryWithout={() => send({ kind: 'tryWithout' })} />
      </ThemeProvider>
    );
  }
  return (
    <Setup
      screen={state.screen}
      settings={settings}
      onUseCamera={() => send({ kind: 'useCamera' })}
      onTryWithout={() => send({ kind: 'tryWithout' })}
      onHandChosen={() => send({ kind: 'handChosen' })}
    />
  );
}
