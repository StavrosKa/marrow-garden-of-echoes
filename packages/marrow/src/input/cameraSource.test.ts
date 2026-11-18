// @vitest-environment jsdom
// Tests for the Camera Source: start, outcomes and dispose (Req 3.3, 4.6, 4.7, 5.1 to 5.6, 5.8)
// and the inference loop (Req 2.3, 2.6, 4.1 to 4.4, 4.8), with fakes only: a fake `getUserMedia` and stream, a fake landmarker factory, a
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

type Detect = LandmarkerLike['detectForVideo'];

function fakeLandmarker(): { readonly detectForVideo: Mock<Detect>; readonly close: Mock<() => void> } {
  return { detectForVideo: vi.fn<Detect>(() => ({ landmarks: [] })), close: vi.fn<() => void>() };
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
  /** The video frame callbacks asked for and not yet run or cancelled. */
  readonly pendingFrames: () => number;
  /** Runs the callbacks that are pending now, as one video frame; callbacks they ask for wait for the next. */
  readonly fireFrame: () => void;
  readonly cancelledFrames: () => number;
  /** The video's current time, which changes with each new picture. */
  readonly setVideoTime: (seconds: number) => void;
  readonly setReadyState: (state: number) => void;
  /** Moves the clock and the fake timers by the same time. */
  readonly advance: (ms: number) => Promise<void>;
}

interface HarnessOptions {
  readonly getUserMedia?: Mock<GetUserMedia> | null;
  readonly createLandmarker?: Mock<CreateLandmarker>;
  readonly metadataAtOnce?: boolean;
  readonly play?: Mock<() => Promise<void>>;
  readonly tracks?: number;
  /** The ready state the video has once it has its metadata; 4 is a video that has pictures. */
  readonly readyState?: number;
}

