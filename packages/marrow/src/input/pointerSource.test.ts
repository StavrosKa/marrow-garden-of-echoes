// @vitest-environment jsdom
// Tests for the Pointer Source (Req 3.1, 3.3, 6.1 to 6.5), with synthetic pointer
// events and a fake frame scheduler. The box sizes and positions are test data.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeMapping, type PoseFrame, type Vec2 } from '../core';
import * as inputBarrel from './index';
import { createPointerSource } from './pointerSource';

const ROUND_TRIP_TOLERANCE = 1e-9;
const BOX = { left: 10, top: 20, width: 320, height: 200 };
type Box = typeof BOX;

interface Harness {
  readonly el: HTMLElement;
  readonly source: ReturnType<typeof createPointerSource>;
  readonly requestFrame: ReturnType<typeof vi.fn>;
  readonly cancelFrame: ReturnType<typeof vi.fn>;
  readonly setBox: (box: Box) => void;
  /** Run the callbacks asked for so far, as one animation frame at time t. */
  readonly tick: (t: number) => void;
  readonly pending: () => number;
  readonly fire: (type: string, init?: PointerInit) => void;
}
interface PointerInit {
  id?: number;
  primary?: boolean;
  kind?: 'mouse' | 'pen' | 'touch';
  x?: number;
  y?: number;
}

function harness(initial: Box = BOX): Harness {
  let box = initial;
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.getBoundingClientRect = () =>
    ({
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
      toJSON: () => ({}),
    }) as DOMRect;
  const queue = new Map<number, (t: number) => void>();
  let next = 1;
  const requestFrame = vi.fn((cb: (t: number) => void) => {
    const handle = next++;
    queue.set(handle, cb);
    return handle;
  });
  const cancelFrame = vi.fn((handle: number) => {
    queue.delete(handle);
  });
  const source = createPointerSource({ playArea: el, requestFrame, cancelFrame });
  return {
    el,
    source,
    requestFrame,
    cancelFrame,
    setBox: (b) => {
      box = b;
    },
    tick: (t) => {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const cb of callbacks) cb(t);
    },
    pending: () => queue.size,
    fire: (type, init = {}) => {
      el.dispatchEvent(
        new PointerEvent(type, {
          pointerId: init.id ?? 1,
          isPrimary: init.primary ?? true,
          pointerType: init.kind ?? 'mouse',
          clientX: init.x ?? box.left + box.width / 2,
          clientY: init.y ?? box.top + box.height / 2,
        }),
      );
    },
  };
}

const inside = (b: Box, fx: number, fy: number) => ({
  x: b.left + fx * b.width,
  y: b.top + fy * b.height,
});

/** The screen-space position (height 1) of a client position in a box. */
const screenOf = (b: Box, x: number, y: number): Vec2 => ({
  x: (x - b.left) / b.height,
  y: (y - b.top) / b.height,
});

async function started(box: Box = BOX): Promise<Harness> {
  const h = harness(box);
  await h.source.start();
  return h;
}

