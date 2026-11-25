// The camera setup screens (garden-level requirements 3.4; design 7.1, gap G8). The permission screen and the hand choice are
// the marrow/react components, with their text from gardenMarrowCopy. The component requests nothing: "Use the camera" is
// a callback, and the app requests the camera from it (Req 3.2).
import type { ReactElement } from 'react';
import { CameraPermissionScreen, HandChoiceScreen, MarrowCopyProvider, SettingsProvider, type SettingsStore } from 'marrow/react';
import { gardenMarrowCopy } from '../copy/gardenMarrowCopy';
import { ThemeProvider } from './themeProvider';

export interface SetupProps {
  readonly screen: 'cameraPermission' | 'handChoice';
  /** The settings store the marrow/react controls read (the hand choice stores the hand in it). */
  readonly settings: SettingsStore;
  readonly onUseCamera: () => void;
  readonly onTryWithout: () => void;
  readonly onHandChosen: () => void;
}

export function Setup({ screen, settings, onUseCamera, onTryWithout, onHandChosen }: SetupProps): ReactElement {
  return (
    <ThemeProvider>
      <MarrowCopyProvider value={gardenMarrowCopy}>
        <SettingsProvider store={settings}>
          <div className="garden-setup">
            {screen === 'cameraPermission' ? (
              <CameraPermissionScreen failure={null} onStartCamera={onUseCamera} onTryWithout={onTryWithout} />
            ) : (
              <HandChoiceScreen onContinue={onHandChosen} />
            )}
          </div>
        </SettingsProvider>
      </MarrowCopyProvider>
    </ThemeProvider>
  );
}
