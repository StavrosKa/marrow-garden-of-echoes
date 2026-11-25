// The motion setting of a frame (garden-level requirement 17.4). The stage reads the store in every frame, so a change made
// in the Pause screen takes effect in the next frame. The store is memory only in these tests (no storage).
import { describe, expect, it } from 'vitest';
import { createSettingsStore } from 'marrow/react';
import { motionAt } from './motion';

function store(prefersReducedMotion: boolean) {
  return createSettingsStore({ prefix: 'test.', storage: null, prefersReducedMotion });
}

describe('the motion setting of a frame (requirement 17.4)', () => {
  it('17.4: starts in Reduced when the browser prefers reduced motion, and in Full otherwise', () => {
    expect(motionAt(store(true))).toBe('reduced');
    expect(motionAt(store(false))).toBe('full');
  });

  it('17.4: a change takes effect in the next frame: the next read gives the new level', () => {
    const settings = store(false);
    expect(motionAt(settings)).toBe('full');
    settings.update({ motion: 'gentle' });
    expect(motionAt(settings)).toBe('gentle');
    settings.update({ motion: 'reduced' });
    expect(motionAt(settings)).toBe('reduced');
    settings.update({ motion: 'full' });
    expect(motionAt(settings)).toBe('full');
  });

  it('17.4: a change is visible to a frame that reads it after the change, with no wait', () => {
    const settings = store(false);
    const frames: string[] = [];
    frames.push(motionAt(settings));
    settings.update({ motion: 'reduced' });
    frames.push(motionAt(settings));
    expect(frames).toEqual(['full', 'reduced']);
  });
});
