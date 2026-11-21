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
// The inference loop (Req 2.3, 2.6, 4.1 to 4.3, 4.8). Once the source is ready it asks the
// scheduler for a callback at each video frame, and each callback is judged in turn:
// - an inference is already running: the frame is dropped, never queued (Req 4.2). With the
//   synchronous detectForVideo of MediaPipe 1.2.3 an inference cannot overlap another, so
//   this only matters for a landmarker that answers later, as a fake in a test does;
// - the video has no data yet, or the same picture as the last inference: skipped;
// - less than 1000 / maxInferenceHz milliseconds since the last inference started: skipped,
//   so an inference never starts more often than the cap (Req 4.3). On a 30 fps camera that
//   gives every second frame, 15 Hz: the cap is a ceiling, not a target.
// Otherwise one inference runs, with the clock's time as its timestamp. Each result becomes
// a new PoseFrame (landmarks 0, 11, 12, 15 and 16, MediaPipe "left" on the player's left
// side, validity from isLandmarkValid, positions as the camera gives them) and goes
// through the stale-frame helper. A timer armed at each result calls the helper when no
// result comes: it fires after staleFrameMs, and if the clock does not yet show more than
// staleFrameMs it arms itself again for the rest, until the stall is seen, so a stalled
// model, or a video that stops delivering frames, gives one new all-invalid frame (Req 4.8).
//
// Nothing here sends, stores or records a frame or pose data (Req 4.6): no network call, no
// storage, and no copy of the video.
import { LANDMARK_INDEX, TUNING, isLandmarkValid, type PoseFrame, type Tuning, type Vec2 } from '../core';
import { withTrailingSlash } from './mediapipeUrls';
import type { PoseSource, StartOutcome } from './poseSource';
import { exposeFrame } from './staleFrame';

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
  /** Creates the landmarker, loading the WASM files and the model from under `basePath`. The default is MediaPipe's Pose Landmarker (lite). */
  readonly createLandmarker?: (basePath: string) => Promise<LandmarkerLike>;
  /** Asks for `callback` at the next video frame; returns a function that cancels the request. The default is `requestVideoFrameCallback`, or an animation frame. */
  readonly scheduleFrame?: (video: HTMLVideoElement, callback: () => void) => () => void;
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
/** `HTMLMediaElement.HAVE_CURRENT_DATA`: the picture at the current time is there. */
const HAVE_CURRENT_DATA = 2;
const MS_PER_SECOND = 1000;
/** Added to the stale timer so that it fires at the first millisecond that is more than `staleFrameMs`. */
const STALE_MARGIN_MS = 1;

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

/** The default `scheduleFrame`: the next frame of the video, or, where the browser cannot tell, the next animation frame. */
function scheduleVideoFrame(video: HTMLVideoElement, callback: () => void): () => void {
  if (typeof video.requestVideoFrameCallback === 'function') {
    const handle = video.requestVideoFrameCallback(() => callback());
    return () => video.cancelVideoFrameCallback(handle);
  }
  const handle = requestAnimationFrame(() => callback());
  return () => cancelAnimationFrame(handle);
}

/**
 * The default `createLandmarker`: MediaPipe, loaded only now, in a chunk of its own. The GPU delegate
 * is tried first; only its failure leads to the CPU delegate (design 11, decided 2026-11-21). A CPU
 * failure rejects like any model failure. Both attempts share the model-load budget of `start()`.
 */
