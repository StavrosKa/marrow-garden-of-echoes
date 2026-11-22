// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SETTINGS_VERSION, TUNING } from '../core';
import * as react from './index';
import { FIXTURE_COPY } from './copyFixture';
import { MarrowCopyProvider } from './marrowCopy';
import { AudioSettings, MotionSetting, SimulatedInputLabel } from './settingsControls';
import { SettingsProvider } from './settingsProvider';
import { createSettingsStore, SETTINGS_KEY_NAME, type SettingsStorage, type SettingsStore } from './settingsStore';
import type { ReactNode } from 'react';

// Requirements 6.10, 20.8, 20.10, 22.9, 24.1: each control works by pointer and by keyboard, and every
// name and piece of text comes from the copy. The storage is a fake, so the stored choice can be read.

const PREFIX = 'controls-test:';
const STORED_KEY = `${PREFIX}${SETTINGS_KEY_NAME}`;

/** A storage that keeps what it is given, and reports every write. */
class MemoryStorage implements SettingsStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function makeStore(prefersReducedMotion = false, storage: SettingsStorage | null = new MemoryStorage()): SettingsStore {
  return createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion });
}

/** The copy and the settings a control needs, around it. */
function Harness({ store, children }: { store: SettingsStore; children: ReactNode }) {
  return (
    <MarrowCopyProvider value={FIXTURE_COPY}>
      <SettingsProvider store={store}>{children}</SettingsProvider>
    </MarrowCopyProvider>
  );
}

