// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as react from './index';
import { FIXTURE_COPY } from './copyFixture';
import { MarrowCopyProvider } from './marrowCopy';
import { PauseOverlay } from './pauseOverlay';
import { SettingsProvider } from './settingsProvider';
import { createSettingsStore, type SettingsStorage, type SettingsStore } from './settingsStore';
import { TrackingLostOverlay } from './trackingLostOverlay';
// Requirements 21.1, 23.1 to 23.9 and 24.1: every control and name comes from the copy, each callback
// fires by mouse and by keyboard, and focus moves into the overlay when it opens.
const PREFIX = 'overlay-test:';
class MemoryStorage implements SettingsStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}
function makeStore(): SettingsStore {
  return createSettingsStore({ prefix: PREFIX, storage: new MemoryStorage(), prefersReducedMotion: false });
}
function Harness({ store, children }: { store: SettingsStore; children: ReactNode }) {
  return (
    <MarrowCopyProvider value={FIXTURE_COPY}>
      <SettingsProvider store={store}>{children}</SettingsProvider>
    </MarrowCopyProvider>
  );
}
describe('PauseOverlay', () => {
  it('is a dialog named from the copy, and focus moves to Resume when it opens', () => {
    render(
      <Harness store={makeStore()}>
        <PauseOverlay onResume={() => undefined} onRecalibrate={() => undefined} onExit={() => undefined} />
      </Harness>,
    );
    expect(screen.getByRole('dialog', { name: FIXTURE_COPY.pause.pause })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: FIXTURE_COPY.pause.resume })).toHaveFocus();
  });
  it('offers the motion setting, mute, volume, Recalibrate and Exit with names from the copy', () => {
    render(
      <Harness store={makeStore()}>
        <PauseOverlay onResume={() => undefined} onRecalibrate={() => undefined} onExit={() => undefined} />
      </Harness>,
    );
    expect(screen.getByRole('group', { name: FIXTURE_COPY.settings.motion })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: FIXTURE_COPY.settings.mute })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: FIXTURE_COPY.settings.volume })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: FIXTURE_COPY.pause.recalibrate })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: FIXTURE_COPY.pause.exit })).toBeInTheDocument();
  });
  it('calls Resume, Recalibrate and Exit by mouse and by keyboard', async () => {
    const onResume = vi.fn();
    const onRecalibrate = vi.fn();
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness store={makeStore()}>
        <PauseOverlay onResume={onResume} onRecalibrate={onRecalibrate} onExit={onExit} />
      </Harness>,
    );
    await user.click(screen.getByRole('button', { name: FIXTURE_COPY.pause.resume }));
    expect(onResume).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: FIXTURE_COPY.pause.recalibrate }).focus();
    await user.keyboard('{Enter}');
    expect(onRecalibrate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: FIXTURE_COPY.pause.exit }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
  });
  it('changes the motion setting and mute from inside the overlay', async () => {
    const store = makeStore();
    const user = userEvent.setup();
    render(
      <Harness store={store}>
        <PauseOverlay onResume={() => undefined} onRecalibrate={() => undefined} onExit={() => undefined} />
      </Harness>,
    );
    await user.click(screen.getByRole('radio', { name: FIXTURE_COPY.settings.reduced }));
    expect(store.get().motion).toBe('reduced');
    await user.click(screen.getByRole('checkbox', { name: FIXTURE_COPY.settings.mute }));
    expect(store.get().mute).toBe(true);
  });
});
describe('TrackingLostOverlay', () => {
  it('is a dialog named from the instruction, and focus moves to Recover when it opens', () => {
    render(
      <MarrowCopyProvider value={FIXTURE_COPY}>
        <TrackingLostOverlay onRecover={() => undefined} onTryWithout={() => undefined} onExit={() => undefined} />
      </MarrowCopyProvider>,
    );
    expect(screen.getByRole('dialog', { name: FIXTURE_COPY.tracking.stepBackIn })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: FIXTURE_COPY.tracking.recover })).toHaveFocus();
  });
  it('shows the placeholder picture as an image with the copy as its name', () => {
    render(
      <MarrowCopyProvider value={FIXTURE_COPY}>
        <TrackingLostOverlay onRecover={() => undefined} onTryWithout={() => undefined} onExit={() => undefined} />
      </MarrowCopyProvider>,
    );
    const picture = screen.getByRole('img', { name: FIXTURE_COPY.tracking.pictureLabel });
    expect(picture.tagName.toLowerCase()).toBe('svg');
    expect(picture.getAttribute('style')).toBeNull();
  });
  it('calls Recover, "Try without camera" and Exit by mouse and by keyboard', async () => {
    const onRecover = vi.fn();
    const onTryWithout = vi.fn();
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(
      <MarrowCopyProvider value={FIXTURE_COPY}>
        <TrackingLostOverlay onRecover={onRecover} onTryWithout={onTryWithout} onExit={onExit} />
      </MarrowCopyProvider>,
    );
    await user.click(screen.getByRole('button', { name: FIXTURE_COPY.tracking.recover }));
    expect(onRecover).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: FIXTURE_COPY.camera.tryWithout }).focus();
    await user.keyboard(' ');
    expect(onTryWithout).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: FIXTURE_COPY.pause.exit }).focus();
    await user.keyboard('{Enter}');
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onRecover).toHaveBeenCalledTimes(1);
  });
});
describe('the barrel', () => {
  it('exports both overlays from marrow/react', () => {
    expect(react.PauseOverlay).toBe(PauseOverlay);
    expect(react.TrackingLostOverlay).toBe(TrackingLostOverlay);
  });
});