async function createMediapipeLandmarker(basePath: string): Promise<LandmarkerLike> {
  const { createPoseLandmarker } = await import('./poseLandmarker');
  try {
    return await createPoseLandmarker(basePath, { delegate: 'GPU' });
  } catch {
    return createPoseLandmarker(basePath, { delegate: 'CPU' });
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';
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
  const { video } = options;
  const createLandmarker = options.createLandmarker ?? createMediapipeLandmarker;
  const scheduleFrame = options.scheduleFrame ?? scheduleVideoFrame;
  const tuning = options.tuning ?? TUNING;
  const now = options.now ?? (() => performance.now());
  const basePath = withTrailingSlash(options.basePath);
  /** The least time between the starts of two inferences (Req 4.3). */
  const minGapMs = MS_PER_SECOND / tuning.maxInferenceHz;
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

  // The inference loop's state; it belongs to the one attempt that is running.
  let cancelFrame: (() => void) | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let lastStartAt = Number.NEGATIVE_INFINITY;
  let lastVideoTime = Number.NaN;
  let lastResultAt = 0;

  function readAspect(): number {
    if (video.videoWidth > 0 && video.videoHeight > 0) aspect = video.videoWidth / video.videoHeight;
    return aspect;
  }

  function stopLoop(): void {
    cancelFrame?.();
    cancelFrame = null;
    clearTimeout(staleTimer);
    staleTimer = undefined;
    busy = false;
  }

  function isRunning(attempt: Attempt): boolean {
    return phase === 'running' && current === attempt && attempt.landmarker !== null;
  }

  /** One landmark of the pose: its position as the camera gives it, and whether it can be used (Req 2.4, 2.6). */
  function landmarkOf(pose: readonly LandmarkLike[] | undefined, index: number): { pos: Vec2; valid: boolean } {
    const point = pose?.[index];
    if (point === undefined) return invalidLandmark();
    const pos = { x: point.x, y: point.y };
    return { pos, valid: isLandmarkValid(point.visibility ?? 0, pos, tuning) };
  }

  /** The new frame for a result: five landmarks from their indices, MediaPipe's "left" on the player's left (Req 2.3). */
  function frameOf(result: LandmarkResultLike, t: number): PoseFrame {
    const pose = result.landmarks[0];
    return {
      t,
      aspect: readAspect(),
      landmarks: {
        leftWrist: landmarkOf(pose, LANDMARK_INDEX.leftWrist),
        rightWrist: landmarkOf(pose, LANDMARK_INDEX.rightWrist),
        nose: landmarkOf(pose, LANDMARK_INDEX.nose),
        leftShoulder: landmarkOf(pose, LANDMARK_INDEX.leftShoulder),
        rightShoulder: landmarkOf(pose, LANDMARK_INDEX.rightShoulder),
      },
    };
  }

  function armStale(attempt: Attempt, delayMs: number): void {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => checkStale(attempt), delayMs);
  }

  /** Runs when no result has come for a while: the stale-frame helper decides (Req 4.8). */
  function checkStale(attempt: Attempt): void {
    staleTimer = undefined;
    if (!isRunning(attempt)) return;
    const elapsed = now() - lastResultAt;
    const next = exposeFrame(frame, null, elapsed, tuning);
    if (next !== frame) {
      frame = next;
      return;
    }
    // Not stale yet (the timer fired early, or at exactly staleFrameMs): wait for the rest.
    // Already stale and unchanged means the frame is all-invalid already: once per stall.
    if (elapsed > tuning.staleFrameMs) return;
    armStale(attempt, Math.max(tuning.staleFrameMs - elapsed, 0) + STALE_MARGIN_MS);
  }

  function publish(attempt: Attempt, result: LandmarkResultLike): void {
    busy = false;
    if (!isRunning(attempt)) return;
    const t = now();
    frame = exposeFrame(frame, frameOf(result, t), 0, tuning);
    lastResultAt = t;
    armStale(attempt, tuning.staleFrameMs + STALE_MARGIN_MS);
  }

  function infer(attempt: Attempt, landmarker: LandmarkerLike, t: number): void {
    lastStartAt = t;
    lastVideoTime = video.currentTime;
    busy = true;
    let answer: LandmarkResultLike | Promise<LandmarkResultLike>;
    try {
      answer = landmarker.detectForVideo(video, t);
    } catch {
      // An inference that fails gives no result; the stale-frame guard turns that into lost tracking.
      busy = false;
      return;
    }
    if (isPromiseLike(answer)) {
      answer.then(
        (result) => publish(attempt, result),
        () => {
          busy = false;
        },
      );
    } else {
      publish(attempt, answer);
    }
  }

  /** One video frame. The next one is asked for first, so that frames that come during an inference are seen, and dropped, not queued. */
  function onVideoFrame(attempt: Attempt): void {
    cancelFrame = null;
    if (!isRunning(attempt)) return;
    cancelFrame = scheduleFrame(video, () => onVideoFrame(attempt));
    const { landmarker } = attempt;
    if (landmarker === null || busy) return;
    if (video.readyState < HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    if (video.currentTime === lastVideoTime) return;
    const t = now();
    if (t - lastStartAt < minGapMs) return;
    infer(attempt, landmarker, t);
  }

  function startLoop(attempt: Attempt): void {
    busy = false;
    lastStartAt = Number.NEGATIVE_INFINITY;
    lastVideoTime = Number.NaN;
    cancelFrame = scheduleFrame(video, () => onVideoFrame(attempt));
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
    stopLoop();
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
      startLoop(attempt);
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
