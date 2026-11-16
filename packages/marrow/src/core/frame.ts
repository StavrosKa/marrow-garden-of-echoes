// The frame every pose source emits (design section 2.1). Positions are in camera
// space: normalized image coordinates, x and y in 0..1, origin top-left, not
// mirrored (Req 2.4). Mirroring happens once, in the mapping to screen space.
import type { Tuning } from './tuning';

/** A point in a normalized coordinate space. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** The player's side. MediaPipe "left" landmarks belong to the player's left side, so they map to `left` (Req 2.3). */
export type WristId = 'left' | 'right';

/** One landmark in camera space (0..1, origin top-left, not mirrored: Req 2.4). */
export interface Landmark {
  /** Camera-space position; meaningful only when `valid` is true. */
  readonly pos: Vec2;
  /**
   * Whether the landmark can be used. The camera source computes it with
   * `isLandmarkValid`; the pointer and trace sources set it directly (Req 2.2, 2.5, 2.6).
   */
  readonly valid: boolean;
}

/** The five landmarks this engine uses; hips are never required (Req 2.1, 2.3). */
export interface PoseLandmarks {
  readonly leftWrist: Landmark;
  readonly rightWrist: Landmark;
  readonly nose: Landmark;
  readonly leftShoulder: Landmark;
  readonly rightShoulder: Landmark;
}

/** One frame from any source. Nothing downstream can tell which source made it (Req 3.4). */
export interface PoseFrame {
  /**
   * Source monotonic time in milliseconds. Used ONLY inside `marrow/input` and the
   * Debug Overlay (new-frame detection, inference rate, latency). No pure logic reads
   * it as a clock (Req 2.7). The pure pipeline receives time only as clock deltas.
   */
  readonly t: number;
  /** Camera frame aspect a = width / height, carried in every frame; always > 0 (Req 2.1). */
  readonly aspect: number;
  readonly landmarks: PoseLandmarks;
}

/** MediaPipe Pose Landmarker indices (Req 2.3). The model fixes them; they are not tuning values. */
export const LANDMARK_INDEX = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
} as const;

/**
 * A landmark is valid if and only if its visibility is at least
 * `tuning.minVisibility` and it lies inside the frame: 0 <= x <= 1 and
 * 0 <= y <= 1 (Req 2.5). NaN in any of the three makes it invalid, because every
 * comparison with NaN is false. The frame keeps only the result, not the visibility.
 */
export function isLandmarkValid(visibility: number, pos: Vec2, tuning: Tuning): boolean {
  return (
    visibility >= tuning.minVisibility &&
    pos.x >= 0 &&
    pos.x <= 1 &&
    pos.y >= 0 &&
    pos.y <= 1
  );
}
