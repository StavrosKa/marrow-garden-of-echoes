// The one in-world instruction line (garden-level requirements 15.1 to 15.3). It shows one line at a time, and the same
// text is exposed in an aria-live="polite" region, so a screen reader hears the current instruction. The quiet light hint
// shows only when no required instruction is pending, and it never replaces a required one (Req 15.3).
import type { ReactElement } from 'react';
export interface InstructionLineProps {
  /** The instruction the player must act on now, or null when none is pending. */
  readonly required: string | null;
  /** The quiet hint. It is shown only when `required` is null. */
  readonly quiet?: string | null;
}

/** The text the line shows: the required instruction when there is one, else the quiet hint, else nothing. */
export function lineTextOf(required: string | null, quiet: string | null = null): string | null {
  return required ?? quiet;
}

export function InstructionLine({ required, quiet = null }: InstructionLineProps): ReactElement {
  return (
    <p className="garden-instruction" aria-live="polite">
      {lineTextOf(required, quiet) ?? ''}
    </p>
  );
}