function harness(opts: HarnessOptions = {}): Harness {
  const video = document.createElement('video');
  const assignments: string[] = [];
  let ready = 0;
  let videoTime = 0;
  const readyLevel = opts.readyState ?? 1;
  let stored: MediaProvider | null = null;
  Object.defineProperties(video, {
    readyState: { get: () => ready, configurable: true },
    videoWidth: { get: () => (ready > 0 ? DELIVERED.width : 0), configurable: true },
    videoHeight: { get: () => (ready > 0 ? DELIVERED.height : 0), configurable: true },
    currentTime: { get: () => videoTime, configurable: true },
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
    ready = readyLevel;
    video.dispatchEvent(new Event('loadedmetadata'));
  };
  const stream = new FakeStream(opts.tracks);
  const getUserMedia =
    opts.getUserMedia === undefined ? vi.fn(() => Promise.resolve(stream as unknown as MediaStream)) : opts.getUserMedia;
  const landmarker = fakeLandmarker();
  const createLandmarker = opts.createLandmarker ?? vi.fn(() => Promise.resolve(landmarker));
  const clock = { t: 1000 };
  let callbacks: { run: () => void; cancelled: boolean }[] = [];
  let cancelled = 0;
  const source = createCameraSource({
    basePath: BASE_PATH,
    video,
    ...(getUserMedia === null ? {} : { getUserMedia: getUserMedia as (c: MediaStreamConstraints) => Promise<MediaStream> }),
    createLandmarker: createLandmarker as (base: string) => Promise<LandmarkerLike>,
    scheduleFrame: (_video, callback) => {
      const entry = { run: callback, cancelled: false };
      callbacks.push(entry);
      return () => {
        entry.cancelled = true;
        cancelled += 1;
      };
    },
    now: () => clock.t,
  });
  if (opts.metadataAtOnce !== false) {
    // The metadata is there as soon as the stream is attached.
    const original = Object.getOwnPropertyDescriptor(video, 'srcObject');
    Object.defineProperty(video, 'srcObject', {
      ...original,
      set: (value: MediaProvider | null) => {
        original?.set?.call(video, value);
        if (value !== null) ready = readyLevel;
      },
    });
  }
  return {
    video,
    stream,
    landmarker,
    getUserMedia: getUserMedia ?? vi.fn(),
    createLandmarker,
    play,
    assignments,
    clock,
    source,
    loadMetadata,
    pendingFrames: () => callbacks.filter((c) => !c.cancelled).length,
    fireFrame: () => {
      const due = callbacks.filter((c) => !c.cancelled);
      callbacks = [];
      for (const entry of due) entry.run();
    },
    cancelledFrames: () => cancelled,
    setVideoTime: (seconds) => {
      videoTime = seconds;
    },
    setReadyState: (state) => {
      ready = state;
    },
    advance: async (ms) => {
      clock.t += ms;
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
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

// ---------------------------------------------------------------------------------
// The inference loop (task 15.6).

/** The least time between the starts of two inferences, from TUNING (Req 4.3). */
const MIN_GAP_MS = 1000 / TUNING.maxInferenceHz;
/** The number of landmarks MediaPipe's pose model gives. */
const POSE_SIZE = 33;
const LANDMARK = { nose: 0, leftShoulder: 11, rightShoulder: 12, leftWrist: 15, rightWrist: 16 } as const;

/** A pose whose landmark i is at a position of its own, so that a wrong index shows. All are visible and in the frame. */
function distinctPose(size = POSE_SIZE): { x: number; y: number; visibility: number }[] {
  return Array.from({ length: size }, (_, i) => ({ x: (i + 1) / 40, y: (i + 1) / 50, visibility: 1 }));
}

async function runningHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const h = harness({ readyState: 4, ...opts });
  expect(await started(h)).toBe('ready');
  return h;
}

/** Time passes, the video shows a new picture, and the video frame callbacks run. */
async function tick(h: Harness, ms: number): Promise<void> {
  await h.advance(ms);
  h.setVideoTime(h.video.currentTime + 1);
  h.fireFrame();
}

function detectCalls(h: Harness): number {
  return h.landmarker.detectForVideo.mock.calls.length;
}

describe('the loop: which video frames are inferred (Req 4.2, 4.3)', () => {
  it('asks for no video frame until the source is ready, then for one, and the first picture is inferred with the clock as the timestamp', async () => {
    const h = harness({ readyState: 4 });
    expect(h.pendingFrames()).toBe(0);
    const outcome = h.source.start();
    await settle();
    expect(await outcome).toBe('ready');
    expect(h.pendingFrames()).toBe(1);
    await tick(h, 0);
    expect(detectCalls(h)).toBe(1);
    expect(h.landmarker.detectForVideo).toHaveBeenCalledWith(h.video, h.clock.t);
  });

  it('starts no inference less than 1000 / maxInferenceHz after the last one started, and starts one at exactly that time', async () => {
    const h = await runningHarness();
    await tick(h, 0);
    await tick(h, MIN_GAP_MS - 1);
    expect(detectCalls(h)).toBe(1);
    await tick(h, 1);
    expect(detectCalls(h)).toBe(2);
    // The gap counts from the start of an inference, not from a skipped frame.
    await tick(h, MIN_GAP_MS - 1);
    expect(detectCalls(h)).toBe(2);
    await tick(h, 1);
    expect(detectCalls(h)).toBe(3);
  });

  it('with frames far more often than the cap, never starts two inferences closer than the gap, and does not skip more than it must', async () => {
    const h = await runningHarness();
    const step = MIN_GAP_MS / 10;
    const frames = 400;
    for (let i = 0; i < frames; i++) await tick(h, step);
    const stamps = h.landmarker.detectForVideo.mock.calls.map((call) => call[1]);
    for (let i = 1; i < stamps.length; i++) expect((stamps[i] ?? 0) - (stamps[i - 1] ?? 0)).toBeGreaterThanOrEqual(MIN_GAP_MS);
    // 400 steps of a tenth of the gap are 40 gaps: the first frame plus one every gap.
    expect(stamps.length).toBe(Math.floor((frames * step) / MIN_GAP_MS));
    expect(stamps.length).toBeLessThanOrEqual((frames * step * TUNING.maxInferenceHz) / 1000);
  });

  it('infers a picture once: a callback with no new picture is skipped', async () => {
    const h = await runningHarness();
    await tick(h, 0);
    await h.advance(MIN_GAP_MS * 3);
    h.fireFrame();
    expect(detectCalls(h)).toBe(1);
    await tick(h, 0);
    expect(detectCalls(h)).toBe(2);
  });

  it('skips a video that has no picture or no size yet', async () => {
    const h = await runningHarness();
    h.setReadyState(1);
    await tick(h, 0);
    expect(detectCalls(h)).toBe(0);
    h.setReadyState(0);
    await tick(h, MIN_GAP_MS);
    expect(detectCalls(h)).toBe(0);
    h.setReadyState(4);
    await tick(h, MIN_GAP_MS);
    expect(detectCalls(h)).toBe(1);
  });

  it('asks for the next video frame at every callback, also when it skips the frame', async () => {
    const h = await runningHarness();
    expect(h.pendingFrames()).toBe(1);
    await tick(h, 0);
    expect(h.pendingFrames()).toBe(1);
    await tick(h, 1);
    expect(h.pendingFrames()).toBe(1);
  });

  it('drops the frames that come while an inference runs: they are not queued, and none is run late', async () => {
    const answer = deferred<{ landmarks: ReturnType<typeof distinctPose>[] }>();
    const h = await runningHarness();
    h.landmarker.detectForVideo.mockImplementation(() => answer.promise);
    await tick(h, 0);
    expect(detectCalls(h)).toBe(1);
    for (let i = 0; i < 5; i++) await tick(h, MIN_GAP_MS);
    expect(detectCalls(h)).toBe(1);
    answer.resolve({ landmarks: [distinctPose()] });
    await settle();
    expect(h.source.latest()).not.toBeNull();
    // Nothing waited: no inference starts until a frame comes.
    expect(detectCalls(h)).toBe(1);
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [] }));
    await tick(h, MIN_GAP_MS);
    expect(detectCalls(h)).toBe(2);
  });

  it('an inference that throws, or rejects, gives no frame, and the next picture is inferred', async () => {
    const h = await runningHarness();
    h.landmarker.detectForVideo.mockImplementationOnce(() => {
      throw new Error('bad frame');
    });
    await tick(h, 0);
    expect(h.source.latest()).toBeNull();
    h.landmarker.detectForVideo.mockImplementationOnce(() => Promise.reject(new Error('late failure')));
    await tick(h, MIN_GAP_MS);
    await settle();
    expect(h.source.latest()).toBeNull();
    await tick(h, MIN_GAP_MS);
    expect(detectCalls(h)).toBe(3);
    expect(h.source.latest()).not.toBeNull();
  });
});

