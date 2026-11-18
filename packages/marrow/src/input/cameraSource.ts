// The Camera Source (design sections 2.2 and 9.7, Req 3, 4, 5): MediaPipe pose input from
// the user-facing camera, behind the PoseSource contract. Everything that touches the
// outside world is passed in or can be replaced, so the source runs under jsdom with
// fakes: `getUserMedia`, the landmarker factory and the clock.
//
// Start (Req 5.1 to 5.5). `start()` is a plain function, not an async one, so that its first
// statement is the `getUserMedia` call: it runs inside the user's click, with no `await`
// before it. Then, in order:
// - the stream arrives. One time budget, `modelLoadTimeoutMs`, starts here and covers three
//   steps: the video's metadata, `play()`, and the landmarker. If the budget runs out, or
//   `play()` rejects, or the video reports an error, while the camera is being prepared, the
//   outcome is `no-camera`; if the landmarker is not ready in time or fails, it is
//   `model-failed`. In both cases every track is stopped and the stream is detached.
// - exactly one outcome per `start()`, whatever happens: the first of the steps to end it
//   decides, and later events (a landmarker that arrives late, a track that ends) change
//   nothing but the cleanup.
//
// Ended camera (Req 5.8). When a track ends while the source runs, the source releases the
// camera and the landmarker and publishes one new frame with every landmark invalid. That
// frame stays as `latest()` until `start()` runs again.
//
// Dispose (Req 3.3, 5.6): stops every track, detaches the stream from the video element,
// closes the landmarker, and does nothing on a second call.
//
// Nothing here sends, stores or records a frame or pose data (Req 4.6): no network call, no
// storage, and no copy of the video.
import { TUNING, type PoseFrame, type Tuning, type Vec2 } from '../core';
import type { PoseSource, StartOutcome } from './poseSource';

/** One landmark of a result, as MediaPipe reports it (a subset of `NormalizedLandmark`). */
export interface LandmarkLike {
  readonly x: number;
  readonly y: number;
  readonly visibility?: number;
}

/** What the source needs from a pose result: the landmarks of each detected pose. */
export interface LandmarkResultLike {
  readonly landmarks: readonly (readonly LandmarkLike[])[];
}

/** What the source needs from a Pose Landmarker; a real one fits it, and so does a test fake. */
export interface LandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): LandmarkResultLike | Promise<LandmarkResultLike>;
  close(): void;
}

export interface CameraSourceOptions {
  /** The base path of the app (for example `import.meta.env.BASE_URL`); the model files are loaded from under it (Req 4.4). */
  readonly basePath: string;
  /** The element the camera stream is attached to. */
  readonly video: HTMLVideoElement;
  /** `getUserMedia`; the default is the browser's. When there is none, `start()` reports `no-camera`. */
  readonly getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Creates the landmarker, loading the WASM files and the model from under `basePath`. */
  readonly createLandmarker: (basePath: string) => Promise<LandmarkerLike>;
  /** The source's monotonic clock in milliseconds; the default is `performance.now`. */
  readonly now?: () => number;
  /** The numbers of the tuning; the default is the shipped `TUNING`. */
  readonly tuning?: Tuning;
}

/** Why an attempt was cut short from outside the step it was waiting on. */
type CutReason = 'timeout' | 'disposed' | 'track-ended';

/** The thing an attempt's wait is rejected with when it is cut. */
class Cut extends Error {
  readonly reason: CutReason;
  constructor(reason: CutReason) {
    super(reason);
    this.reason = reason;
  }
}

/** Which step of a start an attempt is in, which decides the outcome of a failure. */
type Step = 'camera' | 'video' | 'model';

/** What one `start()` holds, from the stream to the landmarker. */
interface Attempt {
  stream: MediaStream | null;
  landmarker: LandmarkerLike | null;
  cut: CutReason | null;
  released: boolean;
  /** Rejects with a `Cut` when the attempt is cut. Never left unhandled. */
  readonly cutSignal: Promise<never>;
  readonly triggerCut: (reason: CutReason) => void;
  /** Undoes what the attempt added to the video and the tracks. */
  readonly cleanups: (() => void)[];
}

