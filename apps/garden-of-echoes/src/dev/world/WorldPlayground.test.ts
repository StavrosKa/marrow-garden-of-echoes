// @vitest-environment jsdom
// The screens of the World Playground, with the Testing Library stack. The browser objects (the Scene
// Manager, the Camera Source and the Pointer Source) are fakes, so no test loads Pixi or a camera.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoseSource, StartOutcome } from 'marrow/input';
import type { SceneManager, SceneManagerOptions } from 'world-view/pixi';
import { copy } from '../../copy';
import { colourNumber } from '../../ui/theme';
import { DEFAULT_ASPECT } from './constants';
import { WorldPlayground } from './WorldPlayground';
import { loadWorldContent, type ContentResult, type WorldContent } from './worldContent';
import type { SessionDeps } from './worldSession';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEXT = copy.worldPlayground;
const ROUTE_ON = '/?playground=world';
const ROUTE_OFF = '/';

function validContent(): WorldContent {
  const loaded = loadWorldContent();
  if (!loaded.ok) throw new Error('the shipped content must be valid for these tests');
  return loaded.content;
}

function fakeSource(outcome: StartOutcome) {
  return {
    start: vi.fn(async () => outcome),
    latest: vi.fn(() => null),
    dispose: vi.fn(),
  };
}

function fakeScene() {
  return {
    start: vi.fn(async () => undefined),
    dispose: vi.fn(),
    hitCircles: () => [],
    projectionFrame: () => ({ aspect: 16 / 9, sceneScale: 1 }),
    setTargets: vi.fn(),
    setTargetColour: vi.fn(),
    debugLayers: () => [],
    debugTargets: () => [],
    canvasSize: () => ({ width: 960, height: 540 }),
  };
}

interface Harness {
  readonly camera: ReturnType<typeof fakeSource>;
  readonly pointer: ReturnType<typeof fakeSource>;
  readonly scenes: ReturnType<typeof fakeScene>[];
  readonly deps: Partial<SessionDeps>;
}

function harness(cameraOutcome: StartOutcome): Harness {
  const camera = fakeSource(cameraOutcome);
  const pointer = fakeSource('ready');
  const scenes: ReturnType<typeof fakeScene>[] = [];
  const deps: Partial<SessionDeps> = {
    createScene: async () => {
      const scene = fakeScene();
      scenes.push(scene);
      return scene as unknown as SceneManager;
    },
    createCamera: () => camera as unknown as PoseSource,
    createPointer: () => pointer as unknown as PoseSource,
    isHidden: () => false,
  };
  return { camera, pointer, scenes, deps };
}

function renderPlayground(deps: Partial<SessionDeps>, loadContent?: () => ContentResult) {
  return render(
    createElement(WorldPlayground, {
      loadContent: loadContent ?? (() => ({ ok: true, content: validContent() })),
      tuningIssues: [],
      deps,
    }),
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', ROUTE_OFF);
});

/** The reduced-motion media query as WorldPlayground.tsx writes it, and a frame of the playground. */
const REDUCED_MEDIA = '(prefers-reduced-motion:reduce)';
const FRAME_MS = 16;

/**
 * Starts the playground with no stored settings and the given browser preference, runs one frame of the
 * scene, and returns the motion level that the snapshot reports.
 */
async function motionOfFirstFrame(prefersReduced: boolean): Promise<string | undefined> {
  window.localStorage.clear();
  window.history.replaceState({}, '', ROUTE_ON);
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: prefersReduced && query.replace(/\s/g, '') === REDUCED_MEDIA,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  try {
    const options: SceneManagerOptions[] = [];
    const scenes: ReturnType<typeof fakeScene>[] = [];
    const h = harness('ready');
    renderPlayground({
      ...h.deps,
      createScene: async (sceneOptions) => {
        options.push(sceneOptions);
        const scene = fakeScene();
        scenes.push(scene);
        return scene as unknown as SceneManager;
      },
    });
    fireEvent.click(screen.getByRole('button', { name: TEXT.startMouse }));
    await waitFor(() => expect(scenes[0]?.start).toHaveBeenCalled());
    options[0]?.getFrame(FRAME_MS);
    return window.__worldPlayground?.snapshot().motion;
  } finally {
    if (original === undefined) delete (window as { matchMedia?: unknown }).matchMedia;
    else window.matchMedia = original;
    cleanup();
  }
}

