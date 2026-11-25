// @vitest-environment jsdom
// The Pause screen (garden-level requirements 17.5, 24.1, 24.4, 24.5). The screen is a dialog, focus starts on Resume, and
// every line of it comes from the copy.
import { render, screen } from '@testing-library/react';
import { createSettingsStore, type SettingsStore } from 'marrow/react';
import { describe, expect, it, vi } from 'vitest';
import { GARDEN_COPY } from '../copy/garden';
import { PauseScreen, type PauseScreenProps } from './PauseScreen';

function settingsStore(): SettingsStore {
  return createSettingsStore({ prefix: 'test.', storage: null, prefersReducedMotion: false });
}

function callbacks(): Omit<PauseScreenProps, 'settings'> {
  return {
    onResume: vi.fn(),
    onContinueHelp: vi.fn(),
    onRecalibrate: vi.fn(),
    onRestart: vi.fn(),
    onExit: vi.fn(),
  };
}

describe('PauseScreen (requirements 17.5, 24.1, 24.4, 24.5)', () => {
  it('24.1: is a dialog named Pause', () => {
    render(<PauseScreen settings={settingsStore()} {...callbacks()} />);
    expect(screen.getByRole('dialog', { name: 'Pause' })).toBeTruthy();
  });

  it('24.1: focus moves to Resume when the screen opens', () => {
    render(<PauseScreen settings={settingsStore()} {...callbacks()} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: GARDEN_COPY.pause.resume }));
  });

  it('24.4: offers resume, recalibrate, continue with help, restart and exit by their copy keys', () => {
    render(<PauseScreen settings={settingsStore()} {...callbacks()} />);
    for (const text of [
      GARDEN_COPY.pause.resume,
      GARDEN_COPY.pause.recalibrate,
      GARDEN_COPY.pause.help,
      GARDEN_COPY.pause.restart,
      GARDEN_COPY.pause.exit,
    ]) {
      expect(screen.getByRole('button', { name: text }).tagName).toBe('BUTTON');
    }
  });

  it('17.5 18.6: offers the motion setting and the sound setting', () => {
    render(<PauseScreen settings={settingsStore()} {...callbacks()} />);
    expect(screen.getByRole('group', { name: GARDEN_COPY.pause.motion })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Full' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Gentle' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Reduced' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Mute' })).toBeTruthy();
  });

});
