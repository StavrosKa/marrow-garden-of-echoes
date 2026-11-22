// The frame driver of the input playground (design section 3, Req 2.7, 8.2, 8.4, 9, 10, 11, 16.7, 17, 18).
// `stepFrameDriver` is one pure step for one animation frame. `startFrameLoop` is the thin
// requestAnimationFrame loop around it.
//
// Order within one step (the order the user approved for 17.5):
//   1. presenceDelta from the raw delta and the paused and hidden flags.
//   2. Read the latest frame and check it by reference. A frame is new when it is not the frame last
//      consumed. The timestamp is never read (Req 2.7). A frame seen while paused or hidden is not consumed,
//      so the first frame after resume is still new.
//   3. Tracking on this tick's validity and presenceDt, then sessionDelta from this step's hold (Req 16.5, 18).
//   4. Head view on this tick's landmarks and presenceDt (Req 9). Its offset is output only.
//   5. On a consumed frame: the pointer filter with the presence time since the last consumed frame (Req 8.2),
//      and calibration with frameConsumed. In simulated input the filter is skipped (Req 6.3).
//   6. The one Mapping, rebuilt only when the calibration transform changes, and the screen pointers.
//   7. Dwell on presenceDt with the screen pointers and the hit areas of this tick (Req 17).
import {
  chooseWholeScreen,
  createCalibration,
  createDwell,
  createHeadView,
  createPointerFilter,
  createTracking,
  makeMapping,
  presenceDelta,
  resetPointerFilter,
  retryCalibration,
  sessionDelta,
  skipHeadView,
  stepCalibration,
  stepDwell,
  stepHeadView,
  stepPointerFilter,
  stepTracking,
  type CalibrationInput,
  type CalibrationMode,
  type CalibrationResult,
  type CalibrationState,
  type Demand,
  type DwellEvent,
  type DwellState,
  type HeadViewInput,
  type HeadViewState,
  type HitArea,
  type Mapping,
  type MappingParams,
  type PointerFilterState,
  type PointerInput,
  type PointerSample,
  type PoseFrame,
  type PoseLandmarks,
  type Landmark,
  type TrackingEvent,
  type TrackingState,
  type Tuning,
  type Vec2,
  type WristId,
} from 'marrow/core';

/** The pointers of the calibration: camera space, filtered, held between consumed frames. */
type CameraPointers = CalibrationInput['pointers'];

/** The play-area centre is half of each side, in screen units (glossary). */
const HALF = 0.5;
/** Gain 1 is the identity scale of the base mapping (Req 6.3, 11.4). */
const BASE_GAIN = 1;
const NO_LANDMARK: Landmark = { pos: { x: 0, y: 0 }, valid: false };
const NO_LANDMARKS: PoseLandmarks = {
  leftWrist: NO_LANDMARK,
  rightWrist: NO_LANDMARK,
  nose: NO_LANDMARK,
  leftShoulder: NO_LANDMARK,
  rightShoulder: NO_LANDMARK,
};
const ORIGIN: Vec2 = { x: 0, y: 0 };

/** The fixed setup of one playground run. Nothing here changes while the run lasts. */
export interface DriverConfig {
  readonly mode: CalibrationMode;
  /** The wrists the run uses: the player's choice in camera mode, the right wrist in simulated input. */
  readonly activeWrists: readonly WristId[];
  /** A: the play area's width over its height. */
  readonly playAspect: number;
  /** a: the camera frame's aspect, or the play aspect in simulated input. */
  readonly frameAspect: number;
  /** The Placement request of the calibration's end-of-painting check (design section 14.2). */
  readonly demand: Demand;
  readonly tuning: Tuning;
}

/** Everything one step keeps from the one before. */
export interface DriverState {
  readonly config: DriverConfig;
  readonly calibration: CalibrationState;
  readonly head: HeadViewState;
  readonly tracking: TrackingState;
  readonly dwell: DwellState;
  readonly filter: PointerFilterState;
  /** The one Mapping of the run, used for every active wrist. */
  readonly mapping: Mapping;
  /** The parameters `mapping` was built from, to tell when a new one is needed. */
  readonly mappingParams: MappingParams;
  /** The filtered camera-space pointers from the last consumed frame. */
  readonly cameraPointers: CameraPointers;
  /** The newest frame that was consumed, by reference. */
  readonly lastFrame: PoseFrame | null;
  /** The driver's clock at the tick that first drew `lastFrame`, or null before any frame. */
  readonly frameDrawnAtMs: number | null;
  /** Presence time since the last consumed frame (Req 8.2). */
  readonly sinceConsumedMs: number;
  /** Whether the previous tick was paused or hidden. A change to running resets the filter (Req 8.4). */
  readonly frozen: boolean;
}

