// The Pause screen (garden-level requirements 17.5, 18.6, 24.1, 24.4, 24.5). It offers resume, recalibrate, the motion
// setting, the sound setting, "Continue with help", restart and exit. Every control is a real DOM element with a focus
// ring and an accessible name. The motion and sound controls are marrow/react's, and they write the app's settings store.
// Restart needs no confirmation, because no progress is saved in this spec (Req 24.5). Focus moves to Resume when the
// screen opens. The screen holds no game state: its callbacks are the stage's.
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';
import { AudioSettings, MarrowCopyProvider, MotionSetting, SettingsProvider, useMarrowCopy, type SettingsStore } from 'marrow/react';
import { GARDEN_COPY } from '../copy/garden';
import { gardenMarrowCopy } from '../copy/gardenMarrowCopy';
import { ThemeProvider } from './themeProvider';

export interface PauseScreenProps {
  /** The settings store the motion and sound controls write to. */
  readonly settings: SettingsStore;
  readonly onResume: () => void;
  /** "Continue with help" (Req 24.4): the stage unpauses and reveals the next step (Req 7.5). */
  readonly onContinueHelp: () => void;
  readonly onRecalibrate: () => void;
  readonly onRestart: () => void;
  readonly onExit: () => void;
}

export function PauseScreen(props: PauseScreenProps): ReactElement {
  return (
    <ThemeProvider>
      <MarrowCopyProvider value={gardenMarrowCopy}>
        <SettingsProvider store={props.settings}>
          <PauseMenu {...props} />
        </SettingsProvider>
      </MarrowCopyProvider>
    </ThemeProvider>
  );
}

/** The controls a Tab can reach inside the dialog, in order. Native radio buttons are reached with the arrow keys, as usual. */
const TAB_STOPS = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab and Shift+Tab inside the dialog (aria-modal). Without it, the focus would leave the screen after its last
 * control and reach the page behind it, where a keyboard player could not see the screen.
 */
export function keepFocusInside(event: ReactKeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return;
  const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(TAB_STOPS));
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function PauseMenu({ onResume, onContinueHelp, onRecalibrate, onRestart, onExit }: PauseScreenProps): ReactElement {
  const copy = useMarrowCopy();
  const resume = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    resume.current?.focus();
  }, []);
  return (
    <div className="garden-overlay" role="dialog" aria-modal="true" aria-label={copy.pause.pause} onKeyDown={keepFocusInside}>
      <div className="garden-panel">
        <h2 className="garden-panel__title">{copy.pause.pause}</h2>
        <button ref={resume} type="button" className="garden-button" onClick={onResume}>
          {GARDEN_COPY.pause.resume}
        </button>
        <button type="button" className="garden-button" onClick={onRecalibrate}>
          {GARDEN_COPY.pause.recalibrate}
        </button>
        <MotionSetting />
        <AudioSettings />
        <button type="button" className="garden-button" onClick={onContinueHelp}>
          {GARDEN_COPY.pause.help}
        </button>
        <button type="button" className="garden-button" onClick={onRestart}>
          {GARDEN_COPY.pause.restart}
        </button>
        <button type="button" className="garden-button" onClick={onExit}>
          {GARDEN_COPY.pause.exit}
        </button>
      </div>
    </div>
  );
}
