// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as react from './index';
import { FIXTURE_COPY } from './copyFixture';
import { CameraPermissionScreen, type CameraFailure } from './cameraPermissionScreen';
import { HandChoiceScreen } from './handChoiceScreen';
import { MarrowCopyProvider } from './marrowCopy';
import { SettingsProvider } from './settingsProvider';
import { createSettingsStore, SETTINGS_KEY_NAME, type SettingsStorage, type SettingsStore } from './settingsStore';
import { StartScreen } from './startScreen';
// Requirements 5.1, 21.1, 22.1 to 22.4, 24.1: the setup screens are real buttons and radios, every
// name and sentence comes from the copy, and each callback fires from the click and from the keyboard.
// The storage is a fake, so a stored hand choice can be read.
const PREFIX = 'setup-test:';
const STORED_KEY = `${PREFIX}${SETTINGS_KEY_NAME}`;
class MemoryStorage implements SettingsStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}
function makeStore(storage: SettingsStorage | null = new MemoryStorage()): SettingsStore {
  return createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: false });
}
function Harness({ store, children }: { store: SettingsStore; children: ReactNode }) {
  return (
    <MarrowCopyProvider value={FIXTURE_COPY}>
      <SettingsProvider store={store}>{children}</SettingsProvider>
    </MarrowCopyProvider>
  );
}
describe('StartScreen', () => {
  it('shows the title as the instruction and a primary Start control named from the copy', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(
      <MarrowCopyProvider value={FIXTURE_COPY}>
        <StartScreen onStart={onStart} />
      </MarrowCopyProvider>,
    );
    expect(screen.getByText(FIXTURE_COPY.start.title)).toHaveAttribute('aria-live', 'polite');
    await user.click(screen.getByRole('button', { name: FIXTURE_COPY.start.start }));
    expect(onStart).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: FIXTURE_COPY.start.start }).focus();
    await user.keyboard('{Enter}');
    expect(onStart).toHaveBeenCalledTimes(2);
  });
});
describe('CameraPermissionScreen, before any start', () => {
  it('shows the explanation and the two controls, and does not ask for the camera by itself', async () => {
    const onStartCamera = vi.fn();
    const onTryWithout = vi.fn();
    const user = userEvent.setup();
    render(
      <MarrowCopyProvider value={FIXTURE_COPY}>
        <CameraPermissionScreen failure={null} onStartCamera={onStartCamera} onTryWithout={onTryWithout} />
      </MarrowCopyProvider>,
    );
    expect(screen.getByText(FIXTURE_COPY.camera.explanation)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: FIXTURE_COPY.camera.retry })).not.toBeInTheDocument();
    expect(onStartCamera).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: FIXTURE_COPY.camera.useCamera }));
    expect(onStartCamera).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: FIXTURE_COPY.camera.tryWithout }));
    expect(onTryWithout).toHaveBeenCalledTimes(1);
  });
});
/** The copy key of each failed outcome's own message (Requirement 22.3). */
const FAILURE_MESSAGE: Record<CameraFailure, keyof typeof FIXTURE_COPY.camera> = {
  denied: 'deniedMessage',
  'no-camera': 'noCameraMessage',
  'model-failed': 'modelFailedMessage',
};
describe.each(['denied', 'no-camera', 'model-failed'] as const)('CameraPermissionScreen, outcome %s', (failure) => {
  it('shows its own calm message with Retry and "Try without camera"', () => {
    render(
      <MarrowCopyProvider value={FIXTURE_COPY}>
        <CameraPermissionScreen failure={failure} onStartCamera={() => undefined} onTryWithout={() => undefined} />
      </MarrowCopyProvider>,
    );
    expect(screen.getByText(FIXTURE_COPY.camera[FAILURE_MESSAGE[failure]])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: FIXTURE_COPY.camera.retry })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: FIXTURE_COPY.camera.tryWithout })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: FIXTURE_COPY.camera.useCamera })).not.toBeInTheDocument();
  });
  it('calls the start callback from Retry by the mouse and by the keyboard, and the other control separately', async () => {
    const onStartCamera = vi.fn();
    const onTryWithout = vi.fn();
    const user = userEvent.setup();
    render(
      <MarrowCopyProvider value={FIXTURE_COPY}>
        <CameraPermissionScreen failure={failure} onStartCamera={onStartCamera} onTryWithout={onTryWithout} />
      </MarrowCopyProvider>,
    );
    await user.click(screen.getByRole('button', { name: FIXTURE_COPY.camera.retry }));
    expect(onStartCamera).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: FIXTURE_COPY.camera.tryWithout }).focus();
    await user.keyboard(' ');
    expect(onTryWithout).toHaveBeenCalledTimes(1);
    expect(onStartCamera).toHaveBeenCalledTimes(1);
  });
});
describe('HandChoiceScreen', () => {
  it('selects nothing and disables Continue when no choice is stored', () => {
    render(
      <Harness store={makeStore()}>
        <HandChoiceScreen onContinue={() => undefined} />
      </Harness>,
    );
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(screen.getByRole('button', { name: FIXTURE_COPY.hands.continue })).toBeDisabled();
  });
  it('pre-selects the stored choice and leaves Continue enabled', () => {
    const store = makeStore();
    store.update({ hands: 'left' });
    render(
      <Harness store={store}>
        <HandChoiceScreen onContinue={() => undefined} />
      </Harness>,
    );
    expect(screen.getByRole('radio', { name: FIXTURE_COPY.hands.left })).toBeChecked();
    expect(screen.getByRole('button', { name: FIXTURE_COPY.hands.continue })).toBeEnabled();
  });
  it('shows the question as the group name and the three choices from the copy', () => {
    render(
      <Harness store={makeStore()}>
        <HandChoiceScreen onContinue={() => undefined} />
      </Harness>,
    );
    expect(screen.getByRole('group', { name: FIXTURE_COPY.hands.question })).toBeInTheDocument();
    for (const label of [FIXTURE_COPY.hands.right, FIXTURE_COPY.hands.left, FIXTURE_COPY.hands.both]) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });
  it('stores nothing when a radio is picked, and stores and reports the choice when Continue is pressed', async () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage);
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness store={store}>
        <HandChoiceScreen onContinue={onContinue} />
      </Harness>,
    );
    await user.click(screen.getByRole('radio', { name: FIXTURE_COPY.hands.both }));
    expect(screen.getByRole('button', { name: FIXTURE_COPY.hands.continue })).toBeEnabled();
    expect(store.get().hands).toBeNull();
    expect(storage.data.has(STORED_KEY)).toBe(false);
    await user.click(screen.getByRole('button', { name: FIXTURE_COPY.hands.continue }));
    expect(store.get().hands).toBe('both');
    expect(JSON.parse(storage.data.get(STORED_KEY) ?? 'null')).toMatchObject({ hands: 'both' });
    expect(onContinue).toHaveBeenCalledWith('both');
  });
  it('moves the choice with the arrow keys and continues with the keyboard', async () => {
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness store={makeStore()}>
        <HandChoiceScreen onContinue={onContinue} />
      </Harness>,
    );
    screen.getByRole('radio', { name: FIXTURE_COPY.hands.right }).focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: FIXTURE_COPY.hands.left })).toBeChecked();
    screen.getByRole('button', { name: FIXTURE_COPY.hands.continue }).focus();
    await user.keyboard('{Enter}');
    expect(onContinue).toHaveBeenCalledWith('left');
  });
});
describe('the barrel', () => {
  it('exports the four setup components from marrow/react', () => {
    expect(react.StartScreen).toBe(StartScreen);
    expect(react.CameraPermissionScreen).toBe(CameraPermissionScreen);
    expect(react.HandChoiceScreen).toBe(HandChoiceScreen);
    expect(typeof react.CameraPreview).toBe('function');
  });
});
