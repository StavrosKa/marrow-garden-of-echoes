// @vitest-environment jsdom
// Tests for the Camera Source's start, outcomes and dispose (Req 3.3, 4.6, 4.7, 5.1 to 5.6,
// 5.8), with fakes only: a fake `getUserMedia` and stream, a fake landmarker factory, a
// fake clock and fake timers. No test opens a camera or loads a model. The numbers come
// from TUNING; the sizes of the fake video are test data.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { TUNING, type PoseFrame } from '../core';
import { createCameraSource, type LandmarkerLike } from './cameraSource';
import type { StartOutcome } from './poseSource';

/** The size the fake browser delivers: not the size that was asked for (Req 4.7). */
const DELIVERED = { width: 1280, height: 720 };
const BASE_PATH = '/garden/';

class FakeTrack extends EventTarget {
  readonly stop = vi.fn<() => void>();
  end(): void {
    this.dispatchEvent(new Event('ended'));
  }
}

class FakeStream {
  readonly tracks: FakeTrack[];
  constructor(count = 1) {
    this.tracks = Array.from({ length: count }, () => new FakeTrack());
  }
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks;
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeLandmarker(): LandmarkerLike & { readonly close: Mock<() => void> } {
  return { detectForVideo: vi.fn(() => ({ landmarks: [] })), close: vi.fn<() => void>() };
}

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;
type CreateLandmarker = (basePath: string) => Promise<LandmarkerLike>;

interface Harness {
  readonly video: HTMLVideoElement;
  readonly stream: FakeStream;
  readonly landmarker: ReturnType<typeof fakeLandmarker>;
  readonly getUserMedia: Mock<GetUserMedia>;
  readonly createLandmarker: Mock<CreateLandmarker>;
  readonly play: Mock<() => Promise<void>>;
  readonly assignments: string[];
  readonly clock: { t: number };
  readonly source: ReturnType<typeof createCameraSource>;
  /** The video reports its metadata, with the delivered size. */
  readonly loadMetadata: () => void;
}

interface HarnessOptions {
  readonly getUserMedia?: Mock<GetUserMedia> | null;
  readonly createLandmarker?: Mock<CreateLandmarker>;
  readonly metadataAtOnce?: boolean;
  readonly play?: Mock<() => Promise<void>>;
  readonly tracks?: number;
}

function harness(opts: HarnessOptions = {}): Harness {
  const video = document.createElement('video');
  const assignments: string[] = [];
  let ready = 0;
  let stored: MediaProvider | null = null;
  Object.defineProperties(video, {
    readyState: { get: () => ready, configurable: true },
    videoWidth: { get: () => (ready > 0 ? DELIVERED.width : 0), configurable: true },
    videoHeight: { get: () => (ready > 0 ? DELIVERED.height : 0), configurable: true },
    srcObject: {
      get: () => stored,
      set: (value: MediaProvider | null) => {
        assignments.push(`srcObject=${value === null ? 'null' : 'stream'} muted=${String(video.muted)} playsInline=${String(video.playsInline)} autoplay=${String(video.autoplay)}`);
        stored = value;
      },
      configurable: true,
    },
  });
  const play = opts.play ?? vi.fn(() => Promise.resolve());
  video.play = play as unknown as () => Promise<void>;
  const loadMetadata = (): void => {
    ready = 1;
    video.dispatchEvent(new Event('loadedmetadata'));
  };
  const stream = new FakeStream(opts.tracks);
  const getUserMedia =
    opts.getUserMedia === undefined ? vi.fn(() => Promise.resolve(stream as unknown as MediaStream)) : opts.getUserMedia;
  const landmarker = fakeLandmarker();
  const createLandmarker = opts.createLandmarker ?? vi.fn(() => Promise.resolve(landmarker));
  const clock = { t: 1000 };
  const source = createCameraSource({
    basePath: BASE_PATH,
    video,
    ...(getUserMedia === null ? {} : { getUserMedia: getUserMedia as (c: MediaStreamConstraints) => Promise<MediaStream> }),
    createLandmarker: createLandmarker as (base: string) => Promise<LandmarkerLike>,
    now: () => clock.t,
  });
  if (opts.metadataAtOnce !== false) {
    // The metadata is there as soon as the stream is attached.
    const original = Object.getOwnPropertyDescriptor(video, 'srcObject');
    Object.defineProperty(video, 'srcObject', {
      ...original,
      set: (value: MediaProvider | null) => {
        original?.set?.call(video, value);
        if (value !== null) ready = 1;
      },
    });
  }
  return { video, stream, landmarker, getUserMedia: getUserMedia ?? vi.fn(), createLandmarker, play, assignments, clock, source, loadMetadata };
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** Starts, lets the microtasks run, and returns the outcome. */
async function started(h: Harness): Promise<StartOutcome> {
  const outcome = h.source.start();
  await settle();
  return outcome;
}

function everyLandmarkInvalid(frame: PoseFrame | null): boolean {
  if (frame === null) return false;
  const { leftWrist, rightWrist, nose, leftShoulder, rightShoulder } = frame.landmarks;
  return [leftWrist, rightWrist, nose, leftShoulder, rightShoulder].every((l) => !l.valid);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('start: the camera request (Req 5.1, 4.7)', () => {
  it('calls getUserMedia before anything is awaited, once, for the user-facing camera at the ideal size of TUNING and no audio', () => {
    const h = harness();
    void h.source.start();
    // No await has happened: the call is already made.
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.getUserMedia).toHaveBeenCalledWith({
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: TUNING.cameraWidth },
        height: { ideal: TUNING.cameraHeight },
      },
      audio: false,
    });
  });

  it('does not ask for the camera before start is called, nor again while a start is pending', async () => {
    const h = harness();
    expect(h.getUserMedia).not.toHaveBeenCalled();
    const first = h.source.start();
    const second = h.source.start();
    expect(second).toBe(first);
    await settle();
    expect(await first).toBe('ready');
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('a start while the source is running reports ready and does not ask for the camera again', async () => {
    const h = harness();
    expect(await started(h)).toBe('ready');
    expect(await started(h)).toBe('ready');
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.createLandmarker).toHaveBeenCalledTimes(1);
  });

  it('reports ready, attaches the stream to the video, plays it, and creates the landmarker with the base path', async () => {
    const h = harness();
    expect(await started(h)).toBe('ready');
    expect(h.video.srcObject).toBe(h.stream);
    expect(h.play).toHaveBeenCalledTimes(1);
    expect(h.createLandmarker).toHaveBeenCalledTimes(1);
    expect(h.createLandmarker).toHaveBeenCalledWith(BASE_PATH);
  });

  it('adds the slash to a base path that has none', async () => {
    const h = harness();
    const createLandmarker = vi.fn(() => Promise.resolve(h.landmarker));
    const source = createCameraSource({
      basePath: '/garden',
      video: h.video,
      getUserMedia: () => Promise.resolve(h.stream as unknown as MediaStream),
      createLandmarker,
      now: () => 0,
    });
    const outcome = source.start();
    await settle();
    expect(await outcome).toBe('ready');
    expect(createLandmarker).toHaveBeenCalledWith('/garden/');
  });

  it('sets muted, playsInline and autoplay on the video before it attaches the stream', async () => {
    const h = harness();
    await started(h);
    expect(h.assignments[0]).toBe('srcObject=stream muted=true playsInline=true autoplay=true');
  });

  it('waits for the video metadata before it plays and creates the landmarker, and accepts the size the browser delivers (Req 4.7)', async () => {
    const h = harness({ metadataAtOnce: false });
    const outcome = h.source.start();
    await settle();
    expect(h.play).not.toHaveBeenCalled();
    expect(h.createLandmarker).not.toHaveBeenCalled();
    h.loadMetadata();
    await settle();
    expect(await outcome).toBe('ready');
    // The aspect of the frame that an ended camera publishes comes from the delivered video.
    h.stream.tracks[0]?.end();
    expect(h.source.latest()?.aspect).toBe(DELIVERED.width / DELIVERED.height);
    expect(DELIVERED.width / DELIVERED.height).not.toBe(TUNING.cameraWidth / TUNING.cameraHeight);
  });
});

describe('start: each failure gives its outcome (Req 5.2, 5.3, 5.4)', () => {
  const named = (name: string): Error => Object.assign(new Error(name), { name });

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-camera'],
    ['OverconstrainedError', 'no-camera'],
    ['NotReadableError', 'no-camera'],
    ['AbortError', 'no-camera'],
    ['TypeError', 'no-camera'],
    ['SomethingElse', 'no-camera'],
  ] as const)('getUserMedia failing with %s gives %s', async (name, expected) => {
    const h = harness({ getUserMedia: vi.fn(() => Promise.reject(named(name))) });
    expect(await started(h)).toBe(expected);
    expect(h.createLandmarker).not.toHaveBeenCalled();
  });

