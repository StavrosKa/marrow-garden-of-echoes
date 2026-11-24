// Contract test for whisper-glade content (design 4.3), built on stages/shared/contract.ts.
import { placeholderMutations, registerContract } from '../shared/contract';
import shipped from './content.json';
import { loadWhisperGlade, validateWhisperGlade } from './content';


registerContract({
  stage: 'whisper-glade',
  validate: validateWhisperGlade,
  load: loadWhisperGlade,
  shipped,
  mutations: placeholderMutations('whisper-hall'),
  copyKeys: (content) => [content.target.copy],
});