/** One tick's input: the raw delta and flags, the newest frame, and the open hit areas. */
export interface DriverInput {
  /** The raw delta in milliseconds, from the frame timestamps (clamped by the Clocks). */
  readonly rawDtMs: number;
  readonly paused: boolean;
  readonly hidden: boolean;
  /** `source.latest()`, or null before the first frame. */
  readonly frame: PoseFrame | null;
  /** The driver's clock at this tick. It is recorded as the draw time of a new frame, never read from `frame.t`. */
  readonly drawAtMs: number;
  /** The hit areas of the targets that are still open. */
  readonly hitAreas: readonly HitArea[];
}

/** What one step returns to the caller, and what the playground draws. */
export interface DriverStep {
  readonly state: DriverState;
  /** The screen pointers of the active wrists, held between consumed frames. */
  readonly pointers: readonly PointerInput[];
  /** The head offset, in -1..1 on each axis. It never reaches pointers, hit areas, dwell or tracking. */
  readonly headOffset: Vec2;
  readonly presenceDt: number;
  readonly sessionDt: number;
  readonly holdActive: boolean;
  readonly overlayVisible: boolean;
  readonly oneWristHint: boolean;
  readonly trackingEvents: readonly TrackingEvent[];
  /** Whether this tick consumed a new frame. */
  readonly newFrame: boolean;
  /** The draw time of `state.lastFrame`, or null before the first frame. */
  readonly frameDrawnAtMs: number | null;
  readonly dwellEvents: readonly DwellEvent[];
  /** Whether calibration completed in this step. */
  readonly calibrationCompleted: boolean;
}

/** The calibration controls that change the state outside a tick. */
export type DriverAction = { readonly kind: 'retry' } | { readonly kind: 'wholeScreen' } | { readonly kind: 'skipHeadView' };

function landmarkOf(landmarks: PoseLandmarks, wrist: WristId): Landmark {
  return wrist === 'left' ? landmarks.leftWrist : landmarks.rightWrist;
}

function samplesOf(landmarks: PoseLandmarks, wrists: readonly WristId[]): PointerSample {
  const sample: { [W in WristId]?: Landmark } = {};
  for (const wrist of wrists) sample[wrist] = landmarkOf(landmarks, wrist);
  return sample;
}

/** Simulated input: the pointer's camera position goes through without the filter (Req 6.3). */
function unfilteredPointers(landmarks: PoseLandmarks, wrists: readonly WristId[]): CameraPointers {
  const out: { [W in WristId]?: NonNullable<CameraPointers[W]> } = {};
  for (const wrist of wrists) {
    const landmark = landmarkOf(landmarks, wrist);
    out[wrist] = landmark.valid ? { valid: true, pos: landmark.pos } : { valid: false };
  }
  return out;
}

function toScreenInputs(pointers: CameraPointers, wrists: readonly WristId[], mapping: Mapping): PointerInput[] {
  return wrists.map((wrist): PointerInput => {
    const pointer = pointers[wrist];
    if (pointer !== undefined && pointer.valid) return { wrist, valid: true, pos: mapping.toScreen(pointer.pos) };
    return { wrist, valid: false };
  });
}

/** The transform of the run before calibration completes: gain 1 and the play-area centre (Req 11.11). */
function baseTransform(playAspect: number): CalibrationResult['transform'] {
  return { gain: BASE_GAIN, centre: { x: playAspect * HALF, y: HALF } };
}

function paramsFor(config: DriverConfig, transform: CalibrationResult['transform']): MappingParams {
  return {
    playAspect: config.playAspect,
    frameAspect: config.frameAspect,
    gain: transform.gain,
    centre: transform.centre,
  };
}

function sameParams(a: MappingParams, b: MappingParams): boolean {
  return (
    a.playAspect === b.playAspect &&
    a.frameAspect === b.frameAspect &&
    a.gain === b.gain &&
    a.centre.x === b.centre.x &&
    a.centre.y === b.centre.y
  );
}

/** Keeps the current Mapping unless the transform changed, so every wrist shares one object. */
function mappingFor(
  current: { readonly mapping: Mapping; readonly mappingParams: MappingParams },
  config: DriverConfig,
  transform: CalibrationResult['transform'],
): { readonly mapping: Mapping; readonly mappingParams: MappingParams } {
  const params = paramsFor(config, transform);
  if (sameParams(params, current.mappingParams)) return current;
  return { mapping: makeMapping(params), mappingParams: params };
}