  it('a failure that is not an error object gives no-camera', async () => {
    const h = harness({ getUserMedia: vi.fn(() => Promise.reject('refused')) });
    expect(await started(h)).toBe('no-camera');
  });

  it('a getUserMedia that throws at once gives its outcome too', async () => {
    const denied = harness({
      getUserMedia: vi.fn(() => {
        throw named('NotAllowedError');
      }),
    });
    expect(await started(denied)).toBe('denied');
    const other = harness({
      getUserMedia: vi.fn(() => {
        throw new TypeError('no constraints');
      }),
    });
    expect(await started(other)).toBe('no-camera');
  });

  it('no getUserMedia at all gives no-camera and calls nothing', async () => {
    const h = harness({ getUserMedia: null });
    expect(await started(h)).toBe('no-camera');
    expect(h.createLandmarker).not.toHaveBeenCalled();
  });

  it('a landmarker that fails to load gives model-failed and stops every track and detaches the stream (Req 5.5)', async () => {
    const h = harness({ tracks: 2, createLandmarker: vi.fn(() => Promise.reject(new Error('fetch failed'))) });
    expect(await started(h)).toBe('model-failed');
    for (const track of h.stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(h.video.srcObject).toBeNull();
  });

  it('a factory that throws at once gives model-failed', async () => {
    const h = harness({
      createLandmarker: vi.fn(() => {
        throw new Error('no wasm');
      }),
    });
    expect(await started(h)).toBe('model-failed');
    expect(h.stream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it('opens no camera that it does not stop: a denied start has no track, a failed one has all of them stopped', async () => {
    const h = harness({ tracks: 3, createLandmarker: vi.fn(() => Promise.reject(new Error('x'))) });
    await started(h);
    expect(h.stream.tracks.map((t) => t.stop.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('after a failed start the source can start again, with a new request', async () => {
    const h = harness({ createLandmarker: vi.fn().mockRejectedValueOnce(new Error('x')) });
    expect(await started(h)).toBe('model-failed');
    h.createLandmarker.mockImplementation(() => Promise.resolve(h.landmarker));
    expect(await started(h)).toBe('ready');
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
  });
});

describe('start: one budget of modelLoadTimeoutMs from the arrival of the stream (Req 5.5)', () => {
  it('a video whose metadata never comes gives no-camera at the timeout, not before, and stops every track', async () => {
    const h = harness({ metadataAtOnce: false, tracks: 2 });
    let outcome: StartOutcome | null = null;
    void h.source.start().then((o) => (outcome = o));
    await vi.advanceTimersByTimeAsync(TUNING.modelLoadTimeoutMs - 1);
    expect(outcome).toBeNull();
    expect(h.stream.tracks[0]?.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('no-camera');
    for (const track of h.stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(h.video.srcObject).toBeNull();
    expect(h.createLandmarker).not.toHaveBeenCalled();
  });

  it('a play() that never finishes gives no-camera at the timeout', async () => {
    const h = harness({ play: vi.fn(() => new Promise<void>(() => undefined)) });
    let outcome: StartOutcome | null = null;
    void h.source.start().then((o) => (outcome = o));
    await vi.advanceTimersByTimeAsync(TUNING.modelLoadTimeoutMs - 1);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('no-camera');
    expect(h.stream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(h.video.srcObject).toBeNull();
    expect(h.createLandmarker).not.toHaveBeenCalled();
  });

  it('a play() that rejects gives no-camera at once, with the tracks stopped and no landmarker made', async () => {
    const h = harness({ play: vi.fn(() => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }))) });
    // Not "denied": that is for getUserMedia (Req 5.3); a video that cannot play is no usable camera.
    expect(await started(h)).toBe('no-camera');
    expect(h.stream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(h.video.srcObject).toBeNull();
    expect(h.createLandmarker).not.toHaveBeenCalled();
  });

  it('a video that reports an error gives no-camera', async () => {
    const h = harness({ metadataAtOnce: false });
    const outcome = h.source.start();
    await settle();
    h.video.dispatchEvent(new Event('error'));
    await settle();
    expect(await outcome).toBe('no-camera');
    expect(h.stream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it('a landmarker that is not ready in time gives model-failed at the timeout, stops every track and detaches the stream', async () => {
    const never = vi.fn(() => new Promise<LandmarkerLike>(() => undefined));
    const h = harness({ createLandmarker: never, tracks: 2 });
    let outcome: StartOutcome | null = null;
    void h.source.start().then((o) => (outcome = o));
    await vi.advanceTimersByTimeAsync(TUNING.modelLoadTimeoutMs - 1);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('model-failed');
    for (const track of h.stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(h.video.srcObject).toBeNull();
  });

  it('the metadata, play() and the landmarker share one budget: time spent on the first two is not given back', async () => {
    const model = deferred<LandmarkerLike>();
    const h = harness({ metadataAtOnce: false, createLandmarker: vi.fn(() => model.promise) });
    let outcome: StartOutcome | null = null;
    void h.source.start().then((o) => (outcome = o));
    const spent = TUNING.modelLoadTimeoutMs / 2;
    await vi.advanceTimersByTimeAsync(spent);
    h.loadMetadata();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.createLandmarker).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TUNING.modelLoadTimeoutMs - spent - 1);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('model-failed');
  });

  it('a landmarker that arrives after the timeout is closed and changes nothing', async () => {
    const model = deferred<LandmarkerLike>();
    const h = harness({ createLandmarker: vi.fn(() => model.promise) });
    let outcome: StartOutcome | null = null;
    void h.source.start().then((o) => (outcome = o));
    await vi.advanceTimersByTimeAsync(TUNING.modelLoadTimeoutMs);
    expect(outcome).toBe('model-failed');
    model.resolve(h.landmarker);
    await settle();
    expect(h.landmarker.close).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('model-failed');
  });

  it('a start that succeeds leaves no timer running', async () => {
    const h = harness();
    expect(await started(h)).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(TUNING.modelLoadTimeoutMs * 2);
    expect(h.stream.tracks[0]?.stop).not.toHaveBeenCalled();
    expect(h.video.srcObject).toBe(h.stream);
  });

  it('gives exactly one outcome per start, whatever else happens afterwards', async () => {
    const model = deferred<LandmarkerLike>();
    const h = harness({ createLandmarker: vi.fn(() => model.promise) });
    const outcomes: StartOutcome[] = [];
    void h.source.start().then((o) => outcomes.push(o));
    await vi.advanceTimersByTimeAsync(TUNING.modelLoadTimeoutMs);
    model.resolve(h.landmarker);
    h.stream.tracks[0]?.end();
    h.source.dispose();
    await settle();
    expect(outcomes).toEqual(['model-failed']);
  });
});

describe('dispose (Req 3.3, 5.6)', () => {
  it('stops every track, detaches the stream and closes the landmarker', async () => {
    const h = harness({ tracks: 2 });
    await started(h);
    h.source.dispose();
    for (const track of h.stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(h.video.srcObject).toBeNull();
    expect(h.landmarker.close).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a second call', async () => {
    const h = harness();
    await started(h);
    h.source.dispose();
    h.source.dispose();
    expect(h.stream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(h.landmarker.close).toHaveBeenCalledTimes(1);
    expect(h.assignments.filter((a) => a.startsWith('srcObject=null'))).toHaveLength(1);
  });

  it('is safe before start, and then start reports no-camera without asking for the camera', async () => {
    const h = harness();
    h.source.dispose();
    expect(await started(h)).toBe('no-camera');
    expect(h.getUserMedia).not.toHaveBeenCalled();
  });

  it('while the permission prompt is open: the start reports no-camera at once, and a stream that arrives later is stopped', async () => {
    const request = deferred<MediaStream>();
    const h = harness({ getUserMedia: vi.fn(() => request.promise) });
    let outcome: StartOutcome | null = null;
    void h.source.start().then((o) => (outcome = o));
    await settle();
    h.source.dispose();
    await settle();
    expect(outcome).toBe('no-camera');
    request.resolve(h.stream as unknown as MediaStream);
    await settle();
    expect(h.stream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(h.createLandmarker).not.toHaveBeenCalled();
  });

  it('while the model loads: the start reports no-camera, the tracks are stopped, and the landmarker that arrives later is closed', async () => {
    const model = deferred<LandmarkerLike>();
    const h = harness({ createLandmarker: vi.fn(() => model.promise) });
    let outcome: StartOutcome | null = null;
    void h.source.start().then((o) => (outcome = o));
    await settle();
    h.source.dispose();
    await settle();
    expect(outcome).toBe('no-camera');
    expect(h.stream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
    model.resolve(h.landmarker);
    await settle();
    expect(h.landmarker.close).toHaveBeenCalledTimes(1);
  });

  it('a landmarker whose close throws does not stop the rest of the release', async () => {
    const h = harness();
    h.landmarker.close.mockImplementation(() => {
      throw new Error('already closed');
    });
    await started(h);
    expect(() => h.source.dispose()).not.toThrow();
    expect(h.stream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
  });
});

describe('a camera that ends while running (Req 5.8)', () => {
  it('publishes one new frame with every landmark invalid, at the time of the clock, and releases the camera', async () => {
    const h = harness({ tracks: 2 });
    await started(h);
    expect(h.source.latest()).toBeNull();
    h.clock.t = 5000;
    h.stream.tracks[0]?.end();
    const frame = h.source.latest();
    expect(everyLandmarkInvalid(frame)).toBe(true);
    expect(frame?.t).toBe(5000);
    expect(frame?.aspect).toBe(DELIVERED.width / DELIVERED.height);
    for (const track of h.stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(h.video.srcObject).toBeNull();
    expect(h.landmarker.close).toHaveBeenCalledTimes(1);
  });

  it('keeps that one frame as latest: no stream of new ones, not for a second track that ends, not as time passes', async () => {
    const h = harness({ tracks: 2 });
    await started(h);
    h.stream.tracks[0]?.end();
    const frame = h.source.latest();
    h.stream.tracks[1]?.end();
    h.stream.tracks[0]?.end();
    h.clock.t += 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.source.latest()).toBe(frame);
  });

  it('stays invalid until start runs again, and start asks for the camera again', async () => {
    const h = harness();
    await started(h);
    h.stream.tracks[0]?.end();
    const frame = h.source.latest();
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    const second = new FakeStream();
    h.getUserMedia.mockImplementation(() => Promise.resolve(second as unknown as MediaStream));
    expect(await started(h)).toBe('ready');
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
    expect(h.video.srcObject).toBe(second);
    // A restarted source has had no result yet: the invalid frame is still the latest.
    expect(h.source.latest()).toBe(frame);
    expect(everyLandmarkInvalid(h.source.latest())).toBe(true);
  });

  it('a track that ends while the source is still starting gives no-camera and stops the tracks', async () => {
    const model = deferred<LandmarkerLike>();
    const h = harness({ createLandmarker: vi.fn(() => model.promise), tracks: 2 });
    let outcome: StartOutcome | null = null;
    void h.source.start().then((o) => (outcome = o));
    await settle();
    h.stream.tracks[1]?.end();
    await settle();
    expect(outcome).toBe('no-camera');
    for (const track of h.stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    model.resolve(h.landmarker);
    await settle();
    expect(h.landmarker.close).toHaveBeenCalledTimes(1);
    expect(h.source.latest()).toBeNull();
  });

  it('after dispose, a track that ends changes nothing', async () => {
    const h = harness();
    await started(h);
    h.source.dispose();
    h.stream.tracks[0]?.end();
    expect(h.source.latest()).toBeNull();
  });
});

describe('nothing is sent or stored (Req 4.6)', () => {
  it('a whole start, an ended camera, a restart and a dispose make no network call and write no storage', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const beacon = vi.fn();
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const open = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const h = harness();
    await started(h);
    h.stream.tracks[0]?.end();
    await started(h);
    h.source.dispose();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
