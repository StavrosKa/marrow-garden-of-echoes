// Contract test for bloom content (design 4.3), built on stages/shared/contract.ts.
import { placeholderMutations, registerContract } from '../shared/contract';
import shipped from './content.json';
import { loadBloom, validateBloom } from './content';
import { createPlaceholder, stepPlaceholder, targetIdOf } from './rules';

registerContract({
  stage: 'bloom',
  validate: validateBloom,
  load: loadBloom,
  shipped,
  mutations: placeholderMutations('whisper-hall'),
  copyKeys: (content) => [content.target.copy],
  rule: (content) => stepPlaceholder(createPlaceholder(content), [targetIdOf(content)]).completed,
});