describe('World Playground screens', () => {
  it('start panel buttons by role and name and the focus ring', () => {
    renderPlayground(harness('ready').deps);
    const mouse = screen.getByRole('button', { name: TEXT.startMouse });
    const camera = screen.getByRole('button', { name: TEXT.startCamera });
    mouse.focus();
    expect(document.activeElement).toBe(mouse);
    camera.focus();
    expect(document.activeElement).toBe(camera);
    const css = readFileSync(path.join(HERE, 'world.css'), 'utf8');
    expect(css).toMatch(/button:focus-visible,\s*input:focus-visible\s*\{\s*outline:\s*3px solid/);
  });

  it('invalid content shows the message and not the scene', () => {
    renderPlayground(harness('ready').deps, () => ({
      ok: false,
      issues: [{ path: 'layers', value: 1, message: 'layers = 1 is out of range (5, 6)' }],
    }));
    expect(screen.getByRole('alert').textContent).toBe(TEXT.contentInvalid);
    expect(screen.getByText(/layers = 1 is out of range/)).toBeTruthy();
    expect(screen.queryByTestId('world-play-area')).toBeNull();
    expect(screen.queryByRole('button', { name: TEXT.startMouse })).toBeNull();
  });

  it('the notice screen', async () => {
    const h = harness('ready');
    const content = validContent();
    const [first, ...rest] = content.stops;
    if (first === undefined) throw new Error('the content has no stops');
    const oneSlot: WorldContent = { ...content, stops: [{ ...first, slots: first.slots.slice(0, 1) }, ...rest] };
    renderPlayground(h.deps, () => ({ ok: true, content: oneSlot }));
    fireEvent.click(screen.getByRole('button', { name: TEXT.startMouse }));
    expect((await screen.findByRole('alert')).textContent).toBe(TEXT.noticePlacementNotSimultaneous);
    expect(h.scenes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: TEXT.back }));
    expect(screen.getByRole('button', { name: TEXT.startMouse })).toBeTruthy();
  });

  it('use mouse starts the scene and the pointer, with the simulated label', async () => {
    const h = harness('ready');
    renderPlayground(h.deps);
    fireEvent.click(screen.getByRole('button', { name: TEXT.startMouse }));
    await waitFor(() => expect(h.scenes).toHaveLength(1));
    expect(h.pointer.start).toHaveBeenCalled();
    expect(screen.getByText(TEXT.simulatedInput)).toBeTruthy();
    expect(screen.getByRole('button', { name: TEXT.exit })).toBeTruthy();
    expect(screen.getByTestId('world-play-area').style.touchAction).toBe('none');
  });

  it('camera stop on exit', async () => {
    const h = harness('ready');
    renderPlayground(h.deps);
    fireEvent.click(screen.getByRole('button', { name: TEXT.startCamera }));
    fireEvent.click(await screen.findByRole('button', { name: TEXT.exit }));
    expect(h.camera.dispose).toHaveBeenCalled();
    await waitFor(() => expect(h.scenes[0]?.dispose).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: TEXT.startMouse })).toBeTruthy();
  });

  it('camera stop on unmount', async () => {
    const h = harness('ready');
    const view = renderPlayground(h.deps);
    fireEvent.click(screen.getByRole('button', { name: TEXT.startCamera }));
    await screen.findByRole('button', { name: TEXT.exit });
    view.unmount();
    expect(h.camera.dispose).toHaveBeenCalled();
  });

  it('camera denied continues in mouse mode', async () => {
    const h = harness('denied');
    renderPlayground(h.deps);
    fireEvent.click(screen.getByRole('button', { name: TEXT.startCamera }));
    expect((await screen.findByText(TEXT.cameraUnavailable)).textContent).toBe(TEXT.cameraUnavailable);
    expect(screen.getByText(TEXT.simulatedInput)).toBeTruthy();
    expect(h.camera.dispose).toHaveBeenCalled();
    expect(h.pointer.start).toHaveBeenCalled();
    await waitFor(() => expect(h.scenes).toHaveLength(1));
  });

  it('window.__worldPlayground exists only under the world route', () => {
    window.history.replaceState({}, '', ROUTE_ON);
    const first = renderPlayground(harness('ready').deps);
    expect(window.__worldPlayground?.snapshot().screen).toBe('start');
    first.unmount();
    expect(window.__worldPlayground).toBeUndefined();
    window.history.replaceState({}, '', ROUTE_OFF);
    renderPlayground(harness('ready').deps);
    expect(window.__worldPlayground).toBeUndefined();
  });

  it('8.8: the slice starts at Reduced when the browser prefers reduced motion', async () => {
    expect(await motionOfFirstFrame(true)).toBe('reduced');
    expect(await motionOfFirstFrame(false)).toBe('full');
  });

  it('12.7: a selection recolours the target on the scene', async () => {
    window.localStorage.clear();
    window.history.replaceState({}, '', ROUTE_ON);
    const options: SceneManagerOptions[] = [];
    const scenes: ReturnType<typeof fakeScene>[] = [];
    // The pointer rests at the centre of the play area: in camera coordinates (1 - centre x / A, centre y).
    const centre = { x: DEFAULT_ASPECT * 0.5, y: 0.5 };
    const pointer = {
      start: vi.fn(async () => 'ready'),
      latest: () => ({
        landmarks: { rightWrist: { pos: { x: 1 - centre.x / DEFAULT_ASPECT, y: centre.y }, valid: true } },
      }),
      dispose: vi.fn(),
    };
    renderPlayground({
      createScene: async (sceneOptions) => {
        options.push(sceneOptions);
        const scene = fakeScene();
        scenes.push(scene);
        return scene as unknown as SceneManager;
      },
      createCamera: () => fakeSource('ready') as unknown as PoseSource,
      createPointer: () => pointer as unknown as PoseSource,
      isHidden: () => false,
    });
    fireEvent.click(screen.getByRole('button', { name: TEXT.startMouse }));
    await waitFor(() => expect(scenes[0]?.start).toHaveBeenCalled());
    const sceneOptions = options[0];
    const target = sceneOptions?.targets[0];
    if (sceneOptions === undefined || target === undefined) throw new Error('the scene has no target');
    // Hold the pointer on the target's hit circle until the dwell completes (about 1.5 s of presence time).
    const circle = { id: target.id, centre, radius: 0.1 };
    const scene = scenes[0];
    for (let frame = 0; frame < 100 && scene?.setTargetColour.mock.calls.length === 0; frame++) {
      sceneOptions.getFrame(100);
      sceneOptions.onFrame?.([circle]);
    }
    expect(scene?.setTargetColour).toHaveBeenCalledTimes(1);
    expect(scene?.setTargetColour).toHaveBeenCalledWith(target.id, colourNumber('lanternWarm'));
  });
});
