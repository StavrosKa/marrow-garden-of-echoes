// The play area (garden-level requirements 13.1, 13.2). It is the box the scene and the pointer share: a true 16:9 box,
// centred, at most the window's height below the header. `touch-action: none` stops a touch move from scrolling the page
// or cancelling the touch (Req 13.1). Overflow is hidden so the canvas, which the Scene Manager sizes from this box, cannot
// make the box taller than its aspect.
import type { ReactElement, ReactNode, Ref } from 'react';

/** The space above the play area (the label, the heading and the instruction line), in rem. */
const HEADER_REM = 12;

export interface PlayAreaProps {
  /** Width over height of the box. */
  readonly aspect: number;
  readonly areaRef?: Ref<HTMLDivElement>;
  readonly onPointerDown?: () => void;
  readonly children?: ReactNode;
}

export function PlayArea({ aspect, areaRef, onPointerDown, children }: PlayAreaProps): ReactElement {
  return (
    <div
      ref={areaRef}
      data-testid="play-area"
      className="garden-play"
      style={{
        position: 'relative',
        width: `min(100%, calc((100dvh - ${HEADER_REM}rem) * ${aspect}))`,
        aspectRatio: `${aspect}`,
        margin: '0 auto',
        overflow: 'hidden',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
    >
      {children}
    </div>
  );
}