describe('the default frame scheduler', () => {
  function sourceWith(video: HTMLVideoElement): ReturnType<typeof createCameraSource> {
    const stream = new FakeStream();
    return createCameraSource({
      basePath: BASE_PATH,
      video,
      getUserMedia: () => Promise.resolve(stream as unknown as MediaStream),
      createLandmarker: () => Promise.resolve(fakeLandmarker()),
      now: () => 0,
    });
  }
  function readyVideo(): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    video.play = () => Promise.resolve();
    return video;
  }

  it('asks the video for its next frame, and cancels that request when it stops', async () => {
    const video = readyVideo();
    const request = vi.fn<(callback: () => void) => number>(() => 7);
    const cancel = vi.fn();
    Object.assign(video, { requestVideoFrameCallback: request, cancelVideoFrameCallback: cancel });
    const animation = vi.spyOn(globalThis, 'requestAnimationFrame');
    const source = sourceWith(video);
    const outcome = source.start();
    await settle();
    expect(await outcome).toBe('ready');
    expect(request).toHaveBeenCalledTimes(1);
    expect(animation).not.toHaveBeenCalled();
    source.dispose();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('uses the animation frame where the video cannot give its frames', async () => {
    const video = readyVideo();
    Object.assign(video, { requestVideoFrameCallback: undefined });
    const animation = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(9);
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const source = sourceWith(video);
    const outcome = source.start();
    await settle();
    expect(await outcome).toBe('ready');
    expect(animation).toHaveBeenCalledTimes(1);
    source.dispose();
    expect(cancel).toHaveBeenCalledWith(9);
  });
});

describe('the loop: the frames (Req 2.3, 2.4, 2.6)', () => {
  it('takes the nose from 0, the shoulders from 11 and 12 and the wrists from 15 and 16, MediaPipe left on the left, with no mirroring', async () => {
    const h = await runningHarness();
    const pose = distinctPose();
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [pose] }));
    await tick(h, 0);
    const { landmarks } = h.source.latest() as PoseFrame;
    const pos = (i: number) => ({ x: pose[i]?.x, y: pose[i]?.y });
    expect(landmarks.nose.pos).toEqual(pos(LANDMARK.nose));
    expect(landmarks.leftShoulder.pos).toEqual(pos(LANDMARK.leftShoulder));
    expect(landmarks.rightShoulder.pos).toEqual(pos(LANDMARK.rightShoulder));
    expect(landmarks.leftWrist.pos).toEqual(pos(LANDMARK.leftWrist));
    expect(landmarks.rightWrist.pos).toEqual(pos(LANDMARK.rightWrist));
    for (const key of ['nose', 'leftShoulder', 'rightShoulder', 'leftWrist', 'rightWrist'] as const) {
      expect(landmarks[key].valid, key).toBe(true);
    }
  });

  it('needs no hips: a pose that stops at index 16 gives the five landmarks, and a shorter one gives invalid ones for what is missing', async () => {
    const h = await runningHarness();
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [distinctPose(LANDMARK.rightWrist + 1)] }));
    await tick(h, 0);
    const full = h.source.latest() as PoseFrame;
    expect(Object.values(full.landmarks).every((l) => l.valid)).toBe(true);
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [distinctPose(LANDMARK.rightShoulder + 1)] }));
    await tick(h, MIN_GAP_MS);
    const short = h.source.latest() as PoseFrame;
    expect(short.landmarks.nose.valid).toBe(true);
    expect(short.landmarks.leftShoulder.valid).toBe(true);
    expect(short.landmarks.leftWrist.valid).toBe(false);
    expect(short.landmarks.rightWrist.valid).toBe(false);
  });

  it('computes validity with isLandmarkValid: the visibility floor of TUNING and the edges of the frame', async () => {
    const h = await runningHarness();
    const cases: [string, { x: number; y: number; visibility?: number }, boolean][] = [
      ['visibility at the floor', { x: 0.5, y: 0.5, visibility: TUNING.minVisibility }, true],
      ['visibility just under the floor', { x: 0.5, y: 0.5, visibility: TUNING.minVisibility - 0.001 }, false],
      ['no visibility', { x: 0.5, y: 0.5 }, false],
      ['x at 0', { x: 0, y: 0.5, visibility: 1 }, true],
      ['x at 1', { x: 1, y: 0.5, visibility: 1 }, true],
      ['x below 0', { x: -0.001, y: 0.5, visibility: 1 }, false],
      ['x above 1', { x: 1.001, y: 0.5, visibility: 1 }, false],
      ['y at 0', { x: 0.5, y: 0, visibility: 1 }, true],
      ['y at 1', { x: 0.5, y: 1, visibility: 1 }, true],
      ['y below 0', { x: 0.5, y: -0.001, visibility: 1 }, false],
      ['y above 1', { x: 0.5, y: 1.001, visibility: 1 }, false],
    ];
    for (const [name, point, expected] of cases) {
      const pose = distinctPose();
      pose[LANDMARK.rightWrist] = point as (typeof pose)[number];
      h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [pose] }));
      await tick(h, MIN_GAP_MS);
      const wrist = (h.source.latest() as PoseFrame).landmarks.rightWrist;
      expect(wrist.valid, name).toBe(expected);
      expect(wrist.pos, name).toEqual({ x: point.x, y: point.y });
    }
  });

  it('makes a new frame object for each result, with t from the clock at the result and the aspect of the delivered video', async () => {
    const h = await runningHarness();
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [distinctPose()] }));
    await tick(h, 0);
    const first = h.source.latest() as PoseFrame;
    await tick(h, MIN_GAP_MS);
    const second = h.source.latest() as PoseFrame;
    expect(second).not.toBe(first);
    expect(second.landmarks).not.toBe(first.landmarks);
    expect(first.t).toBe(1000);
    expect(second.t).toBe(1000 + MIN_GAP_MS);
    expect(second.aspect).toBe(DELIVERED.width / DELIVERED.height);
  });

  it('stamps a frame with the clock at the moment its result arrives, not at the moment the inference started', async () => {
    const answer = deferred<{ landmarks: ReturnType<typeof distinctPose>[] }>();
    const h = await runningHarness();
    h.landmarker.detectForVideo.mockImplementation(() => answer.promise);
    await tick(h, 0);
    const startedAt = h.clock.t;
    h.clock.t += 123;
    answer.resolve({ landmarks: [distinctPose()] });
    await settle();
    expect(h.source.latest()?.t).toBe(startedAt + 123);
  });

  it('a result with no pose gives a new frame with every landmark invalid', async () => {
    const h = await runningHarness();
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [distinctPose()] }));
    await tick(h, 0);
    const seen = h.source.latest();
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [] }));
    await tick(h, MIN_GAP_MS);
    const lost = h.source.latest();
    expect(lost).not.toBe(seen);
    expect(everyLandmarkInvalid(lost)).toBe(true);
  });

  it('puts the pose from the first of the poses, and nothing of the others', async () => {
    const h = await runningHarness();
    const other = distinctPose().map((p) => ({ ...p, x: 0.9 }));
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [distinctPose(), other] }));
    await tick(h, 0);
    expect((h.source.latest() as PoseFrame).landmarks.nose.pos.x).toBe(distinctPose()[0]?.x);
  });
});

