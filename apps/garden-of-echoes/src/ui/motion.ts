// The motion setting of a frame (garden-level requirement 17.4). The stage reads the settings store once per frame, so a
// change made in the Pause screen is in force from the next frame. Nothing here caches the level.
import type { MotionLevel } from 'marrow/core';
import type { SettingsStore } from 'marrow/react';

/** The motion level a frame uses, read from the store when the frame runs. */
export function motionAt(settings: SettingsStore): MotionLevel {
  return settings.get().motion;
}