/** The state before the first frame: painting not started, no frame, no hold, the base mapping. */
export function createDriver(config: DriverConfig): DriverState {
  const { tuning } = config;
  const params = paramsFor(config, baseTransform(config.playAspect));
  return {
    config,
    calibration: createCalibration({
      activeWrists: config.activeWrists,
      mode: config.mode,
      demand: config.demand,
      frameAspect: config.frameAspect,
      playAspect: config.playAspect,
      tuning,
    }),
    head: createHeadView(),
    tracking: createTracking({ activeWrists: config.activeWrists, mode: config.mode, tuning }),
    dwell: createDwell(tuning),
    filter: createPointerFilter(tuning),
    mapping: makeMapping(params),
    mappingParams: params,
    cameraPointers: {},
    lastFrame: null,
    frameDrawnAtMs: null,
    sinceConsumedMs: 0,
    frozen: false,
  };
}

/** One step for one animation frame (design section 3). The state and the input are only read. */
export function stepFrameDriver(state: DriverState, input: DriverInput): DriverStep {
  const { config } = state;
  const { tuning } = config;
  const simulated = config.mode === 'simulated';
  const frozen = input.paused || input.hidden;
  const resumed = state.frozen && !frozen;
  const presenceDt = presenceDelta(input.rawDtMs, { paused: input.paused, hidden: input.hidden }, tuning);

  // Step 2: the newest frame, checked by reference (Req 2.7).
  const frame = input.frame;
  const landmarks = frame === null ? NO_LANDMARKS : frame.landmarks;
  const newFrame = frame !== null && frame !== state.lastFrame;
  const consumed = newFrame && !frozen;

  // Step 3: tracking on this tick's validity, then the session delta from this step's hold.
  const trackingStep = stepTracking(
    state.tracking,
    {
      wristValid: { left: landmarks.leftWrist.valid, right: landmarks.rightWrist.valid },
      noseValid: landmarks.nose.valid,
      calibrating: state.calibration.phase !== 'complete',
    },
    presenceDt,
  );
  const sessionDt = sessionDelta(presenceDt, trackingStep.holdActive);

  // Step 4: head view on this tick's landmarks. The simulated pointer is in screen space (Req 6.7).
  const result = state.calibration.result;
  const neutral = result === null ? null : result.head;
  const skip = result !== null && result.head === null;
  const headInput: HeadViewInput = simulated
    ? {
        mode: 'simulated',
        tuning,
        landmarks,
        frameAspect: config.frameAspect,
        neutral,
        skip,
        playAspect: config.playAspect,
        pointer: {
          valid: landmarks.rightWrist.valid,
          pos: landmarks.rightWrist.valid ? state.mapping.toScreen(landmarks.rightWrist.pos) : ORIGIN,
        },
      }
    : { mode: 'camera', tuning, landmarks, frameAspect: config.frameAspect, neutral, skip };
  const head = stepHeadView(state.head, headInput, presenceDt);

  // Step 5: the filter on a consumed frame, with the presence time since the last consumed one.
  let filter = resumed ? resetPointerFilter(state.filter) : state.filter;
  let sinceConsumedMs = resumed ? 0 : state.sinceConsumedMs;
  let cameraPointers = state.cameraPointers;
  let lastFrame = state.lastFrame;
  let frameDrawnAtMs = state.frameDrawnAtMs;
  if (consumed && frame !== null) {
    if (simulated) {
      cameraPointers = unfilteredPointers(frame.landmarks, config.activeWrists);
    } else {
      const filtered = stepPointerFilter(filter, samplesOf(frame.landmarks, config.activeWrists), sinceConsumedMs + presenceDt);
      filter = filtered.state;
      cameraPointers = filtered.pointers;
    }
    sinceConsumedMs = 0;
    lastFrame = frame;
    frameDrawnAtMs = input.drawAtMs;
  } else {
    sinceConsumedMs += presenceDt;
  }

  let calibration = state.calibration;
  let calibrationCompleted = false;
  if (calibration.phase !== 'complete') {
    const step = stepCalibration(
      calibration,
      { pointers: cameraPointers, frameConsumed: consumed, head: landmarks },
      presenceDt,
    );
    calibration = step.state;
    calibrationCompleted = step.events.some((event) => event.kind === 'completed');
  }

  // Step 6: one Mapping for every wrist, rebuilt only when the transform changed.
  const transform = calibration.result === null ? baseTransform(config.playAspect) : calibration.result.transform;
  const { mapping, mappingParams } = mappingFor(state, config, transform);
  const pointers = toScreenInputs(cameraPointers, config.activeWrists, mapping);

  // Step 7: dwell on presence time, with the pointers of this tick and the open hit areas.
  const dwell = stepDwell(state.dwell, { dt: presenceDt, pointers, hitAreas: input.hitAreas });

  const next: DriverState = {
    config,
    calibration,
    head: head.state,
    tracking: trackingStep.state,
    dwell: dwell.state,
    filter,
    mapping,
    mappingParams,
    cameraPointers,
    lastFrame,
    frameDrawnAtMs,
    sinceConsumedMs,
    frozen,
  };
  return {
    state: next,
    pointers,
    headOffset: head.offset,
    presenceDt,
    sessionDt,
    holdActive: trackingStep.holdActive,
    overlayVisible: trackingStep.overlayVisible,
    oneWristHint: trackingStep.oneWristHint,
    trackingEvents: trackingStep.events,
    newFrame: consumed,
    frameDrawnAtMs,
    dwellEvents: dwell.events,
    calibrationCompleted,
  };
}

