// @vitest-environment jsdom
// The Home screen (requirements 3.1, 3.2, 3.3, 24.1). The camera API is replaced by a spy, so a test can see any request.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GARDEN_COPY } from '../copy/garden';
import { Home } from './Home';

/** The camera API, replaced by a spy so that any request is visible. */
let getUserMedia: ReturnType<typeof vi.fn>;
const ORIGINAL = Object.getOwnPropertyDescriptor(globalThis.navigator, 'mediaDevices');

beforeEach(() => {
  getUserMedia = vi.fn(() => Promise.reject(new Error('the camera must not be requested here')));
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});

afterEach(() => {
  if (ORIGINAL !== undefined) Object.defineProperty(globalThis.navigator, 'mediaDevices', ORIGINAL);
  else Reflect.deleteProperty(globalThis.navigator, 'mediaDevices');
});

describe('Home (requirements 3.1 to 3.3, 24.1)', () => {
  it('3.1 24.1: offers "Start" and "Try without camera" as real buttons with accessible names', () => {
    render(<Home onStart={() => undefined} onTryWithout={() => undefined} />);
    // getByRole fails the test when no button has that name, so a missing button is a failure.
    expect(screen.getByRole('button', { name: GARDEN_COPY.home.start }).tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: GARDEN_COPY.home.noCamera }).tagName).toBe('BUTTON');
  });

  it('3.2: shows the camera explanation before any camera prompt', () => {
    render(<Home onStart={() => undefined} onTryWithout={() => undefined} />);
    expect(screen.getByText(GARDEN_COPY.camera.why).tagName).toBe('P');
  });

  it('3.2: the camera is not requested before Start, and Home never requests it', () => {
    render(<Home onStart={() => undefined} onTryWithout={() => undefined} />);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('3.2: pressing Start calls onStart and does not request the camera itself', async () => {
    const onStart = vi.fn();
    render(<Home onStart={onStart} onTryWithout={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: GARDEN_COPY.home.start }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('3.3: "Try without camera" calls onTryWithout and never requests the camera', async () => {
    const onTryWithout = vi.fn();
    render(<Home onStart={() => undefined} onTryWithout={onTryWithout} />);
    await userEvent.click(screen.getByRole('button', { name: GARDEN_COPY.home.noCamera }));
    expect(onTryWithout).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('3.5 24.1: Enter activates the focused Start button', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<Home onStart={onStart} onTryWithout={() => undefined} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: GARDEN_COPY.home.start }));
    await user.keyboard('{Enter}');
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('3.5 24.1: Space activates the focused "Try without camera" button, and the camera is not requested', async () => {
    const onTryWithout = vi.fn();
    const user = userEvent.setup();
    render(<Home onStart={() => undefined} onTryWithout={onTryWithout} />);
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: GARDEN_COPY.home.noCamera }));
    await user.keyboard(' ');
    expect(onTryWithout).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
