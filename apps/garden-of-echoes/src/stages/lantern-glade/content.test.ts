// Contract test for lantern-glade content (design 4.3), built on stages/shared/contract.ts.
import { placeholderMutations, registerContract } from '../shared/contract';
import shipped from './content.json';
import { loadLanternGlade, validateLanternGlade } from './content';


registerContract({
  stage: 'lantern-glade',
  validate: validateLanternGlade,
  load: loadLanternGlade,
  shipped,
  mutations: placeholderMutations('bloom'),
});
