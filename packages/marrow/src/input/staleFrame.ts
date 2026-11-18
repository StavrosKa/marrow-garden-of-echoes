// The stale-frame guard (design section 9.7, Req 4.8), as a pure helper for the Camera
// Source. The driver detects a new frame only by the reference of `source.latest()`, so
// a stalled model, with the camera track still open, would leave the last frame exposed
// with every landmark still valid. After `staleFrameMs` without a result the helper
// returns a new frame object with every landmark invalid, so the pointer turns invalid
// and the tracking lifecycle can begin a hold. When a result arrives, it is returned as
// it is, a new frame with its validity as the source computed it.
//
// Pure: the elapsed time comes from the caller, the helper reads no clock, and it
// changes none of its arguments.
import type { PoseFrame, PoseLandmarks, Tuning } from '../core';

const LANDMARK_NAMES = [
  'leftWrist',
  'rightWrist',
  'nose',
  'leftShoulder',
  'rightShoulder',
] as const satisfies readonly (keyof PoseLandmarks)[];

function everyLandmarkInvalid(frame: PoseFrame): boolean {
  return LANDMARK_NAMES.every((name) => !frame.landmarks[name].valid);
}

/** A new frame like `frame`, at time `t`, with every landmark invalid. Nothing is shared with `frame`. */
function invalidCopy(frame: PoseFrame, t: number): PoseFrame {
  const copy = (name: keyof PoseLandmarks) => {
    const { pos } = frame.landmarks[name];
    return { pos: { x: pos.x, y: pos.y }, valid: false };
  };
  return {
    t,
    aspect: frame.aspect,
    landmarks: {
      leftWrist: copy('leftWrist'),
      rightWrist: copy('rightWrist'),
      nose: copy('nose'),
      leftShoulder: copy('leftShoulder'),
      rightShoulder: copy('rightShoulder'),
    },
  };
}

/**
 * The frame to expose next.
 *
 * - `incoming` is a new inference result: it is exposed as it is. Each result must be a
 *   new object, which the Camera Source makes it.
 * - No result, and the last one is `staleFrameMs` old or less (`elapsedMs > staleFrameMs`
 *   is false, so exactly `staleFrameMs` is not stale, as Req 4.8 says "longer than"): the
 *   previous frame stays.
 * - No result, and the last one is older than `staleFrameMs`: a new frame with every
 *   landmark invalid, at time `previous.t + elapsedMs`. The caller passes that frame as
 *   `previous` on the next call, and because every landmark is already invalid in it, it
 *   stays exposed: one new frame per stall, until a result arrives.
 * - Nothing exposed yet (`previous` null) and no result: nothing.
 *
 * @param previous the frame exposed now, or null before the first result
 * @param incoming the new result, or null when none arrived
 * @param elapsedMs milliseconds since the last result, from the caller's clock
 */
export function exposeFrame(
  previous: PoseFrame | null,
  incoming: PoseFrame | null,
  elapsedMs: number,
  tuning: Pick<Tuning, 'staleFrameMs'>,
): PoseFrame | null {
  if (incoming !== null) return incoming;
  if (previous === null) return null;
  if (!(elapsedMs > tuning.staleFrameMs)) return previous;
  if (everyLandmarkInvalid(previous)) return previous;
  return invalidCopy(previous, previous.t + elapsedMs);
}
