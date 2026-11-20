// The dev head driver (Req 12.10; design 8.2). While it is on, its value replaces the Head View output
// as the input of the head multiplier and the Glide. Head View is still stepped, so its state stays
// valid when the driver goes off. The pointer and the Dwell Engine are not affected.
import type { Vec2 } from 'marrow/core';

const ZERO = 0;

export interface HeadDriver {
  readonly on: boolean;
  readonly value: Vec2;
}

export function createHeadDriver(): HeadDriver {
  return { on: false, value: { x: ZERO, y: ZERO } };
}

/** `head` sets the value and turns the driver on; null turns it off and keeps the last value. */
export function setHeadDriver(driver: HeadDriver, head: Vec2 | null): HeadDriver {
  if (head === null) return { on: false, value: driver.value };
  return { on: true, value: { x: head.x, y: head.y } };
}
