// The garden's sound (requirements 18.1 to 18.5, and the note part of 4.2). A fake tone player records every call,
// so the tests check what reaches the player without a browser. The lantern rule runs with audio muted to show that
// audio never gates a stage.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadLanternGlade } from '../stages/lantern-glade/content';
import shipped from '../stages/lantern-glade/content.json';
import { createLanternGlade, stepLanternGlade, targetIdOf } from '../stages/lantern-glade/rules';
import { placedFor } from '../stages/lantern-glade/testPlaced';
import { createGardenAudio, visualCueFor } from './gardenAudio';
import { A4_HZ, LANTERN_NOTES, noteHz } from './pentatonic';
import type { TonePlayer } from './tonePlayer';

/** A tone player that records each call. */
class FakePlayer implements TonePlayer {
  starts = 0;
  readonly frequencies: number[] = [];
  readonly volumes: number[] = [];
  readonly muted: boolean[] = [];
  disposes = 0;
  start(): void {
    this.starts += 1;
  }
  playTarget(): void {
    // The garden does not use playTarget.
  }
  playFrequency(hz: number): void {
    this.frequencies.push(hz);
  }
  setVolume(volume: number): void {
    this.volumes.push(volume);
  }
  setMuted(muted: boolean): void {
    this.muted.push(muted);
  }
  dispose(): void {
    this.disposes += 1;
  }
}

const CLICK = { kind: 'click' } as const;
const PENTATONIC_CLASSES: ReadonlySet<string> = new Set(['C', 'D', 'E', 'G', 'A']);
const GARDEN_AUDIO_FILES = [
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'gardenAudio.ts'),
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'pentatonic.ts'),
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'tonePlayer.ts'),
];

describe('garden audio', () => {
  it('18.2: start with no user action starts nothing', () => {
    const player = new FakePlayer();
    createGardenAudio(player).start(null);
    expect(player.starts).toBe(0);
  });

  it('18.2: start from a user action starts the player', () => {
    const player = new FakePlayer();
    createGardenAudio(player).start(CLICK);
    expect(player.starts).toBe(1);
  });

  it('18.2: no note reaches the player before a user action', () => {
    const player = new FakePlayer();
    const audio = createGardenAudio(player);
    audio.playNote(0);
    expect(player.frequencies).toEqual([]);
    audio.start(null);
    audio.playNote(0);
    expect(player.frequencies).toEqual([]);
    audio.start(CLICK);
    audio.playNote(0);
    expect(player.frequencies).toEqual([noteHz(LANTERN_NOTES[0])]);
  });

  it('18.4: every note has a visual cue for its lantern, and the note is played with it', () => {
    const player = new FakePlayer();
    const audio = createGardenAudio(player);
    audio.start(CLICK);
    LANTERN_NOTES.forEach((name, index) => {
      expect(visualCueFor(index)).toEqual({ lantern: index });
      expect(audio.playNote(index)).toEqual({ lantern: index });
      expect(player.frequencies.at(-1)).toBe(noteHz(name));
    });
    expect(player.frequencies).toHaveLength(LANTERN_NOTES.length);
  });

  it('4.2 18.1: the four lantern notes are in the C major pentatonic scale, one per lantern', () => {
    expect([...LANTERN_NOTES]).toEqual(['C4', 'D4', 'E4', 'G4']);
    for (const name of LANTERN_NOTES) {
      expect(PENTATONIC_CLASSES.has(name.charAt(0))).toBe(true);
    }
    expect(LANTERN_NOTES).toHaveLength(loadLanternGlade(shipped).lanterns);
  });

  it('18.1: each note is an equal-tempered frequency with A4 at A4_HZ', () => {
    expect(noteHz('C4')).toBeCloseTo(261.626, 2);
    expect(noteHz('D4')).toBeCloseTo(293.665, 2);
    expect(noteHz('E4')).toBeCloseTo(329.628, 2);
    expect(noteHz('G4')).toBeCloseTo(391.995, 2);
    expect(A4_HZ).toBe(440);
  });

  it('18.5 4.2: the game completes with audio muted, because the lantern rule does not read the sound', () => {
    const player = new FakePlayer();
    const audio = createGardenAudio(player);
    audio.start(CLICK);
    audio.setMuted(true);
    const content = loadLanternGlade(shipped);
    let state = createLanternGlade(content, placedFor(content), 'full');
    let completed = false;
    for (let index = 0; index < content.lanterns; index++) {
      audio.playNote(index);
      const step = stepLanternGlade(state, [targetIdOf(index)], 0);
      state = step.state;
      completed = step.completed;
    }
    expect(completed).toBe(true);
    expect(player.muted).toEqual([true]);
  });

  it('18.2 21: volume and mute reach the player, and dispose closes it once', () => {
    const player = new FakePlayer();
    const audio = createGardenAudio(player);
    audio.setVolume(0.3);
    audio.setMuted(true);
    audio.dispose();
    expect(player.volumes).toEqual([0.3]);
    expect(player.muted).toEqual([true]);
    expect(player.disposes).toBe(1);
  });

  it('18.1: the audio code uses oscillators only and no audio files', () => {
    for (const file of GARDEN_AUDIO_FILES) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/createBufferSource|decodeAudioData|\.(mp3|wav|ogg|m4a)\b/);
    }
    expect(readFileSync(GARDEN_AUDIO_FILES[2] as string, 'utf8')).toContain('createOscillator');
  });
});