function frameAfterTick(h: Harness, t = 16): PoseFrame {
  h.tick(t);
  const frame = h.source.latest();
  if (frame === null) throw new Error('no frame');
  return frame;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the frame', () => {
  it('start resolves ready and there is no frame until the first animation frame', async () => {
    const h = harness();
    await expect(h.source.start()).resolves.toBe('ready');
    expect(h.source.latest()).toBeNull();
    h.tick(5);
    expect(h.source.latest()).not.toBeNull();
  });

  it('carries the play aspect A, the tick time, and the right wrist only', async () => {
    const h = await started();
    h.fire('pointerenter');
    const frame = frameAfterTick(h, 123);
    expect(frame.aspect).toBe(BOX.width / BOX.height);
    expect(frame.t).toBe(123);
    expect(frame.landmarks.rightWrist.valid).toBe(true);
    expect(frame.landmarks.leftWrist.valid).toBe(false);
  });

  it('the left wrist is invalid whatever the pointer does', async () => {
    const h = await started();
    for (const type of ['pointerenter', 'pointerdown', 'pointermove', 'pointerup', 'pointerleave']) {
      h.fire(type);
      expect(frameAfterTick(h).landmarks.leftWrist.valid).toBe(false);
    }
  });

  it('the nose and both shoulders are valid, inside the frame, with and without the pointer', async () => {
    const h = await started();
    const withoutPointer = frameAfterTick(h);
    h.fire('pointerenter');
    const withPointer = frameAfterTick(h);
    for (const frame of [withoutPointer, withPointer]) {
      for (const lm of [frame.landmarks.nose, frame.landmarks.leftShoulder, frame.landmarks.rightShoulder]) {
        expect(lm.valid).toBe(true);
        expect(lm.pos.x).toBeGreaterThanOrEqual(0);
        expect(lm.pos.x).toBeLessThanOrEqual(1);
        expect(lm.pos.y).toBeGreaterThanOrEqual(0);
        expect(lm.pos.y).toBeLessThanOrEqual(1);
      }
    }
    expect(withPointer.landmarks.nose.pos).toEqual(withoutPointer.landmarks.nose.pos);
    expect(withPointer.landmarks.leftShoulder.pos).toEqual(withoutPointer.landmarks.leftShoulder.pos);
    expect(withPointer.landmarks.rightShoulder.pos).toEqual(withoutPointer.landmarks.rightShoulder.pos);
  });

  it('the player left shoulder is on the right of the image (camera space is not mirrored)', async () => {
    const h = await started();
    const { leftShoulder, rightShoulder } = frameAfterTick(h).landmarks;
    expect(leftShoulder.pos.x).toBeGreaterThan(rightShoulder.pos.x);
  });

  it('the frame aspect follows the box', async () => {
    const h = await started();
    expect(frameAfterTick(h).aspect).toBe(BOX.width / BOX.height);
    const portrait = { left: 0, top: 0, width: 300, height: 600 };
    h.setBox(portrait);
    expect(frameAfterTick(h).aspect).toBe(portrait.width / portrait.height);
  });

  it('a box with no size makes no frame and keeps the last one', async () => {
    const h = await started();
    const before = frameAfterTick(h);
    h.setBox({ left: 0, top: 0, width: 0, height: 100 });
    h.tick(32);
    expect(h.source.latest()).toBe(before);
    h.setBox({ left: 0, top: 0, width: 100, height: 0 });
    h.tick(48);
    expect(h.source.latest()).toBe(before);
    h.setBox(BOX);
    h.tick(64);
    expect(h.source.latest()).not.toBe(before);
  });
});