describe('the loop: the stale-frame guard (Req 4.8)', () => {
  async function withFrame(): Promise<{ h: Harness; frame: PoseFrame }> {
    const h = await runningHarness();
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [distinctPose()] }));
    await tick(h, 0);
    return { h, frame: h.source.latest() as PoseFrame };
  }

  it('gives exactly one new all-invalid frame after a stall: not at exactly staleFrameMs, at the first moment after it, and no more while the stall lasts', async () => {
    const { h, frame } = await withFrame();
    await h.advance(TUNING.staleFrameMs);
    expect(h.source.latest()).toBe(frame);
    await h.advance(1);
    const stale = h.source.latest();
    expect(stale).not.toBe(frame);
    expect(everyLandmarkInvalid(stale)).toBe(true);
    await h.advance(TUNING.staleFrameMs * 10);
    expect(h.source.latest()).toBe(stale);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the frame just before staleFrameMs has passed', async () => {
    const { h, frame } = await withFrame();
    await h.advance(TUNING.staleFrameMs - 1);
    expect(h.source.latest()).toBe(frame);
    expect(frame.landmarks.rightWrist.valid).toBe(true);
  });

  it('a timer that fires when the clock shows exactly staleFrameMs arms itself again for the rest, and the frame comes after it', async () => {
    const { h, frame } = await withFrame();
    // The timers run, but the clock lags: at the first firing the elapsed time is exactly staleFrameMs.
    h.clock.t += TUNING.staleFrameMs;
    await vi.advanceTimersByTimeAsync(TUNING.staleFrameMs + 1);
    expect(h.source.latest()).toBe(frame);
    expect(vi.getTimerCount()).toBe(1);
    h.clock.t += 1;
    await vi.advanceTimersByTimeAsync(1);
    const stale = h.source.latest();
    expect(stale).not.toBe(frame);
    expect(everyLandmarkInvalid(stale)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a real result after the stall gives a new valid frame, and a second stall gives a second invalid frame', async () => {
    const { h, frame } = await withFrame();
    await h.advance(TUNING.staleFrameMs + 1);
    const stale = h.source.latest();
    await tick(h, MIN_GAP_MS);
    const back = h.source.latest() as PoseFrame;
    expect(back).not.toBe(stale);
    expect(back).not.toBe(frame);
    expect(back.landmarks.rightWrist.valid).toBe(true);
    await h.advance(TUNING.staleFrameMs + 1);
    const second = h.source.latest();
    expect(second).not.toBe(back);
    expect(second).not.toBe(stale);
    expect(everyLandmarkInvalid(second)).toBe(true);
  });

  it('results that keep coming keep the guard quiet', async () => {
    const { h } = await withFrame();
    for (let i = 0; i < 30; i++) {
      await tick(h, TUNING.staleFrameMs / 2);
      expect((h.source.latest() as PoseFrame).landmarks.rightWrist.valid).toBe(true);
    }
  });

  it('a pose that is lost (an all-invalid result) is not made into a second frame by the guard', async () => {
    const { h } = await withFrame();
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [] }));
    await tick(h, MIN_GAP_MS);
    const lost = h.source.latest();
    await h.advance(TUNING.staleFrameMs * 3);
    expect(h.source.latest()).toBe(lost);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the loop: when it stops', () => {
  it('an ended camera stops the loop: the callback is cancelled, no timer is left, and no inference starts', async () => {
    const h = await runningHarness();
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [distinctPose()] }));
    await tick(h, 0);
    h.stream.tracks[0]?.end();
    expect(h.pendingFrames()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const ended = h.source.latest();
    await tick(h, MIN_GAP_MS);
    await h.advance(TUNING.staleFrameMs * 3);
    expect(detectCalls(h)).toBe(1);
    expect(h.source.latest()).toBe(ended);
    expect(everyLandmarkInvalid(ended)).toBe(true);
  });

  it('dispose stops the loop the same way', async () => {
    const h = await runningHarness();
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [distinctPose()] }));
    await tick(h, 0);
    h.source.dispose();
    expect(h.pendingFrames()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await tick(h, MIN_GAP_MS);
    expect(detectCalls(h)).toBe(1);
  });

  it('a result that arrives after dispose, or after the camera ended, is dropped', async () => {
    const answer = deferred<{ landmarks: ReturnType<typeof distinctPose>[] }>();
    const h = await runningHarness();
    h.landmarker.detectForVideo.mockImplementation(() => answer.promise);
    await tick(h, 0);
    h.source.dispose();
    answer.resolve({ landmarks: [distinctPose()] });
    await settle();
    expect(h.source.latest()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    const other = deferred<{ landmarks: ReturnType<typeof distinctPose>[] }>();
    const g = await runningHarness();
    g.landmarker.detectForVideo.mockImplementation(() => other.promise);
    await tick(g, 0);
    g.stream.tracks[0]?.end();
    const ended = g.source.latest();
    other.resolve({ landmarks: [distinctPose()] });
    await settle();
    expect(g.source.latest()).toBe(ended);
  });

  it('after an ended camera, a restart runs the loop again, and its first result replaces the invalid frame', async () => {
    const h = await runningHarness();
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [distinctPose()] }));
    await tick(h, 0);
    h.stream.tracks[0]?.end();
    const ended = h.source.latest();
    h.getUserMedia.mockImplementation(() => Promise.resolve(new FakeStream() as unknown as MediaStream));
    expect(await started(h)).toBe('ready');
    // The landmarker of the first run is closed; the factory gives the same fake again.
    expect(h.pendingFrames()).toBe(1);
    await tick(h, 0);
    const back = h.source.latest() as PoseFrame;
    expect(back).not.toBe(ended);
    expect(back.landmarks.rightWrist.valid).toBe(true);
  });

  it('a whole run with frames flowing sends nothing and stores nothing (Req 4.6)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const beacon = vi.fn();
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const open = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const h = await runningHarness();
    h.landmarker.detectForVideo.mockImplementation(() => ({ landmarks: [distinctPose()] }));
    for (let i = 0; i < 10; i++) await tick(h, MIN_GAP_MS);
    await h.advance(TUNING.staleFrameMs * 2);
    h.source.dispose();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});