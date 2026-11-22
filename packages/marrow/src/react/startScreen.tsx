// The start screen (Requirement 22.1): its title, shown as the current instruction, and the Start
// control. Audio may start only from Start, so the app starts audio from onStart (Requirement 27).
import { useMarrowCopy } from './marrowCopy';
import { Button, InstructionLine, Panel } from './primitives';

export interface StartScreenProps {
  /** Called from the click or key press of the Start control. */
  onStart: () => void;
}

export function StartScreen({ onStart }: StartScreenProps) {
  const copy = useMarrowCopy();
  return (
    <Panel label={copy.start.title}>
      <InstructionLine text={copy.start.title} />
      <Button variant="primary" onClick={onStart}>
        {copy.start.start}
      </Button>
    </Panel>
  );
}