describe('the wrist is the inverse base mapping of the pointer (Req 6.3)', () => {
  const boxes: Box[] = [
    BOX,
    { left: 0, top: 0, width: 500, height: 500 },
    { left: 33, top: 17, width: 400, height: 900 },
    { left: 5, top: 5, width: 1200, height: 500 },
    // Boxes where the inverse mapping of a corner comes out a rounding error outside 0..1
    // (x = -2.2e-16 at the top right, y = 1.0000000000000002 at the bottom left); the wrist is
    // kept inside the frame (Req 2.5).
    { left: 249.7, top: 429.9, width: 477.78529808856547, height: 1498.0824809288606 },
    { left: 432.3, top: 271.9, width: 1926.9819696899503, height: 951.9608580274507 },
  ];

  it('x = 1 - s.x / A and y = s.y, which toScreen of the same mapping returns within 1e-9', async () => {
    for (const box of boxes) {
      const A = box.width / box.height;
      const mapping = makeMapping({ playAspect: A, frameAspect: A, gain: 1, centre: { x: A / 2, y: 0.5 } });
      const h = await started(box);
      const spots: [number, number][] = [];
      // The four corners and the centre of the play area, then a grid across it.
      for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) spots.push([fx, fy]);
      for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) spots.push([i / 10, j / 10]);
      for (const [fx, fy] of spots) {
        const p = inside(box, fx, fy);
        h.fire('pointermove', { x: p.x, y: p.y });
        const wrist = frameAfterTick(h).landmarks.rightWrist;
        expect(wrist.valid).toBe(true);
        const s = screenOf(box, p.x, p.y);
        expect(Math.abs(wrist.pos.x - (1 - s.x / A))).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
        expect(Math.abs(wrist.pos.y - s.y)).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
        const back = mapping.toScreen(wrist.pos);
        expect(Math.abs(back.x - s.x)).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
        expect(Math.abs(back.y - s.y)).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
        // A valid wrist is inside the camera frame (Req 2.5).
        expect(wrist.pos.x).toBeGreaterThanOrEqual(0);
        expect(wrist.pos.x).toBeLessThanOrEqual(1);
        expect(wrist.pos.y).toBeGreaterThanOrEqual(0);
        expect(wrist.pos.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the four corners and the centre, each named', async () => {
    const A = BOX.width / BOX.height;
    const mapping = makeMapping({ playAspect: A, frameAspect: A, gain: 1, centre: { x: A / 2, y: 0.5 } });
    const h = await started();
    const corners: [string, number, number, Vec2][] = [
      ['top left', 0, 0, { x: 1, y: 0 }],
      ['top right', 1, 0, { x: 0, y: 0 }],
      ['bottom left', 0, 1, { x: 1, y: 1 }],
      ['bottom right', 1, 1, { x: 0, y: 1 }],
      ['centre', 0.5, 0.5, { x: 0.5, y: 0.5 }],
    ];
    for (const [name, fx, fy, camera] of corners) {
      const p = inside(BOX, fx, fy);
      h.fire('pointermove', { x: p.x, y: p.y });
      const wrist = frameAfterTick(h).landmarks.rightWrist;
      expect(wrist.valid, name).toBe(true);
      expect(Math.abs(wrist.pos.x - camera.x), name).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
      expect(Math.abs(wrist.pos.y - camera.y), name).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
      const s = screenOf(BOX, p.x, p.y);
      const back = mapping.toScreen(wrist.pos);
      expect(Math.abs(back.x - s.x), name).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
      expect(Math.abs(back.y - s.y), name).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
    }
  });
});

describe('validity of the wrist (Req 6.2)', () => {
  it('a mouse: valid on enter and move, invalid on leave, valid again on re-enter', async () => {
    const h = await started();
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointerenter');
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
    h.fire('pointermove', inside(BOX, 0.2, 0.3));
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
    h.fire('pointerleave');
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointerenter');
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
  });

  it('a mouse stays valid across frames with no event, with the same position', async () => {
    const h = await started();
    const p = inside(BOX, 0.25, 0.75);
    h.fire('pointermove', p);
    const a = frameAfterTick(h, 10).landmarks.rightWrist;
    const b = frameAfterTick(h, 20).landmarks.rightWrist;
    expect(b.valid).toBe(true);
    expect(b.pos).toEqual(a.pos);
  });

  it('a mouse button press and release leave it valid', async () => {
    const h = await started();
    h.fire('pointerenter');
    h.fire('pointerdown');
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
    h.fire('pointerup');
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
  });

  it('a mouse position outside the box is not over the play area', async () => {
    const h = await started();
    h.fire('pointermove', inside(BOX, 0.5, 0.5));
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
    h.fire('pointermove', { x: BOX.left - 1, y: BOX.top + 10 });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointermove', { x: BOX.left + BOX.width + 1, y: BOX.top + 10 });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointermove', { x: BOX.left + 10, y: BOX.top - 1 });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointermove', { x: BOX.left + 10, y: BOX.top + BOX.height + 1 });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointermove', inside(BOX, 0.5, 0.5));
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
  });

  it('the edges of the box are over the play area', async () => {
    const h = await started();
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      h.fire('pointermove', inside(BOX, fx, fy));
      expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
    }
  });

  it('a cancelled mouse is invalid until its next event', async () => {
    const h = await started();
    h.fire('pointermove');
    h.fire('pointercancel');
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointermove');
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
  });

  it('a pen hovering over the box is valid, and invalid when it leaves', async () => {
    const h = await started();
    h.fire('pointerenter', { kind: 'pen' });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
    h.fire('pointermove', { kind: 'pen', ...inside(BOX, 0.1, 0.1) });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
    h.fire('pointerleave', { kind: 'pen' });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
  });

  it('a touch: valid only from contact to release', async () => {
    const h = await started();
    h.fire('pointermove', { kind: 'touch' });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointerenter', { kind: 'touch' });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointerdown', { kind: 'touch', ...inside(BOX, 0.3, 0.3) });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
    h.fire('pointermove', { kind: 'touch', ...inside(BOX, 0.6, 0.6) });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
    h.fire('pointerup', { kind: 'touch' });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointerleave', { kind: 'touch' });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointermove', { kind: 'touch', ...inside(BOX, 0.6, 0.6) });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
  });

  it('a touch that is cancelled is invalid', async () => {
    const h = await started();
    h.fire('pointerdown', { kind: 'touch' });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
    h.fire('pointercancel', { kind: 'touch' });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointermove', { kind: 'touch' });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
  });

  it('a touch dragged outside the box is not in contact with the play area, and is again on return', async () => {
    const h = await started();
    h.fire('pointerdown', { kind: 'touch', ...inside(BOX, 0.5, 0.5) });
    h.fire('pointermove', { kind: 'touch', x: BOX.left - 50, y: BOX.top + 10 });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointermove', { kind: 'touch', ...inside(BOX, 0.5, 0.5) });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
    h.fire('pointerleave', { kind: 'touch' });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
    h.fire('pointerenter', { kind: 'touch', ...inside(BOX, 0.5, 0.5) });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
    h.fire('pointerup', { kind: 'touch' });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(false);
  });

  it('an invalid wrist carries a position inside the frame', async () => {
    const h = await started();
    const wrist = frameAfterTick(h).landmarks.rightWrist;
    expect(wrist.valid).toBe(false);
    expect(Number.isFinite(wrist.pos.x)).toBe(true);
    expect(Number.isFinite(wrist.pos.y)).toBe(true);
  });
});