describe('MotionSetting', () => {
  it('is a group named by its legend, with three radios named from the copy', () => {
    render(
      <Harness store={makeStore()}>
        <MotionSetting />
      </Harness>,
    );
    expect(screen.getByRole('group', { name: FIXTURE_COPY.settings.motion })).toBeInTheDocument();
    for (const label of [FIXTURE_COPY.settings.full, FIXTURE_COPY.settings.gentle, FIXTURE_COPY.settings.reduced]) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  it('shows the stored choice, and the browser preference when nothing is stored', () => {
    const { unmount } = render(
      <Harness store={makeStore(false)}>
        <MotionSetting />
      </Harness>,
    );
    expect(screen.getByRole('radio', { name: FIXTURE_COPY.settings.full })).toBeChecked();
    unmount();

    render(
      <Harness store={makeStore(true)}>
        <MotionSetting />
      </Harness>,
    );
    expect(screen.getByRole('radio', { name: FIXTURE_COPY.settings.reduced })).toBeChecked();
  });

  it('stores a pointer choice, and the store and the storage both hold it', async () => {
    const storage = new MemoryStorage();
    const store = makeStore(false, storage);
    const user = userEvent.setup();
    render(
      <Harness store={store}>
        <MotionSetting />
      </Harness>,
    );
    await user.click(screen.getByRole('radio', { name: FIXTURE_COPY.settings.reduced }));
    expect(store.get().motion).toBe('reduced');
    expect(screen.getByRole('radio', { name: FIXTURE_COPY.settings.reduced })).toBeChecked();
    expect(JSON.parse(storage.data.get(STORED_KEY) ?? 'null')).toMatchObject({
      version: SETTINGS_VERSION,
      motion: 'reduced',
    });
  });

  it('moves the choice with the arrow keys and selects with the space bar', async () => {
    const store = makeStore(false);
    const user = userEvent.setup();
    render(
      <Harness store={store}>
        <MotionSetting />
      </Harness>,
    );
    screen.getByRole('radio', { name: FIXTURE_COPY.settings.full }).focus();
    await user.keyboard('{ArrowDown}');
    expect(store.get().motion).toBe('gentle');
    await user.keyboard('{ArrowDown}');
    expect(store.get().motion).toBe('reduced');
    screen.getByRole('radio', { name: FIXTURE_COPY.settings.full }).focus();
    await user.keyboard(' ');
    expect(store.get().motion).toBe('full');
  });

  it('shows a choice made in the store by another part of the page', () => {
    const store = makeStore(false);
    render(
      <Harness store={store}>
        <MotionSetting />
      </Harness>,
    );
    fireEvent.click(screen.getByRole('radio', { name: FIXTURE_COPY.settings.gentle }));
    expect(screen.getByRole('radio', { name: FIXTURE_COPY.settings.gentle })).toBeChecked();
    expect(screen.getByRole('radio', { name: FIXTURE_COPY.settings.full })).not.toBeChecked();
  });

  it('holds no text of its own: its text is the copy only', () => {
    const { container } = render(
      <Harness store={makeStore(false)}>
        <MotionSetting />
      </Harness>,
    );
    expect(container.textContent).toBe(
      [FIXTURE_COPY.settings.motion, FIXTURE_COPY.settings.full, FIXTURE_COPY.settings.gentle, FIXTURE_COPY.settings.reduced].join(''),
    );
  });
});

describe('AudioSettings', () => {
  it('is a group named by its legend, with a mute checkbox and a volume range named from the copy', () => {
    render(
      <Harness store={makeStore()}>
        <AudioSettings />
      </Harness>,
    );
    expect(screen.getByRole('group', { name: FIXTURE_COPY.settings.sound })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: FIXTURE_COPY.settings.mute })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: FIXTURE_COPY.settings.volume })).toBeInTheDocument();
  });

  it('shows the stored mute and volume, and the default volume when nothing is chosen', () => {
    render(
      <Harness store={makeStore()}>
        <AudioSettings />
      </Harness>,
    );
    expect(screen.getByRole('checkbox', { name: FIXTURE_COPY.settings.mute })).not.toBeChecked();
    expect(screen.getByRole('slider', { name: FIXTURE_COPY.settings.volume })).toHaveValue(String(TUNING.defaultVolume));
  });

  it('toggles mute with the mouse and with the space bar, and stores it', async () => {
    const store = makeStore();
    const user = userEvent.setup();
    render(
      <Harness store={store}>
        <AudioSettings />
      </Harness>,
    );
    const mute = screen.getByRole('checkbox', { name: FIXTURE_COPY.settings.mute });
    await user.click(mute);
    expect(store.get().mute).toBe(true);
    expect(mute).toBeChecked();
    mute.focus();
    await user.keyboard(' ');
    expect(store.get().mute).toBe(false);
    expect(mute).not.toBeChecked();
  });

  it('reaches the volume range by the keyboard and stores the value it is given', async () => {
    const store = makeStore();
    const user = userEvent.setup();
    render(
      <Harness store={store}>
        <AudioSettings />
      </Harness>,
    );
    await user.tab();
    expect(screen.getByRole('checkbox', { name: FIXTURE_COPY.settings.mute })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('slider', { name: FIXTURE_COPY.settings.volume })).toHaveFocus();
    // user-event does not step a range with the arrow keys. A browser sends this change event after an arrow key.
    fireEvent.change(screen.getByRole('slider', { name: FIXTURE_COPY.settings.volume }), { target: { value: '0.3' } });
    expect(store.get().volume).toBe(0.3);
    expect(screen.getByRole('slider', { name: FIXTURE_COPY.settings.volume })).toHaveValue('0.3');
  });

  it('holds no text of its own: its text is the copy only', () => {
    const { container } = render(
      <Harness store={makeStore()}>
        <AudioSettings />
      </Harness>,
    );
    expect(container.textContent).toBe(
      [FIXTURE_COPY.settings.sound, FIXTURE_COPY.settings.mute, FIXTURE_COPY.settings.volume].join(''),
    );
  });
});

describe('SimulatedInputLabel', () => {
  it('shows the simulated input text from the copy', () => {
    render(
      <Harness store={makeStore()}>
        <SimulatedInputLabel />
      </Harness>,
    );
    expect(screen.getByText(FIXTURE_COPY.simulatedInputLabel)).toBeInTheDocument();
  });
});

describe('the barrel', () => {
  it('exports the three controls from marrow/react', () => {
    expect(react.MotionSetting).toBe(MotionSetting);
    expect(react.AudioSettings).toBe(AudioSettings);
    expect(react.SimulatedInputLabel).toBe(SimulatedInputLabel);
  });
});
