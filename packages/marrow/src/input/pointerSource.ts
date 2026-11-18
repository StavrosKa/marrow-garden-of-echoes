// The Pointer Source (design section 2.2, Req 6.1 to 6.5): simulated input. One
// primary pointer (a mouse, a pen, or the first touch) drives the right wrist; the
// left wrist is always invalid. The play-area element and the frame scheduler are
// passed in, so the source runs under jsdom in tests and reads no clock of its own.
//
// What it does, in order:
// - Pointer events on the play area update a small state: which pointer is followed,
//   whether it is over the play area (a mouse or pen) or in contact with it (a touch),
//   and its last client position. Only events of a primary pointer count (Req 6.1).
// - Once per animation frame, and no more often, it builds one new PoseFrame from that
//   state (Req 6.5). It does this on every animation frame while running, also when the
//   pointer has not moved, as design section 9.7 says: the consumer detects a new frame
//   by reference and counts one calibration sample per new frame, so a pointer that rests
//   still has to produce new frames.
// - The wrist is the inverse base mapping of the pointer's screen position, taken from
//   `makeMapping` with the camera aspect equal to the play aspect A and gain 1, so the
//   base mapping returns the pointer position (Req 6.3).
import { makeMapping, type PoseFrame, type Vec2 } from '../core';
import { clamp } from '../core/geometry';
import type { PoseSource, StartOutcome } from './poseSource';

// Constants of this source, not tuning values. Screen space is A wide and one high
// (glossary), so its centre is (A / 2, 1 / 2).
const HALF = 0.5;
/** Gain 1: the identity scale, so the mapping is the base mapping alone (Req 6.3, 6.6). */
const BASE_GAIN = 1;
/** Camera space spans 0..1 on each axis. */
const CAMERA_MIN = 0;
const CAMERA_MAX = 1;
/** Where an invalid landmark's position is put. It is meaningless while `valid` is false. */
const UNUSED_POS: Vec2 = { x: 0, y: 0 };
/**
 * The fixed synthetic head and shoulders (Req 6.4): inside the frame, in camera space
 * (not mirrored), as a person facing the camera would appear. The player's left
 * shoulder is on the right of the image.
 */
const SYNTHETIC_NOSE: Vec2 = { x: 0.5, y: 0.3 };
const SYNTHETIC_LEFT_SHOULDER: Vec2 = { x: 0.65, y: 0.5 };
const SYNTHETIC_RIGHT_SHOULDER: Vec2 = { x: 0.35, y: 0.5 };

const POINTER_EVENTS = [
  'pointerenter',
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'pointerleave',
] as const;

export interface PointerSourceOptions {
  /** The element that is the play area. Its box is read on every event and frame. */
  readonly playArea: HTMLElement;
  /** Asks for one callback at the next animation frame, with that frame's timestamp in ms. */
  readonly requestFrame: (callback: (frameTimeMs: number) => void) => number;
  /** Cancels a callback asked for with `requestFrame`. */
  readonly cancelFrame: (handle: number) => void;
}

/** The pointer being followed. */
interface Followed {
  readonly id: number;
  readonly touch: boolean;
  /** For a touch: whether it is in contact with the screen. A mouse or pen has no contact state. */
  contact: boolean;
}

const valid = (pos: Vec2) => ({ pos: { x: pos.x, y: pos.y }, valid: true });
const invalid = () => ({ pos: { x: UNUSED_POS.x, y: UNUSED_POS.y }, valid: false });

export function createPointerSource(options: PointerSourceOptions): PoseSource {
  const { playArea, requestFrame, cancelFrame } = options;
  let followed: Followed | null = null;
  let engaged = false;
  let client: Vec2 = UNUSED_POS;
  let latest: PoseFrame | null = null;
  let started = false;
  let disposed = false;
  let pending: number | null = null;

  function isInside(x: number, y: number): boolean {
    const box = playArea.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  }

  function release(): void {
    followed = null;
    engaged = false;
  }

  /** The pointer is at this event's position: engaged if it is over the play area. */
  function update(event: PointerEvent): void {
    followed ??= { id: event.pointerId, touch: event.pointerType === 'touch', contact: false };
    engaged = isInside(event.clientX, event.clientY);
    if (engaged) client = { x: event.clientX, y: event.clientY };
  }

  function onPointer(event: PointerEvent): void {
    if (!event.isPrimary) return;
    if (followed !== null && followed.id !== event.pointerId) return;
    switch (event.type) {
      case 'pointerdown':
        update(event);
        if (followed?.touch) followed.contact = true;
        // A touch that starts outside the play area is not in contact with it.
        break;
      case 'pointerup':
        // A touch that lifts is no longer in contact, whether or not it was followed.
        if (followed?.touch || event.pointerType === 'touch') release();
        else update(event);
        break;
      case 'pointercancel':
        release();
        break;
      case 'pointerleave':
        if (followed?.touch && followed.contact) engaged = false;
        else release();
        break;
      default:
        // pointerenter and pointermove: a touch counts only while it is in contact.
        if (event.pointerType === 'touch' && !followed?.contact) return;
        update(event);
    }
  }

  function buildFrame(frameTimeMs: number): PoseFrame | null {
    const box = playArea.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) return null;
    const aspect = box.width / box.height;
    // Screen space: height 1, so x is in units of the box's height (glossary).
    const screen: Vec2 = {
      x: (client.x - box.left) / box.height,
      y: (client.y - box.top) / box.height,
    };
    const mapping = makeMapping({
      playAspect: aspect,
      frameAspect: aspect,
      gain: BASE_GAIN,
      centre: { x: aspect * HALF, y: HALF },
    });
    let rightWrist = invalid();
    if (engaged) {
      const cam = mapping.toCamera(screen);
      // A pointer on the edge of the box can come out a rounding error outside 0..1.
      rightWrist = valid({
        x: clamp(cam.x, CAMERA_MIN, CAMERA_MAX),
        y: clamp(cam.y, CAMERA_MIN, CAMERA_MAX),
      });
    }
    return {
      t: frameTimeMs,
      aspect,
      landmarks: {
        leftWrist: invalid(),
        rightWrist,
        nose: valid(SYNTHETIC_NOSE),
        leftShoulder: valid(SYNTHETIC_LEFT_SHOULDER),
        rightShoulder: valid(SYNTHETIC_RIGHT_SHOULDER),
      },
    };
  }

  function onFrame(frameTimeMs: number): void {
    pending = null;
    if (disposed) return;
    latest = buildFrame(frameTimeMs) ?? latest;
    pending = requestFrame(onFrame);
  }

  return {
    start(): Promise<StartOutcome> {
      if (!started && !disposed) {
        started = true;
        for (const type of POINTER_EVENTS) playArea.addEventListener(type, onPointer);
        pending = requestFrame(onFrame);
      }
      return Promise.resolve('ready');
    },
    latest: (): PoseFrame | null => (disposed ? null : latest),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const type of POINTER_EVENTS) playArea.removeEventListener(type, onPointer);
      if (pending !== null) cancelFrame(pending);
      pending = null;
      latest = null;
      release();
    },
  };
}
