// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as react from './index';
import { SettingsProvider, useSettings } from './settingsProvider';
import { createSettingsStore, type SettingsStore } from './settingsStore';

// Requirement 20.8: every subscriber is told about a change before the next animation frame. The
// store notifies inside update(), so a listener sees the new value during the event that made it.

const PREFIX = 'provider-test:';

function makeStore(): SettingsStore {
  return createSettingsStore({ prefix: PREFIX, storage: null, prefersReducedMotion: false });
}

/** Shows the motion level and changes it to Reduced when its button is pressed. */
function Probe({ renders }: { renders: string[] }) {
  const { settings, update } = useSettings();
  renders.push(settings.motion);
  return (
    <>
      <p>{`Probe motion is ${settings.motion}`}</p>
      <button type="button" onClick={() => update({ motion: 'reduced' })}>
        {'Probe set reduced'}
      </button>
      <button type="button" onClick={() => update({})}>
        {'Probe change nothing'}
      </button>
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SettingsProvider and useSettings', () => {
  it('gives the components the store settings, and changes them through the store', () => {
    const store = makeStore();
    render(
      <SettingsProvider store={store}>
        <Probe renders={[]} />
      </SettingsProvider>,
    );
    expect(screen.getByText('Probe motion is full')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Probe set reduced' }));
    expect(store.get().motion).toBe('reduced');
    expect(screen.getByText('Probe motion is reduced')).toBeInTheDocument();
  });

  it('tells the subscribers of the store during the event that made the change', () => {
    const store = makeStore();
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.get().motion));
    render(
      <SettingsProvider store={store}>
        <Probe renders={[]} />
      </SettingsProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Probe set reduced' }));
    expect(seen).toEqual(['reduced']);
  });

  it('renders again only when a setting changes', () => {
    const store = makeStore();
    const renders: string[] = [];
    render(
      <SettingsProvider store={store}>
        <Probe renders={renders} />
      </SettingsProvider>,
    );
    const before = renders.length;
    fireEvent.click(screen.getByRole('button', { name: 'Probe change nothing' }));
    expect(renders).toHaveLength(before);
    fireEvent.click(screen.getByRole('button', { name: 'Probe set reduced' }));
    expect(renders.length).toBeGreaterThan(before);
    expect(renders.at(-1)).toBe('reduced');
  });

  it('throws, with a message, when a component asks for the settings without a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe renders={[]} />)).toThrow('useSettings must be used inside a SettingsProvider.');
  });

  it('is exported from marrow/react', () => {
    expect(react.SettingsProvider).toBe(SettingsProvider);
    expect(react.useSettings).toBe(useSettings);
  });
});
