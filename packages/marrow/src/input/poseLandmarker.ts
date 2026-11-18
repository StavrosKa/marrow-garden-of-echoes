// The real Pose Landmarker (Req 4.1, 4.4): MediaPipe Tasks Vision, the lite model, one pose,
// video running mode, on the main thread. This is the only module that imports MediaPipe
// (Req 28.3). The Camera Source loads it with a dynamic `import()`, so the library and its
// code are fetched only when a camera is started, in a chunk of their own, and a session
// with the pointer never downloads them.
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { LandmarkerLike } from './cameraSource';
import { mediapipeUrls } from './mediapipeUrls';

export interface PoseLandmarkerSettings {
  /** The MediaPipe delegate. Left out, the library's own default is used. */
  readonly delegate?: 'CPU' | 'GPU';
}

/**
 * Loads the two WASM files and the model from under `basePath` and creates the landmarker.
 * Rejects if a file cannot be fetched or the landmarker cannot be created.
 */
export async function createPoseLandmarker(
  basePath: string,
  settings: PoseLandmarkerSettings = {},
): Promise<LandmarkerLike> {
  const urls = mediapipeUrls(basePath);
  const fileset = await FilesetResolver.forVisionTasks(urls.wasmFolder);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: urls.model,
      ...(settings.delegate === undefined ? {} : { delegate: settings.delegate }),
    },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
}
