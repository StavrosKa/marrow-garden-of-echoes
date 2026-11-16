// The mapping between camera space and screen space (Requirement 10, design section
// 9.1): the base mapping followed by the reach gain, as the glossary defines them,
// with its exact closed-form inverse. It is the only conversion between the two
// spaces (Req 10.1); the pointer source uses it too.
//
// Forward, from a camera point (x, y) to a screen point s':
//   u   = 1 - x                          mirror once (Req 10.2)
//   k   = max(A / a, 1)                  base scale
//   s.x = A/2 + (u * a - a/2) * k        base mapping, about the centres
//   s.y = 1/2 + (y - 1/2) * k
//   s'  = c + g * (s - c)                reach gain about c
// Inverse, the same steps undone in reverse order:
//   s   = c + (s' - c) / g
//   u   = ((s.x - A/2) / k + a/2) / a
//   x   = 1 - u
//   y   = (s.y - 1/2) / k + 1/2
//
// The caller supplies valid parameters: finite, with both aspects and the gain above
// 0. Nothing here checks them or throws.
import type { Vec2 } from './frame';

// Geometry, not tuning values. These numbers come from the coordinate systems in the
// glossary: camera space is 0..1 on each axis, and screen space is 0..A by 0..1.

/** Camera space spans 0..1 on x, so mirroring once maps x to CAMERA_SPAN - x. */
const CAMERA_SPAN = 1;
/**
 * The base scale at which the camera image is exactly as high as the play area,
 * because both are one unit high. At A / a it is exactly as wide. The larger of the
 * two makes the image cover the play area.
 */
const SAME_HEIGHT_SCALE = 1;
/**
 * The centre of an interval that starts at 0 lies at half its length. The play area's
 * centre is (A * HALF, HALF); the camera image's, in aspect-corrected units, is
 * (a * HALF, HALF).
 */
const HALF = 0.5;

/** The parameters of the mapping: A, a, g and c of the glossary and design section 9.1. */
export interface MappingParams {
  /** A: the play area's width divided by its height. Screen space is 0..A by 0..1. */
  readonly playAspect: number;
  /** a: the camera image's width divided by its height, the PoseFrame's `aspect` (Req 2.1). */
  readonly frameAspect: number;
  /** g: the reach gain, a uniform scale about `centre` after the base mapping (Req 13.3). */
  readonly gain: number;
  /** c: the comfort centre in screen space, the point the reach gain leaves in place (Req 13.1). */
  readonly centre: Vec2;
}

/** The conversion between camera space and screen space, in both directions. */
export interface Mapping {
  /** Camera space to screen space: mirror once, base scale about the centres, reach gain about c. */
  readonly toScreen: (cam: Vec2) => Vec2;
  /**
   * Screen space to camera space: the exact inverse of `toScreen`, in closed form. In
   * floating point a round trip returns the starting point up to rounding (Req 10.3).
   */
  readonly toCamera: (screen: Vec2) => Vec2;
}

/**
 * The mapping for one set of parameters (design section 9.1). Every point has an
 * image in both directions, so a screen point outside the play area can map to a
 * camera point outside the frame, and the other way round.
 */
export function makeMapping(params: MappingParams): Mapping {
  // The names of the glossary and design section 9.1.
  const { playAspect: A, frameAspect: a, gain: g, centre: c } = params;
  const k = Math.max(A / a, SAME_HEIGHT_SCALE);
  return {
    toScreen: (cam) => {
      const u = CAMERA_SPAN - cam.x;
      const sx = A * HALF + (u * a - a * HALF) * k;
      const sy = HALF + (cam.y - HALF) * k;
      return { x: c.x + g * (sx - c.x), y: c.y + g * (sy - c.y) };
    },
    toCamera: (screen) => {
      const sx = c.x + (screen.x - c.x) / g;
      const sy = c.y + (screen.y - c.y) / g;
      const u = ((sx - A * HALF) / k + a * HALF) / a;
      return { x: CAMERA_SPAN - u, y: (sy - HALF) / k + HALF };
    },
  };
}
