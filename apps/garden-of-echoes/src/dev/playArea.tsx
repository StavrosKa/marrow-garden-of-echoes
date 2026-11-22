// The play area's elements (Req 26.5 to 26.9). React renders the shapes once per round change, and each element
// registers itself through a ref. The frame loop then writes the values for each frame with `applyPlayAreaPlan`
// (playAreaPlan.ts), so React does not run on every frame and a ring never waits for it.
//
// Initial attributes hide everything. The first frame of a run sets the real values.
import type { ReactElement } from 'react';
import { TUNING, type WristId } from 'marrow/core';
import { ORB_RADIUS, PLAY_ASPECT, type PlayAreaParts, type TargetParts } from './playAreaPlan';
import type { RoundTarget } from './roundController';

export interface PlayAreaProps {
  /** The accessible name of the play area, from the copy. */
  readonly label: string;
  /** The round's targets that are drawn now: open ones, and completed ones. */
  readonly targets: readonly RoundTarget[];
  readonly completedIds: readonly string[];
  /** The wrists that get an orb. */
  readonly wrists: readonly WristId[];
  readonly parts: PlayAreaParts;
}

/** The registered parts of one target, created on first use and kept for the component's life. */
function partsOf(parts: PlayAreaParts, id: string): TargetParts {
  const existing = parts.targets.get(id);
  if (existing !== undefined) return existing;
  const created: TargetParts = { circle: null, diamond: null, ring: null };
  parts.targets.set(id, created);
  return created;
}

function TargetShapes({ id, completed, parts }: { id: string; completed: boolean; parts: PlayAreaParts }): ReactElement {
  return (
    <g className={completed ? 'playground-target playground-target--completed' : 'playground-target'}>
      <circle
        className="playground-target-shape"
        r={TUNING.hitRadius}
        ref={(element) => {
          partsOf(parts, id).circle = element;
        }}
      />
      <path
        className="playground-target-diamond"
        visibility="hidden"
        ref={(element) => {
          partsOf(parts, id).diamond = element;
        }}
      />
      <circle
        className="playground-ring"
        fill="none"
        visibility="hidden"
        ref={(element) => {
          partsOf(parts, id).ring = element;
        }}
      />
    </g>
  );
}

/** The play area as an SVG in play-area units. Its viewBox has the play aspect, so a shape's units are the screen's. */
export function PlayArea({ label, targets, completedIds, wrists, parts }: PlayAreaProps): ReactElement {
  return (
    <svg className="playground-area" viewBox={`0 0 ${PLAY_ASPECT} 1`} role="group" aria-label={label}>
      {targets.map((target) => (
        <TargetShapes key={target.id} id={target.id} completed={completedIds.includes(target.id)} parts={parts} />
      ))}
      {wrists.map((wrist) => (
        <circle
          key={wrist}
          className="playground-orb"
          r={ORB_RADIUS}
          visibility="hidden"
          aria-hidden="true"
          ref={(element) => {
            parts.orbs.set(wrist, element);
          }}
        />
      ))}
    </svg>
  );
}
