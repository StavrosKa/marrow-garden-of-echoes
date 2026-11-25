// Contract test for bloom content (design 4.3), built on stages/shared/contract.ts.
import { placeholderMutations, registerContract } from '../shared/contract';
import shipped from './content.json';
import { loadBloom, validateBloom } from './content';
import { createPlaceholder, stepPlaceholder, targetIdOf } from './rules';

import { describe, expect, it } from 'vitest';
import { TUNING as WORLD_TUNING } from 'world-view';
import { loadSegments } from '../../journeys/journeys';
import segmentsJson from '../../journeys/segments.json';

registerContract({
  stage: 'bloom',
  validate: validateBloom,
  load: loadBloom,
  shipped,
  mutations: placeholderMutations('whisper-hall'),
  copyKeys: (content) => [content.target.copy],
  rule: (content) => stepPlaceholder(createPlaceholder(content), [targetIdOf(content)]).completed,
});

describe('the Bloom slot (requirement 9.2)', () => {
  it('is anchored at the garden door arrival, so it is at scale 1 there, and its depth clears the near plane', () => {
    const slot = loadBloom(shipped).target.slots[0];
    expect(slot?.anchor).toBe(loadSegments(segmentsJson).doorGarden.to);
    expect((slot?.depth ?? 0) - (slot?.anchor ?? 0)).toBeGreaterThan(WORLD_TUNING.nearPlane);
  });
});
