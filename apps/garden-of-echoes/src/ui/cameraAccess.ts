// The camera request of the setup flow (requirements 3.2, 3.3). It is called only from the "Use the camera" click, through
// the effect of the setup state. It asks the browser for video, and it stops the stream at once: camera play is not built
// in this task, so no frame is read and nothing is kept. The devices are a parameter, so the tests pass a fake.
import type { CameraFailure, CameraOutcome } from '../session/setupState';

/** The part of the browser's media devices that the request uses. */
export interface CameraDevices {
  getUserMedia(constraints: { readonly video: boolean }): Promise<{ getTracks(): { stop(): void }[] }>;
}

/** Maps a failed request to the failure the setup shows. A denial is a denial; any other failure is a missing camera. */
export function failureOf(error: unknown): CameraFailure {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'no-camera';
}

/** Asks for the camera and stops it. Without a media API the outcome is no camera. It never throws. */
export async function requestCameraAccess(devices: CameraDevices | undefined = globalThis.navigator?.mediaDevices): Promise<CameraOutcome> {
  if (devices === undefined || typeof devices.getUserMedia !== 'function') return 'no-camera';
  try {
    const stream = await devices.getUserMedia({ video: true });
    for (const track of stream.getTracks()) track.stop();
    return 'ready';
  } catch (error) {
    return failureOf(error);
  }
}
