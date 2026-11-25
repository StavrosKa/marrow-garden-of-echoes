// @vitest-environment jsdom
// The controls of the stage's Pause screen (garden-level requirement 24.1 and 24.4). Each control is a DOM element with an
// accessible name, a focus ring, and a keyboard action. The setting controls write to the store, and the callbacks fire once.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createSettingsStore, type SettingsStore } from 'marrow/react';
import { describe, expect, it, vi } from 'vitest';
import { GARDEN_COPY } from '../copy/garden';
import { PauseScreen, type PauseScreenProps } from './PauseScreen';

function store(): SettingsStore {
  return createSettingsStore({ prefix: 'test.', storage: null, prefersReducedMotion: false });
}

function renderPause(settings: SettingsStore = store()) {
  const handlers = {
    onResume: vi.fn(),
    onContinueHelp: vi.fn(),
    onRecalibrate: vi.fn(),
    onRestart: vi.fn(),
    onExit: vi.fn(),
  } satisfies Omit<PauseScreenProps, 'settings'>;
  render(<PauseScreen settings={settings} {...handlers} />);
  return { handlers, settings };
}

describe('the Pause controls (requirements 24.1, 24.4)', () => {
  it('24.1: every button is a DOM button with the garden button class, whose focus ring setupCss.test.ts checks', () => {
    renderPause();
    for (const name of [
      GARDEN_COPY.pause.resume,
      GARDEN_COPY.pause.recalibrate,
      GARDEN_COPY.pause.help,
      GARDEN_COPY.pause.restart,
      GARDEN_COPY.pause.exit,
    ]) {
      expect(screen.getByRole('button', { name }).classList.contains('garden-button')).toBe(true);
    }
  });

  it('24.1: each button calls its own callback once when clicked', async () => {
    const user = userEvent.setup();
    const { handlers } = renderPause();
    await user.click(screen.getByRole('button', { name: GARDEN_COPY.pause.resume }));
    await user.click(screen.getByRole('button', { name: GARDEN_COPY.pause.recalibrate }));
    await user.click(screen.getByRole('button', { name: GARDEN_COPY.pause.help }));
    await user.click(screen.getByRole('button', { name: GARDEN_COPY.pause.restart }));
    await user.click(screen.getByRole('button', { name: GARDEN_COPY.pause.exit }));
    expect(handlers.onResume).toHaveBeenCalledTimes(1);
    expect(handlers.onRecalibrate).toHaveBeenCalledTimes(1);
    expect(handlers.onContinueHelp).toHaveBeenCalledTimes(1);
    expect(handlers.onRestart).toHaveBeenCalledTimes(1);
    expect(handlers.onExit).toHaveBeenCalledTimes(1);
  });

  it('24.1: Tab from the last control returns to the first, and Shift+Tab goes back, so the focus stays in the dialog', async () => {
    const user = userEvent.setup();
    renderPause();
    const resume = screen.getByRole('button', { name: GARDEN_COPY.pause.resume });
    const exit = screen.getByRole('button', { name: GARDEN_COPY.pause.exit });
    exit.focus();
    await user.tab();
    expect(document.activeElement).toBe(resume);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(exit);
  });

  it('24.4: "Continue with help" from Pause calls onContinueHelp and nothing else', async () => {
    const user = userEvent.setup();
    const { handlers } = renderPause();
    await user.click(screen.getByRole('button', { name: GARDEN_COPY.pause.help }));
    expect(handlers.onContinueHelp).toHaveBeenCalledTimes(1);
    expect(handlers.onResume).not.toHaveBeenCalled();
  });

  it('24.1: Enter on the focused Restart button restarts, and Space on Exit exits', async () => {
    const user = userEvent.setup();
    const { handlers } = renderPause();
    screen.getByRole('button', { name: GARDEN_COPY.pause.restart }).focus();
    await user.keyboard('{Enter}');
    expect(handlers.onRestart).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: GARDEN_COPY.pause.exit }).focus();
    await user.keyboard(' ');
    expect(handlers.onExit).toHaveBeenCalledTimes(1);
  });

  it('24.5: restart is not confirmed, so window.confirm is never asked', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    const { handlers } = renderPause();
    await user.click(screen.getByRole('button', { name: GARDEN_COPY.pause.restart }));
    expect(confirm).not.toHaveBeenCalled();
    expect(handlers.onRestart).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it('17.4 18.6: choosing Gentle writes the motion setting to the store, and Mute writes the sound setting', async () => {
    const user = userEvent.setup();
    const settings = store();
    renderPause(settings);
    await user.click(screen.getByRole('radio', { name: 'Gentle' }));
    expect(settings.get().motion).toBe('gentle');
    await user.click(screen.getByRole('checkbox', { name: 'Mute' }));
    expect(settings.get().mute).toBe(true);
  });
});
