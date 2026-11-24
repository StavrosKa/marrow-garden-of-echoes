// Contract test for whisper-hall content (design 4.3), built on stages/shared/contract.ts.
import { placeholderMutations, registerContract } from '../shared/contract';
import shipped from './content.json';
import { loadWhisperHall, validateWhisperHall } from './content';
import { createPlaceholder, stepPlaceholder, targetIdOf } from './rules';

registerContract({
  stage: 'whisper-hall',
  validate: validateWhisperHall,
  load: loadWhisperHall,
  shipped,
  mutations: placeholderMutations('bloom'),
  rule: (content) => stepPlaceholder(createPlaceholder(content), [targetIdOf(content)]).completed,
});
