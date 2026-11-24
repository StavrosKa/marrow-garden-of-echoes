// Stage order and routing (design 2.6; Req 1.1, 20.1, 20.5). The stage ids and the route are fixed data, and
// parseStartParam reads a URL value that the player controls, so it must accept only the four ids.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseStartParam, ROUTE, STAGE_IDS, TITLE_OF, type RouteStep } from './stageOrder';

const RUNS = 300;

describe('stage order (stageOrder.test.ts)', () => {
  it('the four stage ids are accepted by parseStartParam', () => {
    for (const id of STAGE_IDS) {
      expect(parseStartParam(id)).toBe(id);
    }
    expect([...STAGE_IDS]).toEqual(['lantern-glade', 'whisper-glade', 'whisper-hall', 'bloom']);
  });

  it('an unknown stage id gives null', () => {
    expect(parseStartParam('lantern')).toBeNull();
    expect(parseStartParam('Lantern-Glade')).toBeNull();
    expect(parseStartParam('')).toBeNull();
    expect(parseStartParam(null)).toBeNull();
    expect(parseStartParam('bloom ')).toBeNull();
  });

  it('parseStartParam never throws on any input', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => parseStartParam(value as unknown as string | null)).not.toThrow();
      }),
      { numRuns: RUNS },
    );
  });

  it('the route lists the stages and travels in the order of design 2.6', () => {
    const shape = ROUTE.map((step: RouteStep) => (step.kind === 'stage' ? step.stage : step.journey));
    expect(shape).toEqual([
      'lantern-glade',
      'journeyA',
      'whisper-glade',
      'journeyB',
      'doorHall',
      'whisper-hall',
      'doorGarden',
      'bloom',
    ]);
  });

  it('only lantern-glade and whisper-hall have a title', () => {
    expect(TITLE_OF).toEqual({ 'lantern-glade': 'lantern', 'whisper-hall': 'hall' });
  });
});
