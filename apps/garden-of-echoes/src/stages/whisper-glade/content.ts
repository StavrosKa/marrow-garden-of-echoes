// Content of whisper-glade (design 4.2): the placeholder shape of stages/shared/placeholderContent.ts. Tasks 6 and 8
// replace this content for the two stages that are still placeholders in task 3.
import { loadPlaceholder, validatePlaceholder, type PlaceholderContent } from '../shared/placeholderContent';
import type { ContentResult } from '../shared/stageTypes';

export function validateWhisperGlade(json: unknown): ContentResult<PlaceholderContent> {
  return validatePlaceholder(json, 'whisper-glade');
}

export function loadWhisperGlade(json: unknown): PlaceholderContent {
  return loadPlaceholder(json, 'whisper-glade');
}
