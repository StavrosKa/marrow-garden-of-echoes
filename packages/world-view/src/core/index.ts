export { TUNING, validateTuning, type Tuning } from './tuning';
export { formatIssues, type ValidationIssue } from './issues';
export type { LayerRef, WorldPoint, View, ProjectionFrame, Rect } from './types';
export { worldToScreen, screenToWorld, depthScale, isCulled } from './projection';
export { parallaxShift, parallaxMargin } from './parallax';
export { edgeOverscan, backdropRect, shapeOverscanIssues, type TravelRange } from './overscan';
export { targetScreen, type ScreenTarget } from './target';
export {
  resolveLayerTable,
  validateLayerTable,
  type LayerDef,
  type LayerTableEntry,
} from './layers';
export { validateSegment, checkDepthScaling, type SegmentKind, type SegmentSpec } from './segments';
