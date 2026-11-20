// The start panel of the slice (Req 14.1, 13.4; design 8.1). Real buttons and radio buttons with names
// from copy/. It starts nothing itself: the buttons call the session through the props.
import type { ReactElement } from 'react';
import { copy } from '../../copy';
import type { SegmentKind } from './worldSession';

export interface StartPanelProps {
  readonly segment: SegmentKind;
  readonly onSegment: (kind: SegmentKind) => void;
  readonly onMouse: () => void;
  readonly onCamera: () => void;
}

const SEGMENTS: readonly { readonly kind: SegmentKind; readonly label: string }[] = [
  { kind: 'journey', label: copy.worldPlayground.segmentJourney },
  { kind: 'door', label: copy.worldPlayground.segmentDoor },
];

export function StartPanel(props: StartPanelProps): ReactElement {
  const { worldPlayground: text } = copy;
  return (
    <section aria-labelledby="world-start-heading">
      <h2 id="world-start-heading">{text.startHeading}</h2>
      <fieldset>
        <legend>{text.segmentLegend}</legend>
        {SEGMENTS.map((option) => (
          <label key={option.kind}>
            <input
              type="radio"
              name="world-segment"
              value={option.kind}
              checked={props.segment === option.kind}
              onChange={() => props.onSegment(option.kind)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <p>{text.cameraWhy}</p>
      <div>
        <button type="button" onClick={props.onMouse}>
          {text.startMouse}
        </button>
        <button type="button" onClick={props.onCamera}>
          {text.startCamera}
        </button>
      </div>
    </section>
  );
}
