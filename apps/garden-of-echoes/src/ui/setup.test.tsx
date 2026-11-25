// @vitest-environment jsdom
// The camera setup screens (requirements 3.2, 3.4, 24.1, 24.5). The screens are marrow/react components with the garden
// copy. The camera API is a spy, so a test can see any request.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createSettingsStore } from 'marrow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gardenMarrowCopy } from '../copy/gardenMarrowCopy';
import { Setup } from './Setup';

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

/** A settings store that keeps nothing, so one test cannot read another's choice. */
const settings = () => createSettingsStore({ prefix: 'test.setup.', prefersReducedMotion: false, storage: null });

describe('the permission screen (requirements 3.2, 3.4)', () => {
  it('3.4: the permission screen shows the garden text for "Use the camera" and "Try without camera"', () => {
    render(<Setup screen="cameraPermission" settings={settings()} onUseCamera={() => undefined} onTryWithout={() => undefined} onHandChosen={() => undefined} />);
    expect(screen.getByRole('button', { name: gardenMarrowCopy.camera.useCamera })).toBeTruthy();
    expect(screen.getByRole('button', { name: gardenMarrowCopy.camera.tryWithout })).toBeTruthy();
    expect(screen.getByText(gardenMarrowCopy.camera.explanation)).toBeTruthy();
  });

  it('3.2: rendering the permission screen requests no camera', () => {
    render(<Setup screen="cameraPermission" settings={settings()} onUseCamera={() => undefined} onTryWithout={() => undefined} onHandChosen={() => undefined} />);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('3.2: "Use the camera" calls onUseCamera from the click, and the component requests nothing itself', async () => {
    const onUseCamera = vi.fn();
    render(<Setup screen="cameraPermission" settings={settings()} onUseCamera={onUseCamera} onTryWithout={() => undefined} onHandChosen={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: gardenMarrowCopy.camera.useCamera }));
    expect(onUseCamera).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('3.3: "Try without camera" calls onTryWithout and requests no camera', async () => {
    const onTryWithout = vi.fn();
    render(<Setup screen="cameraPermission" settings={settings()} onUseCamera={() => undefined} onTryWithout={onTryWithout} onHandChosen={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: gardenMarrowCopy.camera.tryWithout }));
    expect(onTryWithout).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('24.1: Enter activates the focused "Use the camera" button', async () => {
    const onUseCamera = vi.fn();
    const user = userEvent.setup();
    render(<Setup screen="cameraPermission" settings={settings()} onUseCamera={onUseCamera} onTryWithout={() => undefined} onHandChosen={() => undefined} />);
    screen.getByRole('button', { name: gardenMarrowCopy.camera.useCamera }).focus();
    await user.keyboard('{Enter}');
    expect(onUseCamera).toHaveBeenCalledTimes(1);
  });
});

describe('the hand choice (requirements 3.4, 24.1)', () => {
  it('3.4: the hand choice shows the garden text and its Continue button', () => {
    render(<Setup screen="handChoice" settings={settings()} onUseCamera={() => undefined} onTryWithout={() => undefined} onHandChosen={() => undefined} />);
    // The question is in the instruction and in the legend, so the text appears twice.
    expect(screen.getAllByText(gardenMarrowCopy.hands.question).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: gardenMarrowCopy.hands.continue })).toBeTruthy();
  });

  it('24.1: Space activates the focused Continue button, which calls onHandChosen', async () => {
    const onHandChosen = vi.fn();
    const user = userEvent.setup();
    render(<Setup screen="handChoice" settings={settings()} onUseCamera={() => undefined} onTryWithout={() => undefined} onHandChosen={onHandChosen} />);
    // Continue stays disabled until a hand is chosen, so the test chooses one first.
    await user.click(screen.getByRole('radio', { name: gardenMarrowCopy.hands.right }));
    screen.getByRole('button', { name: gardenMarrowCopy.hands.continue }).focus();
    await user.keyboard(' ');
    expect(onHandChosen).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
