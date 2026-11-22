// The round progression of the playground (Req 26.9, 26.10). The shipped content gives real slots; every grid cell
// is valid, so Placement finds three simultaneous targets. The wait is read from ROUND_PAUSE_MS, and the session time
// is passed in, as the controller passes it (it does not advance in a pause or a hold).
import { describe, expect, it } from 'vitest';
import { createGrid, makeMapping, markAllValid, TUNING, type WristId } from 'marrow/core';
import { advanceRound, COMPLETE_EASE_MS, firstRound, NO_ROUND, recordSelection, ROUND_PAUSE_MS, type RoundProgress } from './playgroundRounds';
import { readPlaygroundContent } from './playgroundContent';
import shipped from './playground-content.json';
import type { RoundEnvironment } from './roundController';

const PLAY_ASPECT = 1.6;
const loaded = readPlaygroundContent(shipped);
if (!loaded.ok) throw new Error(loaded.message);
const CONTENT = loaded.content;

function env(): RoundEnvironment {
  const grid = markAllValid(createGrid(TUNING));
  const grids: { [W in WristId]?: typeof grid } = { right: grid };
  return {
    content: CONTENT,
    playAspect: PLAY_ASPECT,
    frameAspect: PLAY_ASPECT,
    grids,
    mapping: makeMapping({ playAspect: PLAY_ASPECT, frameAspect: PLAY_ASPECT, gain: 1, centre: { x: PLAY_ASPECT / 2, y: 0.5 } }),
  };
}

/** The ids of the open targets of a progress, in order. */
function openIds(progress: RoundProgress): string[] {
  return progress.round?.targets.filter((t) => !progress.round?.completed.includes(t.id)).map((t) => t.id) ?? [];
}

describe('the app values of the round (Appendix B: app values, beside the code)', () => {
  it('waits at least as long as the completed shape takes to ease', () => {
    expect(ROUND_PAUSE_MS).toBeGreaterThanOrEqual(COMPLETE_EASE_MS);
  });
});

describe('the round wait', () => {
  it('records a selection and keeps the round on screen until the wait has passed', () => {
    let progress = firstRound(env());
    const ids = progress.round?.targets.map((t) => t.id) ?? [];
    expect(ids).toHaveLength(3);
    let session = 1000;
    for (const id of ids) {
      progress = recordSelection(progress, id, session);
      session += 200;
    }
    const lastSelection = session - 200;
    expect(progress.nextRoundAtMs).toBe(lastSelection + ROUND_PAUSE_MS);
    // Still on the first round just before the wait ends, and the last target stays completed in it.
    const before = advanceRound(progress, lastSelection + ROUND_PAUSE_MS - 1, env());
    expect(before.round?.round).toBe(1);
    expect(before.round?.completed).toEqual(ids);
    // The next round starts when the wait ends, with new ids and nothing completed.
    const after = advanceRound(progress, lastSelection + ROUND_PAUSE_MS, env());
    expect(after.round?.round).toBe(2);
    expect(after.round?.completed).toEqual([]);
    expect(after.nextRoundAtMs).toBeNull();
    for (const target of after.round?.targets ?? []) expect(ids).not.toContain(target.id);
  });

  it('does not advance while the session time stands still, as in a pause or a hold', () => {
    let progress = firstRound(env());
    const ids = progress.round?.targets.map((t) => t.id) ?? [];
    for (const id of ids) progress = recordSelection(progress, id, 5000);
    const frozen = advanceRound(progress, 5000, env());
    expect(frozen).toBe(progress);
  });

  it('ignores a selection of a target that is not open, so it cannot complete a round twice', () => {
    const progress = firstRound(env());
    const [first] = openIds(progress);
    if (first === undefined) throw new Error('no open target');
    const once = recordSelection(progress, first, 100);
    expect(recordSelection(once, first, 200)).toBe(once);
    expect(recordSelection(progress, 'not-a-target', 100)).toBe(progress);
  });

  it('does nothing before calibration: no round, no wait', () => {
    expect(recordSelection(NO_ROUND, 'r1-0', 10)).toBe(NO_ROUND);
    expect(advanceRound(NO_ROUND, 10_000, env())).toBe(NO_ROUND);
  });
});
