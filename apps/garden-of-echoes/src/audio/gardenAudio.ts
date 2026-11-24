// The garden's sound (garden-level design 2.10; requirements 18.1 to 18.5). The notes go through the tone player, so
// there is one audio path. Audio starts only from a user action: start() takes the gesture of a UI handler, and with
// no gesture it does nothing (Req 18.2). Every note has a visual cue (Req 18.4). Audio never gates a rule, so the game
// completes with audio muted (Req 18.5).
import { LANTERN_NOTES, noteHz } from './pentatonic';
import type { TonePlayer } from './tonePlayer';

/** A user action that allows audio to start. A UI handler makes one from its own event (Req 18.2). */
export interface UserGesture {
  readonly kind: 'pointerdown' | 'click' | 'keydown';
}

/** What a note shows on screen: the lantern it belongs to (Req 18.4). */
export interface VisualCue {
  readonly lantern: number;
}

export interface GardenAudio {
  /** Starts the audio. With no gesture, nothing starts (Req 18.2). Call it only from a Start handler. */
  start(gesture: UserGesture | null): void;
  /** Plays the note of lantern `index` once audio has started, and returns the cue that the screen shows (Req 18.4). */
  playNote(index: number): VisualCue;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  dispose(): void;
}

/** The visual cue of a note. Every note has one (Req 18.4). */
export function visualCueFor(index: number): VisualCue {
  return { lantern: index };
}

/** The sound layer over a tone player. The player does nothing until start, so a note before start is silent. */
export function createGardenAudio(player: TonePlayer): GardenAudio {
  let started = false;
  return {
    start(gesture: UserGesture | null): void {
      if (gesture === null) return;
      started = true;
      player.start();
    },
    playNote(index: number): VisualCue {
      const name = LANTERN_NOTES[index];
      if (started && name !== undefined) player.playFrequency(noteHz(name));
      return visualCueFor(index);
    },
    setMuted(muted: boolean): void {
      player.setMuted(muted);
    },
    setVolume(volume: number): void {
      player.setVolume(volume);
    },
    dispose(): void {
      player.dispose();
    },
  };
}
