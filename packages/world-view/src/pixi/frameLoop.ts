// The frame loop (Req 10.7; design 7.3 steps 1-2). It requests the next frame before it runs the
// tick, so a throw in the tick does not end the loop. The delta is the raw difference of the
// requestAnimationFrame timestamps: 0 on the first tick, and never clamped (the clamp belongs to
// marrow's session clock).
import type { PixiPorts } from './ports';

export interface FrameLoop {
  start(): void;
  stop(): void;
}

export function createFrameLoop(
  ports: Pick<PixiPorts, 'requestFrame' | 'cancelFrame'>,
  tick: (rawDtMs: number) => void,
): FrameLoop {
  let running = false;
  let handle: number | undefined;
  let lastTimestamp: number | undefined;

  const onFrame = (timestamp: number): void => {
    handle = undefined;
    if (!running) return;
    handle = ports.requestFrame(onFrame);
    const rawDtMs = lastTimestamp === undefined ? 0 : timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    tick(rawDtMs);
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      handle = ports.requestFrame(onFrame);
    },
    stop(): void {
      running = false;
      if (handle !== undefined) {
        ports.cancelFrame(handle);
        handle = undefined;
      }
    },
  };
}
