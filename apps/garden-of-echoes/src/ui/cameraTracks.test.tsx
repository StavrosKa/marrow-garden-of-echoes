// @vitest-environment jsdom
// Camera tracks stop (garden-level requirement 21.4). Exiting to Home, and unmounting the app, each leave no camera track
// running. The fake stream records every stop call of each track, so the test sees the stops, and not only the result.
//
// The real code stops every track at once: requestCameraAccess (cameraAccess.ts) calls stop on each track as soon as the
// camera request resolves, and the app keeps no stream. So the tracks are already stopped when the player exits or the app
// unmounts. The tests check that outcome for each path. A third test resolves the request after unmount, the one ordering
// in which a stream could arrive with no screen to hold it.
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GARDEN_COPY } from '../copy/garden';
import { gardenMarrowCopy } from '../copy/gardenMarrowCopy';
import { App } from './App';

// The Scene Manager needs a canvas, the frame loop needs animation frames, and the pointer and the sound need a browser.
// The stage is still mounted, so these stubs keep the App's own flow real.
vi.mock('world-view/pixi', () => ({
  createSceneManager: () => ({ start: async () => undefined, dispose: () => undefined, setTargets: () => undefined, setTargetColour: () => undefined }),
}));
vi.mock('./frames', () => ({ browserFrames: { request: () => 0, cancel: () => undefined } }));
vi.mock('marrow/input', () => ({
  createPointerSource: () => ({ start: async () => undefined, latest: () => null, dispose: () => undefined }),
}));
vi.mock('../audio/gardenAudio', () => ({
  createGardenAudio: () => ({
    setMuted: () => undefined,
    setVolume: () => undefined,
    start: () => undefined,
    playNote: () => undefined,
    dispose: () => undefined,
  }),
}));
vi.mock('../audio/tonePlayer', () => ({ createTonePlayer: () => ({}) }));

/** A track that records each stop call, and reports itself as live until it is stopped. */
class FakeTrack {
  readonly kind = 'video';
  live = true;
  stops = 0;
  stop(): void {
    this.stops += 1;
    this.live = false;
  }
}

/** A fake MediaStream: its tracks are the ones the test made. */
class FakeStream {
  readonly tracks: FakeTrack[];
  constructor(tracks: FakeTrack[]) {
    this.tracks = tracks;
  }
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

const ORIGINAL = Object.getOwnPropertyDescriptor(globalThis.navigator, 'mediaDevices');
let tracks: FakeTrack[] = [];
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  tracks = [new FakeTrack(), new FakeTrack()];
  const stream = new FakeStream(tracks);
  getUserMedia = vi.fn(() => Promise.resolve(stream));
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});

afterEach(() => {
  if (ORIGINAL !== undefined) Object.defineProperty(globalThis.navigator, 'mediaDevices', ORIGINAL);
  else Reflect.deleteProperty(globalThis.navigator, 'mediaDevices');
});

/** Home to the stage through the camera: Start, "Use the camera", then Continue on the hand choice. */
async function startWithCamera(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: GARDEN_COPY.home.start }));
  await user.click(await screen.findByRole('button', { name: gardenMarrowCopy.camera.useCamera }));
  await user.click(await screen.findByRole('radio', { name: gardenMarrowCopy.hands.right }));
  await user.click(await screen.findByRole('button', { name: gardenMarrowCopy.hands.continue }));
  await screen.findByText(GARDEN_COPY.label.simulated);
}

/** Every track was stopped at least once, and none is live. The failure names the track's index. */
function expectEveryTrackStopped(): void {
  tracks.forEach((track, index) => {
    expect(track.stops, `track ${index} stop calls`).toBeGreaterThanOrEqual(1);
    expect(track.live, `track ${index} is live`).toBe(false);
  });
}

describe('camera tracks at exit and unmount (requirement 21.4)', () => {
  it('exiting to Home stops every track', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startWithCamera(user);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    // The stops came with the request: cameraAccess stops each track at once, before the stage starts.
    expectEveryTrackStopped();

    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: GARDEN_COPY.pause.exit }));
    await screen.findByRole('button', { name: GARDEN_COPY.home.start });
    expectEveryTrackStopped();
  });

  it('unmounting the app stops every track', async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await startWithCamera(user);
    view.unmount();
    expectEveryTrackStopped();
  });

  it('a camera request that resolves after unmount still stops every track', async () => {
    let release: (() => void) | null = null;
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(new FakeStream(tracks));
        }),
    );
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(screen.getByRole('button', { name: GARDEN_COPY.home.start }));
    await user.click(await screen.findByRole('button', { name: gardenMarrowCopy.camera.useCamera }));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    view.unmount();

    // The browser answers after the screen has gone. No track may be left running.
    await act(async () => {
      if (release === null) throw new Error('the request was not made');
      release();
      await new Promise((done) => setTimeout(done, 0));
    });
    expectEveryTrackStopped();
  });
});
