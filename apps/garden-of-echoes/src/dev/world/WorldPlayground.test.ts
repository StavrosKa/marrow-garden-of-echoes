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
import type { SceneManager } from 'world-view/pixi';
import { copy } from '../../copy';
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
});
