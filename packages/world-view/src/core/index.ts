export { TUNING, validateTuning, type Tuning } from './tuning';
export { formatIssues, type ValidationIssue } from './issues';
export type { LayerRef, WorldPoint, View, ProjectionFrame, Rect } from './types';
export { worldToScreen, screenToWorld, depthScale, isCulled } from './projection';
export { parallaxShift, parallaxMargin } from './parallax';
export { edgeOverscan, backdropRect, shapeOverscanIssues, type TravelRange } from './overscan';
export { targetScreen, type ScreenTarget } from './target';
export { createGlide, stepGlide, type GlideState } from './glide';
export { createLock, stepLock, type LockInput, type LockMode, type LockState, type LockStep } from './lock';
export { motionProfile, type MotionProfile } from './motion';
export {
  resolveLayerTable,
  validateLayerTable,
  type LayerDef,
  type LayerTableEntry,
} from './layers';
export { validateSegment, checkDepthScaling, type SegmentKind, type SegmentSpec } from './segments';
