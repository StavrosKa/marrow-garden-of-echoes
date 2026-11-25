// The camera request (requirements 3.2, 3.3). The devices are fakes, so no camera is touched.
import { describe, expect, it, vi } from 'vitest';
import { failureOf, requestCameraAccess, type CameraDevices } from './cameraAccess';

/** A fake camera whose request resolves to a stream of tracks, which the test can inspect. */
function devicesGranting(tracks: { stop: () => void }[]): CameraDevices {
  return { getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => tracks })) };
}

/** A fake camera whose request fails with the given error name. */
function devicesFailing(name: string): CameraDevices {
  const error = Object.assign(new Error(name), { name });
  return { getUserMedia: vi.fn(() => Promise.reject(error)) };
}

describe('the camera request (requirements 3.2, 3.3)', () => {
  it('3.2: a granted request is ready, and every track is stopped at once', async () => {
    const stopFirst = vi.fn();
    const stopSecond = vi.fn();
    const devices = devicesGranting([{ stop: stopFirst }, { stop: stopSecond }]);
    expect(await requestCameraAccess(devices)).toBe('ready');
    expect(devices.getUserMedia).toHaveBeenCalledWith({ video: true });
    expect(stopFirst).toHaveBeenCalledTimes(1);
    expect(stopSecond).toHaveBeenCalledTimes(1);
  });

  it('3.3: a refused request is a denial', async () => {
    expect(await requestCameraAccess(devicesFailing('NotAllowedError'))).toBe('denied');
    expect(await requestCameraAccess(devicesFailing('SecurityError'))).toBe('denied');
  });

  it('3.3: any other failure is a missing camera', async () => {
    expect(await requestCameraAccess(devicesFailing('NotFoundError'))).toBe('no-camera');
    expect(await requestCameraAccess(devicesFailing('OverconstrainedError'))).toBe('no-camera');
  });

  it('3.3: without a media API the outcome is no camera, and nothing throws', async () => {
    expect(await requestCameraAccess(undefined)).toBe('no-camera');
    expect(await requestCameraAccess({ getUserMedia: undefined as unknown as CameraDevices['getUserMedia'] })).toBe('no-camera');
  });

  it('3.3: failureOf reads the error name, and gives no camera for an error with no name', () => {
    expect(failureOf({ name: 'NotAllowedError' })).toBe('denied');
    expect(failureOf(new Error('x'))).toBe('no-camera');
    expect(failureOf('not an error')).toBe('no-camera');
  });
});
