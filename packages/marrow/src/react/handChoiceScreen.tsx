// The hand choice screen (Requirement 22.4): Right, Left or Both, and Continue. The stored choice is
// pre-selected. With none stored nothing is selected, and Continue stays disabled until a choice is
// made. The selection is local: it is stored only when Continue is pressed (update({ hands })), so
// leaving the screen with Escape or Exit stores nothing.
import { useId, useState } from 'react';
import type { Settings } from '../core';
import { useMarrowCopy } from './marrowCopy';
import { Button, InstructionLine, Panel, RadioGroup } from './primitives';
import { useSettings } from './settingsProvider';

/** The hands a player can choose, as the settings store keeps them. */
export type HandChoice = NonNullable<Settings['hands']>;

export interface HandChoiceScreenProps {
  /** Called with the chosen hand after it has been stored. */
  onContinue: (hand: HandChoice) => void;
}

export function HandChoiceScreen({ onContinue }: HandChoiceScreenProps) {
  const copy = useMarrowCopy();
  const { settings, update } = useSettings();
  const name = useId();
  const [selected, setSelected] = useState<HandChoice | null>(settings.hands);
  const options: { value: HandChoice; label: string }[] = [
    { value: 'right', label: copy.hands.right },
    { value: 'left', label: copy.hands.left },
    { value: 'both', label: copy.hands.both },
  ];
  function continueWith(): void {
    if (selected === null) return;
    update({ hands: selected });
    onContinue(selected);
  }
  return (
    <Panel label={copy.hands.question}>
      <InstructionLine text={copy.hands.question} />
      <RadioGroup<HandChoice>
        legend={copy.hands.question}
        legendVisible={false}
        name={name}
        options={options}
        value={selected}
        onChange={setSelected}
      />
      <Button variant="primary" disabled={selected === null} onClick={continueWith}>
        {copy.hands.continue}
      </Button>
    </Panel>
  );
}
