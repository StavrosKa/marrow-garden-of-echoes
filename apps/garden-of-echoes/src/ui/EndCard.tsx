// The end card of the placeholder session (garden-level requirement 9.3). It shows the line of GARDEN_COPY and one Exit
// button, so a player can leave the session. Its container carries the test id `end-card`, and tests assert the id.
import type { ReactElement } from 'react';
import { textOf } from './copyLookup';

export interface EndCardProps {
  /** Leaves the session for Home. */
  readonly onExit: () => void;
}

export function EndCard({ onExit }: EndCardProps): ReactElement {
  return (
    <section className="garden-overlay" data-testid="end-card">
      <div className="garden-panel">
        <p className="garden-end__text">{textOf('end.card')}</p>
        <button type="button" className="garden-button" onClick={onExit}>
          {textOf('pause.exit')}
        </button>
      </div>
    </section>
  );
}
