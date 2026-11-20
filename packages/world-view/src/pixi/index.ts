// The entry point `world-view/pixi` (design 1.3): the Scene Manager with the real PixiJS ports.
import { createPixiPorts } from './pixiPorts';
import { createSceneManager as createWithPorts } from './sceneManager';
import type { SceneManager, SceneManagerOptions } from './types';

export function createSceneManager(options: SceneManagerOptions): SceneManager {
  return createWithPorts(options, createPixiPorts());
}

export type {
  DebugEntry,
  FrameData,
  HitCircle,
  SceneLayerSpec,
  SceneManager,
  SceneManagerOptions,
  SceneTarget,
  ShapeSpec,
} from './types';
