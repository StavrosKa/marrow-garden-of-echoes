// The entry point marrow/challenges (design section 1.2). The attention round and its generator and
// tuning. placementBand joins this list in task 5.
export { seedRng, nextUnit, shuffle, type Rng } from './rng';
export { ATTENTION_TUNING, validateAttentionTuning, type AttentionTuning } from './tuning';
export {
  attentionWindowsFor,
  blockProblems,
  createAttentionRound,
  currentPresentation,
  orderBlocks,
  stepAttention,
  type AttentionEvent,
  type AttentionInput,
  type AttentionPhase,
  type AttentionState,
  type AttentionWindows,
  type Mark,
  type Presentation,
} from './attention';
