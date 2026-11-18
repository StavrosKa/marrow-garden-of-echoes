// Where the Camera Source loads MediaPipe's files from (Req 4.4): only from the app's own
// public files, under the configured base path, never from a third-party host. The files
// are vendored in the app's `public/mediapipe/` folder (docs/licenses.md). This module
// has no MediaPipe import, so a test can read the URLs without loading the library.

/** The base path with one slash at its end, so that a path can be added to it. */
export function withTrailingSlash(basePath: string): string {
  if (basePath === '') return '/';
  return basePath.endsWith('/') ? basePath : `${basePath}/`;
}

export interface MediapipeUrls {
  /** The folder of the two WASM files, as `FilesetResolver.forVisionTasks` takes it. */
  readonly wasmFolder: string;
  /** The Pose Landmarker (lite) model file. */
  readonly model: string;
}

/** Every URL the Camera Source loads, built from the base path. */
export function mediapipeUrls(basePath: string): MediapipeUrls {
  const base = withTrailingSlash(basePath);
  return {
    wasmFolder: `${base}mediapipe/wasm`,
    model: `${base}mediapipe/models/pose_landmarker_lite.task`,
  };
}
