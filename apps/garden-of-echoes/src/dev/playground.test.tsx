// @vitest-environment jsdom
// The playground's load check (Req 1.4, 26.3): an invalid tuning or content shows its message instead of running.
// The running page on the simulated path (Req 22.9, 22.10, 23.1 to 23.4, 28.9): fake browser parts, real DOM.
import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatTuningErrors, TUNING, validateTuning, type PoseFrame } from 'marrow/core';
import type { PoseSource } from 'marrow/input';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { Playground, type PlaygroundParts } from './playground';

// jsdom has no 2D canvas. The calibration screen draws its aura on a canvas, and a null context makes it skip the draw.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
});

describe('Playground load check', () => {
  it('runs with the shipped tuning and content', () => {
    render(<Playground parts={fakeParts().parts} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Input playground');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the tuning message instead of running when the tuning is invalid', () => {
    const bad = { ...TUNING, hitRadius: 0.5 };
    const expected = formatTuningErrors(validateTuning(bad));
    expect(expected).toContain('hitRadius');
    const { container } = render(<Playground tuning={bad} parts={fakeParts().parts} />);
    expect(screen.getByRole('alert').textContent).toBe('The tuning needs a fix before the playground can run.');
    expect(container.querySelector('pre')?.textContent).toBe(expected);
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeNull();
  });

  it('shows the content message when the content is invalid', () => {
    const { container } = render(
      <Playground content={{ targetCount: 3, slots: [{ x: 0.2, y: 1.4 }] }} parts={fakeParts().parts} />,
    );
    expect(screen.getByRole('alert').textContent).toBe('The playground content needs a fix before it can run.');
    expect(container.querySelector('pre')?.textContent).toBe(
      'playground-content.json: slots[0].y = 1.4 is out of range [0, 1]',
    );
  });
});

/** Fake browser parts. The frame callbacks are kept in a set, so the test can count the live loops. */
function fakeParts() {
  const callbacks = new Map<number, (t: number) => void>();
  let next = 1;
  const sources: { disposed: number }[] = [];
  const parts: PlaygroundParts = {
    createPointerSource: () => {
      const record = { disposed: 0 };
      sources.push(record);
      const source: PoseSource = {
        start: () => Promise.resolve('ready'),
        latest: (): PoseFrame | null => null,
        dispose: () => {
          record.disposed += 1;
        },
      };
      return source;
    },
    requestFrame: (callback) => {
      const handle = next;
      next += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      callbacks.delete(handle);
    },
    createToneContext: () => ({
      currentTime: 0,
      destination: 'out',
      createGain: () => ({
        gain: {
          value: 0,
          setValueAtTime: () => undefined,
          linearRampToValueAtTime: () => undefined,
          cancelScheduledValues: () => undefined,
        },
        connect: () => undefined,
      }),
      createOscillator: () => ({
        type: '',
        frequency: {
          value: 0,
          setValueAtTime: () => undefined,
          linearRampToValueAtTime: () => undefined,
          cancelScheduledValues: () => undefined,
        },
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
      }),
      resume: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
    settingsStorage: null,
  };
  return { parts, callbacks, sources };
}

describe('the playground on the simulated path', () => {
  it('runs one frame loop and one pointer source under StrictMode, through unmount and remount', async () => {
    const user = userEvent.setup();
    const fake = fakeParts();
    const { unmount } = render(
      <StrictMode>
        <Playground parts={fake.parts} />
      </StrictMode>,
    );
    expect(fake.callbacks.size).toBe(1);
    await user.click(screen.getByRole('button', { name: copy.marrow.start.start }));
    await user.click(screen.getByRole('button', { name: copy.marrow.camera.tryWithout }));
    expect(fake.sources).toHaveLength(1);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: copy.marrow.pause.recalibrate }));
    expect(fake.sources).toHaveLength(2);
    expect(fake.sources.filter((source) => source.disposed === 0)).toHaveLength(1);
    unmount();
    expect(fake.callbacks.size).toBe(0);
    expect(fake.sources.every((source) => source.disposed === 1)).toBe(true);

    const again = fakeParts();
    render(
      <StrictMode>
        <Playground parts={again.parts} />
      </StrictMode>,
    );
    expect(again.callbacks.size).toBe(1);
  });

  it('shows the Simulated input label and the Pause control on every screen after Start', async () => {
    const user = userEvent.setup();
    render(<Playground parts={fakeParts().parts} />);
    await user.click(screen.getByRole('button', { name: copy.marrow.start.start }));
    expect(screen.queryByText(copy.marrow.simulatedInputLabel)).toBeNull();
    await user.click(screen.getByRole('button', { name: copy.marrow.camera.tryWithout }));
    // getBy throws when nothing matches, so each call below is also an existence check.
    expect(screen.getByText(copy.marrow.simulatedInputLabel).textContent).toBe(copy.marrow.simulatedInputLabel);
    expect(screen.getByRole('button', { name: copy.marrow.pause.pause }).textContent).toBe(copy.marrow.pause.pause);
    expect(screen.getByRole('checkbox', { name: copy.marrow.settings.mute }).tagName).toBe('INPUT');
  });

  it('Escape opens Pause, Resume closes it, and focus returns to the Pause control', async () => {
    const user = userEvent.setup();
    render(<Playground parts={fakeParts().parts} />);
    await user.click(screen.getByRole('button', { name: copy.marrow.start.start }));
    await user.click(screen.getByRole('button', { name: copy.marrow.camera.tryWithout }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: copy.marrow.pause.pause }).tagName).toBe('DIV');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: copy.marrow.pause.resume }));
    await user.click(screen.getByRole('button', { name: copy.marrow.pause.resume }));
    expect(screen.queryByRole('dialog', { name: copy.marrow.pause.pause })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: copy.marrow.pause.pause }));
  });

  it('Use the whole screen starts a round, with the play instruction in the live region', async () => {
    const user = userEvent.setup();
    render(<Playground parts={fakeParts().parts} />);
    await user.click(screen.getByRole('button', { name: copy.marrow.start.start }));
    await user.click(screen.getByRole('button', { name: copy.marrow.camera.tryWithout }));
    await act(async () => {
      await user.click(screen.getByRole('button', { name: copy.marrow.calibration.wholeScreen }));
    });
    const instruction = screen.getByText(copy.playground.playInstruction);
    expect(instruction.getAttribute('aria-live')).toBe('polite');
  });
});
