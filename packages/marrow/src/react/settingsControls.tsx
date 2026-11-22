// The settings controls of marrow/react (Requirement 20.10, 22.9, 24.1): the motion choice, sound
// (mute and volume) and the simulated-input label. Each reads and writes the settings through
// useSettings and takes every string from MarrowCopy. The motion choice is stored and has no visible
// effect in this spec.
import { useId } from 'react';
import type { MotionLevel } from '../core';
import { useMarrowCopy } from './marrowCopy';
import { useSettings } from './settingsProvider';
import { CheckBox, RadioGroup, Slider } from './primitives';

// The volume is a fraction from 0 to 1, as the settings store defines it.
const VOLUME_RANGE = { min: 0, max: 1 } as const;

/** Full, Gentle and Reduced, as one radio group. */
export function MotionSetting() {
  const copy = useMarrowCopy();
  const { settings, update } = useSettings();
  const name = useId();
  const options: { value: MotionLevel; label: string }[] = [
    { value: 'full', label: copy.settings.full },
    { value: 'gentle', label: copy.settings.gentle },
    { value: 'reduced', label: copy.settings.reduced },
  ];
  return (
    <RadioGroup<MotionLevel>
      legend={copy.settings.motion}
      name={name}
      options={options}
      value={settings.motion}
      onChange={(motion) => update({ motion })}
    />
  );
}

/** Mute, and the volume as a range. */
export function AudioSettings() {
  const copy = useMarrowCopy();
  const { settings, update } = useSettings();
  return (
    <fieldset className="marrow-choices">
      <legend>{copy.settings.sound}</legend>
      <CheckBox label={copy.settings.mute} checked={settings.mute} onChange={(mute) => update({ mute })} />
      <Slider
        label={copy.settings.volume}
        min={VOLUME_RANGE.min}
        max={VOLUME_RANGE.max}
        step="any"
        value={settings.volume}
        onChange={(volume) => update({ volume })}
      />
    </fieldset>
  );
}

/** The small persistent label that marks simulated input. */
export function SimulatedInputLabel() {
  const copy = useMarrowCopy();
  return <p className="marrow-label">{copy.simulatedInputLabel}</p>;
}
