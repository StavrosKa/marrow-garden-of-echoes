// The placeholder rule of Whisper Hall (design 2.7; Req 9.1): one target, and selecting it completes the stage.
// The rule lives in stages/shared/placeholderRule.ts, and this file gives it the stage's name.
export { createPlaceholder, stepPlaceholder, targetIdOf, type PlaceholderState } from '../shared/placeholderRule';
