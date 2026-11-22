// @vitest-environment jsdom
// The camera preview beside the play field (camera check). The component test runs the page in camera mode with a
// fake camera, and checks where the preview sits in the DOM. The stylesheet test reads playground.css, because jsdom
// does not lay the page out: the row must be a flex row that wraps, and the preview must not be positioned over the field.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PoseFrame } from 'marrow/core';
import type { CameraSourceOptions, PoseSource, StartOutcome } from 'marrow/input';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ToneContext } from '../audio/tonePlayer';
import { copy } from '../copy';
import { Playground, type PlaygroundParts } from './playground';

// jsdom has no 2D canvas. A null context makes the calibration aura skip its draw.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
});

/** A camera that records its options and whose start outcome the test decides. It opens no real camera. */
class FakeCamera implements PoseSource {
  private finish: ((outcome: StartOutcome) => void) | null = null;
  constructor(readonly options: CameraSourceOptions) {}
  start(): Promise<StartOutcome> {
    // The real source asks for the camera inside start, so the preview gets its stream from this call.
    void this.options.getUserMedia?.({ video: true, audio: false });
    return new Promise((resolve) => {
      this.finish = resolve;
    });
  }
  /** Ends the start with an outcome, as the source does when it is ready or has failed. */
  finishStart(outcome: StartOutcome): void {
    this.finish?.(outcome);
  }
  latest(): PoseFrame | null {
    return null;
  }
  dispose(): void {
    // Nothing to release: the fake holds no tracks.
  }
}

function toneStub(): ToneContext {
  const param = {
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    cancelScheduledValues: () => undefined,
  };
  return {
    currentTime: 0,
    destination: 'out',
    createGain: () => ({ gain: param, connect: () => undefined }),
    createOscillator: () => ({
      type: '',
      frequency: param,
      connect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    }),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

/** Browser parts for camera mode. Every camera started is recorded in `cameras`. */
function cameraParts(cameras: FakeCamera[]): PlaygroundParts {
  let next = 1;
  return {
    createPointerSource: () => {
      throw new Error('the pointer source is not used in camera mode');
    },
    createCameraSource: (options) => {
      const camera = new FakeCamera(options);
      cameras.push(camera);
      return camera;
    },
    getUserMedia: () => Promise.resolve({} as MediaStream),
    requestFrame: () => {
      next += 1;
      return next;
    },
    cancelFrame: () => undefined,
    basePath: '/',
    createToneContext: () => toneStub(),
    settingsStorage: null,
  };
}

describe('the preview beside the field, in camera mode', () => {
  it('renders the preview after the field, in the same row, and never inside the field', async () => {
    const user = userEvent.setup();
    const cameras: FakeCamera[] = [];
    const { container } = render(<Playground parts={cameraParts(cameras)} />);
    await user.click(screen.getByRole('button', { name: copy.marrow.start.start }));
    await user.click(screen.getByRole('button', { name: copy.marrow.camera.useCamera }));
    const camera = cameras.at(-1);
    if (camera === undefined) throw new Error('no camera was started');
    await act(async () => {
      camera.finishStart('ready');
    });
    // The preview is shown on hand choice, once the stream is there.
    await waitFor(() => expect(container.querySelector('.playground-preview')).not.toBeNull());

    const row = container.querySelector('.playground-row');
    const field = container.querySelector('.playground-field');
    const preview = container.querySelector('.playground-preview');
    if (row === null || field === null || preview === null) throw new Error('the page has no row, field or preview');
    expect(field.parentElement).toBe(row);
    expect(preview.parentElement).toBe(row);
    expect(field.contains(preview)).toBe(false);
    expect(field.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(preview.querySelector('video.marrow-camera-preview')).not.toBeNull();
  });
});

const CSS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'playground.css'), 'utf8');

/** The declarations of the first rule for `selector`, with the selector at the start of a rule. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[\\s*/}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(CSS);
  if (match?.[1] === undefined) throw new Error(`playground.css has no rule for ${selector}`);
  return match[1];
}

describe('the preview row, in playground.css', () => {
  it('lays the field and the preview out in a flex row that wraps', () => {
    const row = ruleBody('.playground-row');
    expect(row).toMatch(/display:\s*flex/);
    expect(row).toMatch(/flex-wrap:\s*wrap/);
  });

  it('does not position the preview over the field', () => {
    const preview = ruleBody('.playground-preview');
    expect(preview).not.toMatch(/position:\s*(absolute|fixed)/);
    expect(preview).not.toMatch(/\b(top|right|bottom|left):/);
  });

  it('keeps the field width as it was', () => {
    expect(ruleBody('.playground-field')).toMatch(
      /width:\s*min\(100%,\s*960px,\s*calc\(\(100vh - 200px\) \* 1\.6\)\)/,
    );
  });
});
