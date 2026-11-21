// The read-only debug panel (Req 11.7, 14.2; design 8.2). It shows the values of the snapshot and
// changes nothing. Labels come from copy/. The values are compact developer numbers, so their
// separators hold no space (the scan of design 9.2 reads every string with a space as player text).
import type { ReactElement } from 'react';
import { copy } from '../../copy';
import type { WorldSnapshot } from './worldSession';

const DIGITS = 3;
const ZERO = 0;
const NO_VEC = { x: ZERO, y: ZERO };

function num(value: number): string {
  return value.toFixed(DIGITS);
}

function vec(value: { readonly x: number; readonly y: number }): string {
  return `(${num(value.x)},${num(value.y)})`;
}

function Row(props: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </>
  );
}

export function DebugPanel(props: { readonly snapshot: WorldSnapshot }): ReactElement | null {
  const { snapshot: s } = props;
  const text = copy.worldPlayground.debug;
  if (s.view === undefined || s.targets === undefined) return null;
  const { targets } = s;
  const targetLines = Object.entries(targets).map(
    ([id, t]) =>
      `${id}:stop${t.stop},active=${t.active},selected=${t.selected},dwell=${num(t.dwell.progress)},rendered=${
        t.rendered === null ? text.none : vec(t.rendered)
      },circle=${t.circle === null ? text.none : `${vec(t.circle.centre)}r=${num(t.circle.radius)}`}`,
  );
  const circleLines = (s.circles ?? []).map((circle) => `${circle.id}${vec(circle.centre)}r=${num(circle.radius)}`);
  const handPos = s.pointer?.pos ?? null;
  return (
    <section aria-label={copy.worldPlayground.debugHeading} className="debug">
      <h2>{copy.worldPlayground.debugHeading}</h2>
      <dl>
        <Row label={text.input} value={s.inputMode ?? ''} />
        <Row label={text.driverOn} value={`${s.driver?.on === true}${vec(s.driver?.value ?? NO_VEC)}`} />
        <Row label={text.motion} value={s.motion ?? ''} />
        <Row label={text.view} value={`${num(s.view.travel)},${vec(s.view.head)}`} />
        <Row label={text.interactionHead} value={vec(s.interactionHead ?? NO_VEC)} />
        <Row label={text.decorativeHead} value={vec(s.decorativeHead ?? NO_VEC)} />
        <Row label={text.lock} value={`${s.lock?.requested === true},${s.lock?.mode ?? ''}`} />
        <Row
          label={text.clocks}
          value={`${num(s.clocks?.rawDt ?? ZERO)},${num(s.clocks?.presenceDt ?? ZERO)},${num(s.clocks?.sessionDt ?? ZERO)}`}
        />
        <Row label={text.flags} value={`${s.paused === true},${s.hidden === true},${s.hold === true}`} />
        <Row
          label={text.travel}
          value={[
            s.travel?.phase ?? '',
            s.travel?.style ?? text.none,
            s.travel?.level ?? '',
            num(s.travel?.progress ?? ZERO),
            num(s.travel?.cover ?? ZERO),
            num(s.travel?.remainingMs ?? ZERO),
          ].join(',')}
        />
        <Row label={text.reward} value={`${num(s.reward?.elapsedMs ?? ZERO)},${s.reward?.started === true}`} />
        <Row label={text.frame} value={`${num(s.frame?.aspect ?? ZERO)},${num(s.frame?.sceneScale ?? ZERO)}`} />
        <Row label={text.canvas} value={`${s.canvas?.width ?? ZERO}x${s.canvas?.height ?? ZERO}`} />
        <Row label={text.pixelRatio} value={num(s.pixelRatio ?? ZERO)} />
        <Row
          label={text.placement}
          value={(s.placement ?? [])
            .map((stop) => `${stop.id},${stop.kind},m=${num(stop.m)},r=${num(stop.r)},slots=${stop.slots.length}`)
            .join(';')}
        />
        <Row
          label={text.comfort}
          value={`${s.comfort?.kind ?? ''},gain=${num(s.comfort?.gain ?? ZERO)},${s.comfort?.calibration ?? ''}`}
        />
        <Row label={text.comfortNote} value={text.comfortNote} />
        <Row label={text.targets} value={targetLines.join(';')} />
        <Row label={text.layers} value={(s.layers ?? []).map((layer) => `${layer.id}${vec(layer)}s=${num(layer.scale)}`).join(';')} />
        <Row label={text.circles} value={circleLines.join(';') || text.none} />
        <Row label={text.hand} value={`${s.pointer?.valid === true},${handPos === null ? text.none : vec(handPos)}`} />
      </dl>
    </section>
  );
}