type Phase = 'idle' | 'starting' | 'running' | 'ended' | 'disposed';

const noop = (): void => undefined;
/** The position of an invalid landmark; it means nothing while `valid` is false. */
const UNUSED_POS: Vec2 = { x: 0, y: 0 };
/** `HTMLMediaElement.HAVE_METADATA`: the size and duration are known. */
const HAVE_METADATA = 1;

/** The `name` of whatever a promise rejected with, or '' when it has none. */
function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const { name } = error as { name: unknown };
    if (typeof name === 'string') return name;
  }
  return '';
}

/** The outcome of a `getUserMedia` failure (Req 5.3, 5.4). Any other failure is no camera that can be used. */
function outcomeOfCameraError(error: unknown): StartOutcome {
  const name = errorName(error);
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'no-camera';
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** The base path with one slash at its end, so that a path can be added to it. */
function withTrailingSlash(basePath: string): string {
  if (basePath === '') return '/';
  return basePath.endsWith('/') ? basePath : `${basePath}/`;
}

function invalidLandmark(): { pos: Vec2; valid: boolean } {
  return { pos: { x: UNUSED_POS.x, y: UNUSED_POS.y }, valid: false };
}

/** A new frame with every landmark invalid. */
function allInvalidFrame(t: number, aspect: number): PoseFrame {
  return {
    t,
    aspect,
    landmarks: {
      leftWrist: invalidLandmark(),
      rightWrist: invalidLandmark(),
      nose: invalidLandmark(),
      leftShoulder: invalidLandmark(),
      rightShoulder: invalidLandmark(),
    },
  };
}

export function createCameraSource(options: CameraSourceOptions): PoseSource {
  const { video, createLandmarker } = options;
  const tuning = options.tuning ?? TUNING;
  const now = options.now ?? (() => performance.now());
  const basePath = withTrailingSlash(options.basePath);
  const getUserMedia =
    options.getUserMedia ??
    (typeof navigator !== 'undefined' && navigator.mediaDevices !== undefined
      ? (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints)
      : undefined);

  let phase: Phase = 'idle';
  let pending: Promise<StartOutcome> | null = null;
  let current: Attempt | null = null;
  let frame: PoseFrame | null = null;
  /** The aspect of the delivered video; before it is known, the aspect that was asked for. */
  let aspect = tuning.cameraWidth / tuning.cameraHeight;

  function readAspect(): number {
    if (video.videoWidth > 0 && video.videoHeight > 0) aspect = video.videoWidth / video.videoHeight;
    return aspect;
  }

  function newAttempt(): Attempt {
    let reject: (reason: Cut) => void = noop;
    const cutSignal = new Promise<never>((_, rej) => {
      reject = rej;
    });
    cutSignal.catch(noop);
    const attempt: Attempt = {
      stream: null,
      landmarker: null,
      cut: null,
      released: false,
      cutSignal,
      triggerCut: (reason) => {
        if (attempt.cut !== null) return;
        attempt.cut = reason;
        reject(new Cut(reason));
      },
      cleanups: [],
    };
    return attempt;
  }

  /** Stops every track, detaches the stream, closes the landmarker. Safe to repeat. */
  function release(attempt: Attempt): void {
    if (attempt.released) return;
    attempt.released = true;
    for (const undo of attempt.cleanups.splice(0)) undo();
    if (attempt.stream !== null) {
      stopTracks(attempt.stream);
      if (video.srcObject === attempt.stream) video.srcObject = null;
    }
    const { landmarker } = attempt;
    attempt.landmarker = null;
    if (landmarker !== null) {
      try {
        landmarker.close();
      } catch {
        // A landmarker that fails to close has nothing more to release.
      }
    }
  }

  function onTrackEnded(attempt: Attempt): void {
    if (phase === 'starting') {
      attempt.triggerCut('track-ended');
      return;
    }
    if (phase !== 'running') return;
    phase = 'ended';
    release(attempt);
    current = null;
    frame = allInvalidFrame(now(), readAspect());
  }

  /** Waits for the video's metadata; rejects if the video reports an error. */
  function waitForMetadata(attempt: Attempt): Promise<void> {
    if (video.readyState >= HAVE_METADATA) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const onLoaded = (): void => resolve();
      const onError = (): void => reject(new Error('the video reported an error'));
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
      attempt.cleanups.push(() => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      });
    });
  }

  async function prepareVideo(attempt: Attempt, stream: MediaStream): Promise<void> {
    // Before the stream is attached, so that the browser may play it without a gesture
    // and on a phone without a full screen.
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = stream;
    await waitForMetadata(attempt);
    await video.play();
  }

  async function run(attempt: Attempt, request: Promise<MediaStream>): Promise<StartOutcome> {
    const guard = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, attempt.cutSignal]);
    let step: Step = 'camera';
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let stream: MediaStream;
      try {
        stream = await guard(request);
      } catch (error) {
        // Whoever cut the wait, a stream that arrives later must not keep the camera open.
        if (error instanceof Cut) request.then(stopTracks, noop);
        throw error;
      }
      attempt.stream = stream;
      for (const track of stream.getTracks()) {
        const onEnded = (): void => onTrackEnded(attempt);
        track.addEventListener('ended', onEnded);
        attempt.cleanups.push(() => track.removeEventListener('ended', onEnded));
      }
      // One budget for metadata, play() and the landmarker, from the moment the stream arrives.
      timer = setTimeout(() => attempt.triggerCut('timeout'), tuning.modelLoadTimeoutMs);
      step = 'video';
      await guard(prepareVideo(attempt, stream));
      step = 'model';
      const loading = Promise.resolve().then(() => createLandmarker(basePath));
      let landmarker: LandmarkerLike;
      try {
        landmarker = await guard(loading);
      } catch (error) {
        // A landmarker that arrives after the attempt is over is closed, not kept.
        if (error instanceof Cut) loading.then((late) => late.close(), noop);
        throw error;
      }
      if (attempt.cut !== null) {
        landmarker.close();
        throw new Cut(attempt.cut);
      }
      attempt.landmarker = landmarker;
      phase = 'running';
      readAspect();
      return 'ready';
    } catch (error) {
      release(attempt);
      if (error instanceof Cut && error.reason === 'timeout') return step === 'model' ? 'model-failed' : 'no-camera';
      if (error instanceof Cut) return 'no-camera';
      if (step === 'camera') return outcomeOfCameraError(error);
      return step === 'model' ? 'model-failed' : 'no-camera';
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return {
    start(): Promise<StartOutcome> {
      if (phase === 'disposed') return Promise.resolve('no-camera');
      if (pending !== null) return pending;
      if (phase === 'running') return Promise.resolve('ready');
      if (getUserMedia === undefined) return Promise.resolve('no-camera');
      phase = 'starting';
      const attempt = newAttempt();
      current = attempt;
      // The first statement of the start that does anything: the browser's permission
      // prompt needs it to run inside the user's click (Req 5.1).
      let request: Promise<MediaStream>;
      try {
        request = getUserMedia({
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: tuning.cameraWidth },
            height: { ideal: tuning.cameraHeight },
          },
          audio: false,
        });
      } catch (error) {
        request = Promise.reject(error);
      }
      const started = run(attempt, request).then((outcome) => {
        if (phase !== 'disposed') phase = outcome === 'ready' ? 'running' : 'idle';
        if (outcome !== 'ready' && current === attempt) current = null;
        if (pending === started) pending = null;
        return outcome;
      });
      pending = started;
      return started;
    },
    latest(): PoseFrame | null {
      return frame;
    },
    dispose(): void {
      if (phase === 'disposed') return;
      phase = 'disposed';
      const attempt = current;
      current = null;
      if (attempt !== null) {
        attempt.triggerCut('disposed');
        release(attempt);
      }
    },
  };
}
