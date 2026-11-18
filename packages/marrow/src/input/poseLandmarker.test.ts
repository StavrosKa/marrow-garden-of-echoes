// @vitest-environment jsdom
// Tests for where the Camera Source loads MediaPipe's files from (Req 4.1, 4.4), with a fake
// `@mediapipe/tasks-vision`: the real library, the real model and the real WASM files are
// never loaded. Every URL the loader is given is read from the fake.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const landmarker = { detectForVideo: () => ({ landmarks: [] }), close: () => undefined };
  return {
    landmarker,
    forVisionTasks: vi.fn((folder: string) =>
      Promise.resolve({ wasmLoaderPath: `${folder}/vision_wasm_internal.js`, wasmBinaryPath: `${folder}/vision_wasm_internal.wasm` }),
    ),
    createFromOptions: vi.fn<(fileset: unknown, options: unknown) => Promise<unknown>>(() => Promise.resolve(landmarker)),
  };
});

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: fake.forVisionTasks },
  PoseLandmarker: { createFromOptions: fake.createFromOptions },
}));

import { createCameraSource } from './cameraSource';
import { mediapipeUrls } from './mediapipeUrls';
import { createPoseLandmarker } from './poseLandmarker';

beforeEach(() => {
  fake.forVisionTasks.mockClear();
  fake.createFromOptions.mockClear();
});

/** Every URL the fake library was asked to load, for the WASM folder and the model. */
function loadedUrls(): string[] {
  const options = fake.createFromOptions.mock.calls[0]?.[1] as { baseOptions: { modelAssetPath: string } } | undefined;
  const fileset = fake.createFromOptions.mock.calls[0]?.[0] as { wasmLoaderPath: string; wasmBinaryPath: string } | undefined;
  return [
    fake.forVisionTasks.mock.calls[0]?.[0] ?? '',
    fileset?.wasmLoaderPath ?? '',
    fileset?.wasmBinaryPath ?? '',
    options?.baseOptions.modelAssetPath ?? '',
  ];
}

describe('the real loader (Req 4.1, 4.4)', () => {
  it.each(['/', '/garden/', '/garden', '/a/b/', './', ''])(
    'loads the WASM folder and the model only from under the base path %j',
    async (basePath) => {
      await createPoseLandmarker(basePath);
      const slash = basePath === '' ? '/' : basePath.endsWith('/') ? basePath : `${basePath}/`;
      const urls = loadedUrls();
      expect(urls).toHaveLength(4);
      for (const url of urls) {
        expect(url.startsWith(slash), url).toBe(true);
        expect(url, url).not.toMatch(/^[a-z][a-z0-9+.-]*:|^\/\//i);
      }
      expect(urls[0]).toBe(`${slash}mediapipe/wasm`);
      expect(urls[3]).toBe(`${slash}mediapipe/models/pose_landmarker_lite.task`);
    },
  );

  it('creates the lite model in video mode for one pose, and leaves the delegate to the library unless one is asked for', async () => {
    await createPoseLandmarker('/garden/');
    expect(fake.createFromOptions).toHaveBeenCalledTimes(1);
    const options = fake.createFromOptions.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(options.runningMode).toBe('VIDEO');
    expect(options.numPoses).toBe(1);
    expect(options.baseOptions).toEqual({ modelAssetPath: '/garden/mediapipe/models/pose_landmarker_lite.task' });
    fake.createFromOptions.mockClear();
    await createPoseLandmarker('/garden/', { delegate: 'GPU' });
    expect((fake.createFromOptions.mock.calls[0]?.[1] as { baseOptions: object }).baseOptions).toEqual({
      modelAssetPath: '/garden/mediapipe/models/pose_landmarker_lite.task',
      delegate: 'GPU',
    });
  });

  it('gives back the landmarker the library made, and rejects when the library cannot be created', async () => {
    expect(await createPoseLandmarker('/')).toBe(fake.landmarker);
    fake.forVisionTasks.mockImplementationOnce(() => Promise.reject(new Error('fetch failed')));
    await expect(createPoseLandmarker('/')).rejects.toThrow('fetch failed');
  });

  it('builds both URLs from the base path in one place', () => {
    expect(mediapipeUrls('/x')).toEqual({
      wasmFolder: '/x/mediapipe/wasm',
      model: '/x/mediapipe/models/pose_landmarker_lite.task',
    });
  });
});

describe('the default landmarker of createCameraSource', () => {
  it('is the real loader, called with the base path, so that every URL is under it', async () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    const tracks = [{ stop: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }];
    const stream = { getTracks: () => tracks, getVideoTracks: () => tracks } as unknown as MediaStream;
    video.play = () => Promise.resolve();
    const source = createCameraSource({
      basePath: '/garden/',
      video,
      getUserMedia: () => Promise.resolve(stream),
      scheduleFrame: () => () => undefined,
    });
    expect(await source.start()).toBe('ready');
    const urls = loadedUrls();
    expect(urls.every((url) => url.startsWith('/garden/mediapipe/'))).toBe(true);
    expect(urls.every((url) => url !== '')).toBe(true);
    source.dispose();
  });
});