/**
 * A calibration control from the screen. The result says whether calibration completed, so the caller can
 * place the targets. Retry also clears the head view, which keeps no data of an earlier painting.
 */
export function applyDriverAction(state: DriverState, action: DriverAction): { state: DriverState; completed: boolean } {
  const step =
    action.kind === 'retry'
      ? retryCalibration(state.calibration)
      : action.kind === 'wholeScreen'
        ? chooseWholeScreen(state.calibration)
        : skipHeadView(state.calibration);
  const completed = step.events.some((event) => event.kind === 'completed');
  return {
    state: {
      ...state,
      calibration: step.state,
      head: action.kind === 'retry' ? createHeadView() : state.head,
    },
    completed,
  };
}

/** What the loop reads at the start of each tick. */
export interface FrameReading {
  readonly paused: boolean;
  readonly hidden: boolean;
  readonly frame: PoseFrame | null;
  readonly hitAreas: readonly HitArea[];
}

export interface FrameLoopOptions {
  /** The state to step, or null while no calibration run exists. An idle loop keeps asking for frames and steps nothing. */
  readonly initial: DriverState | null;
  /** Called on every tick with the tick's frame time. Its reading is the input of that tick. */
  readonly read: (timestampMs: number) => FrameReading;
  readonly onStep: (step: DriverStep) => void;
  readonly requestFrame: (callback: (timestampMs: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
}

export interface FrameLoop {
  /** The current state, or null while idle. */
  readonly state: () => DriverState | null;
  /** Replaces the state. The next tick has raw delta 0, so a new run does not count the time before it. */
  readonly replace: (next: DriverState | null) => void;
  /** Applies a calibration control. Returns whether calibration completed; false while idle. */
  readonly act: (action: DriverAction) => boolean;
  /** Stops the loop and cancels the pending frame. Calling it again does nothing. */
  readonly stop: () => void;
}

/**
 * Runs `stepFrameDriver` once per animation frame. The first tick of a run has raw delta 0; later ticks use the
 * difference of the frame timestamps, which the Clocks clamp.
 */
export function startFrameLoop(options: FrameLoopOptions): FrameLoop {
  let state: DriverState | null = options.initial;
  let previousMs: number | null = null;
  let pending: number | null = null;
  let stopped = false;
  const tick = (timestampMs: number): void => {
    pending = null;
    if (stopped) return;
    // `read` runs on every tick, idle or not, so a caller can start a run from the frame it reads (the camera
    // start of 17.8). The raw delta is taken after it, so a run that starts in this tick counts 0.
    const reading = options.read(timestampMs);
    if (state !== null) {
      const rawDtMs = previousMs === null ? 0 : timestampMs - previousMs;
      const step = stepFrameDriver(state, {
        rawDtMs,
        paused: reading.paused,
        hidden: reading.hidden,
        frame: reading.frame,
        drawAtMs: timestampMs,
        hitAreas: reading.hitAreas,
      });
      state = step.state;
      options.onStep(step);
    }
    previousMs = timestampMs;
    if (!stopped) pending = options.requestFrame(tick);
  };
  pending = options.requestFrame(tick);
  return {
    state: () => state,
    replace: (next) => {
      state = next;
      previousMs = null;
    },
    act: (action) => {
      if (state === null) return false;
      const result = applyDriverAction(state, action);
      state = result.state;
      return result.completed;
    },
    stop: () => {
      stopped = true;
      if (pending !== null) options.cancelFrame(pending);
      pending = null;
    },
  };
}