describe('only the primary pointer counts (Req 6.1)', () => {
  const SECOND = 7;

  it('a pointer that is not primary never makes the wrist valid', async () => {
    const h = await started();
    for (const type of ['pointerenter', 'pointerdown', 'pointermove', 'pointerup']) {
      for (const kind of ['mouse', 'pen', 'touch'] as const) {
        h.fire(type, { id: SECOND, primary: false, kind });
        expect(frameAfterTick(h).landmarks.rightWrist.valid, `${type} ${kind}`).toBe(false);
      }
    }
  });

  it('a second touch changes nothing while the first is down', async () => {
    const h = await started();
    const first = inside(BOX, 0.2, 0.4);
    h.fire('pointerdown', { id: 1, kind: 'touch', ...first });
    const before = frameAfterTick(h, 10).landmarks.rightWrist;
    expect(before.valid).toBe(true);
    const other = inside(BOX, 0.9, 0.9);
    for (const type of ['pointerenter', 'pointerdown', 'pointermove']) {
      h.fire(type, { id: SECOND, primary: false, kind: 'touch', ...other });
    }
    const during = frameAfterTick(h, 20).landmarks.rightWrist;
    expect(during).toEqual(before);
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      h.fire(type, { id: SECOND, primary: false, kind: 'touch', ...other });
    }
    const after = frameAfterTick(h, 30).landmarks.rightWrist;
    expect(after).toEqual(before);
    // The primary still moves it.
    h.fire('pointermove', { id: 1, kind: 'touch', ...inside(BOX, 0.5, 0.5) });
    expect(frameAfterTick(h, 40).landmarks.rightWrist.pos).not.toEqual(before.pos);
  });

  it('a second pointer changes nothing while a mouse is over the box either', async () => {
    const h = await started();
    h.fire('pointermove', { id: 1, ...inside(BOX, 0.2, 0.4) });
    const before = frameAfterTick(h, 10).landmarks.rightWrist;
    h.fire('pointermove', { id: SECOND, primary: false, ...inside(BOX, 0.8, 0.8) });
    h.fire('pointerleave', { id: SECOND, primary: false });
    expect(frameAfterTick(h, 20).landmarks.rightWrist).toEqual(before);
  });

  it('a second pointer that is not primary cannot release the primary', async () => {
    const h = await started();
    h.fire('pointerdown', { id: 1, kind: 'touch' });
    h.fire('pointerup', { id: SECOND, primary: false, kind: 'touch' });
    h.fire('pointercancel', { id: SECOND, primary: false, kind: 'touch' });
    expect(frameAfterTick(h).landmarks.rightWrist.valid).toBe(true);
  });

  it('a second primary pointer of another kind is ignored while the first is followed', async () => {
    const h = await started();
    const first = inside(BOX, 0.2, 0.4);
    h.fire('pointerdown', { id: 1, kind: 'touch', ...first });
    const before = frameAfterTick(h, 10).landmarks.rightWrist;
    h.fire('pointermove', { id: 2, kind: 'mouse', ...inside(BOX, 0.8, 0.8) });
    h.fire('pointerleave', { id: 2, kind: 'mouse' });
    expect(frameAfterTick(h, 20).landmarks.rightWrist).toEqual(before);
  });

  it('the next primary pointer is followed once the first is gone', async () => {
    const h = await started();
    h.fire('pointerdown', { id: 1, kind: 'touch', ...inside(BOX, 0.2, 0.4) });
    h.fire('pointerup', { id: 1, kind: 'touch' });
    h.fire('pointerdown', { id: 2, kind: 'touch', ...inside(BOX, 0.7, 0.7) });
    const wrist = frameAfterTick(h).landmarks.rightWrist;
    expect(wrist.valid).toBe(true);
    const A = BOX.width / BOX.height;
    const p = inside(BOX, 0.7, 0.7);
    expect(Math.abs(wrist.pos.x - (1 - screenOf(BOX, p.x, p.y).x / A))).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
  });
});

describe('at most one frame per animation frame (Req 6.5)', () => {
  it('many events between two animation frames make no frame until the next one, then one', async () => {
    const h = await started();
    const first = frameAfterTick(h, 10);
    for (let i = 0; i <= 10; i++) h.fire('pointermove', inside(BOX, i / 10, 0.5));
    expect(h.source.latest()).toBe(first);
    h.tick(20);
    const second = h.source.latest();
    expect(second).not.toBe(first);
    // It reflects the last event.
    const last = inside(BOX, 1, 0.5);
    const A = BOX.width / BOX.height;
    expect(Math.abs((second as PoseFrame).landmarks.rightWrist.pos.x - (1 - screenOf(BOX, last.x, last.y).x / A))).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
    expect(h.source.latest()).toBe(second);
  });

  it('asks for exactly one callback at a time', async () => {
    const h = await started();
    expect(h.pending()).toBe(1);
    expect(h.requestFrame).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) h.fire('pointermove');
    expect(h.requestFrame).toHaveBeenCalledTimes(1);
    h.tick(16);
    expect(h.pending()).toBe(1);
    expect(h.requestFrame).toHaveBeenCalledTimes(2);
  });

  it('makes a new frame object on every animation frame, also when nothing changed', async () => {
    const h = await started();
    h.fire('pointermove');
    const seen = new Set<PoseFrame>();
    for (let i = 1; i <= 5; i++) seen.add(frameAfterTick(h, i * 16));
    expect(seen.size).toBe(5);
  });

  it('start twice asks for one callback and adds the listeners once', async () => {
    const h = harness();
    const add = vi.spyOn(h.el, 'addEventListener');
    await h.source.start();
    const added = add.mock.calls.length;
    await h.source.start();
    expect(add.mock.calls.length).toBe(added);
    expect(h.requestFrame).toHaveBeenCalledTimes(1);
  });
});

describe('dispose (Req 3.3)', () => {
  it('removes every listener it added', async () => {
    const h = harness();
    const add = vi.spyOn(h.el, 'addEventListener');
    const remove = vi.spyOn(h.el, 'removeEventListener');
    await h.source.start();
    expect(add.mock.calls.length).toBeGreaterThan(0);
    h.source.dispose();
    const key = (c: unknown[]) => `${String(c[0])}`;
    expect(remove.mock.calls.map(key).sort()).toEqual(add.mock.calls.map(key).sort());
    for (const call of add.mock.calls) {
      expect(remove.mock.calls.some((r) => r[0] === call[0] && r[1] === call[1])).toBe(true);
    }
  });

  it('cancels the pending animation frame and exposes no frame afterwards', async () => {
    const h = await started();
    frameAfterTick(h);
    expect(h.pending()).toBe(1);
    h.source.dispose();
    expect(h.cancelFrame).toHaveBeenCalledTimes(1);
    expect(h.pending()).toBe(0);
    expect(h.source.latest()).toBeNull();
    h.fire('pointermove');
    h.tick(99);
    expect(h.source.latest()).toBeNull();
  });

  it('dispose twice does nothing the second time', async () => {
    const h = await started();
    const remove = vi.spyOn(h.el, 'removeEventListener');
    h.source.dispose();
    const removed = remove.mock.calls.length;
    expect(() => {
      h.source.dispose();
    }).not.toThrow();
    expect(remove.mock.calls.length).toBe(removed);
    expect(h.cancelFrame).toHaveBeenCalledTimes(1);
  });

  it('dispose before start adds nothing, and a later start does nothing', async () => {
    const h = harness();
    const add = vi.spyOn(h.el, 'addEventListener');
    h.source.dispose();
    await expect(h.source.start()).resolves.toBe('ready');
    expect(add).not.toHaveBeenCalled();
    expect(h.requestFrame).not.toHaveBeenCalled();
    expect(h.source.latest()).toBeNull();
  });

  it('events after dispose change nothing', async () => {
    const h = await started();
    h.source.dispose();
    h.fire('pointerdown', { kind: 'touch' });
    h.tick(1);
    expect(h.source.latest()).toBeNull();
  });
});

describe('the barrel of marrow/input', () => {
  it('exports createPointerSource', () => {
    expect(inputBarrel.createPointerSource).toBe(createPointerSource);
  });
});
