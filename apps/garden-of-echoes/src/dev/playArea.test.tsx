// @vitest-environment jsdom
// The play area component and one application of its plan (Req 26.5 to 26.9). jsdom has no layout, so the values
// are checked as attributes, which is what the browser draws from.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TUNING } from 'marrow/core';
import { applyPlayAreaPlan, createPlayAreaParts, planPlayArea, type TargetInput } from './playAreaPlan';
import { PlayArea } from './playArea';
import { COMPLETE_EASE_MS } from './playgroundRounds';
import type { RoundTarget } from './roundController';

const SLOTS = [
  { id: 'a', centre: { x: 0.3, y: 0.3 } },
  { id: 'b', centre: { x: 0.8, y: 0.6 } },
] as const;

function roundTargets(): RoundTarget[] {
  return SLOTS.map((slot, index) => ({ id: slot.id, activationId: `${slot.id}-1`, slot: slot.centre, slotPosition: index }));
}

function inputs(): TargetInput[] {
  return [
    { id: 'a', centre: SLOTS[0].centre, shown: true, completed: false, completedAtMs: null, owner: 'right', progress: 0.5 },
    { id: 'b', centre: SLOTS[1].centre, shown: true, completed: true, completedAtMs: 1000, owner: null, progress: 0 },
  ];
}

describe('the play area component', () => {
  it('renders one group per target, and an orb for each wrist, with nothing focusable', () => {
    const parts = createPlayAreaParts();
    const { container } = render(
      <PlayArea label="Play area" targets={roundTargets()} completedIds={['b']} wrists={['right']} parts={parts} />,
    );
    expect(container.querySelectorAll('g.playground-target')).toHaveLength(2);
    expect(container.querySelectorAll('circle.playground-orb')).toHaveLength(1);
    expect(container.querySelectorAll('button, a[href], input, [tabindex]')).toHaveLength(0);
    expect(container.querySelector('g.playground-target--completed')).not.toBeNull();
  });

  it('registers each element through its ref, so the loop can write to it', () => {
    const parts = createPlayAreaParts();
    render(<PlayArea label="Play area" targets={roundTargets()} completedIds={[]} wrists={['right']} parts={parts} />);
    expect(parts.targets.get('a')?.circle).toBeInstanceOf(SVGElement);
    expect(parts.targets.get('a')?.ring).toBeInstanceOf(SVGElement);
    expect(parts.targets.get('b')?.diamond).toBeInstanceOf(SVGElement);
    expect(parts.orbs.get('right')).toBeInstanceOf(SVGElement);
  });
});

describe('one application of the plan to the rendered elements', () => {
  it('shows a ring on the owned target, the diamond on the completed one, and hides an invalid orb', () => {
    const parts = createPlayAreaParts();
    const { container } = render(
      <PlayArea label="Play area" targets={roundTargets()} completedIds={['b']} wrists={['right']} parts={parts} />,
    );
    const pointers = [{ wrist: 'right' as const, valid: false as const }];
    applyPlayAreaPlan(
      parts,
      planPlayArea({ hitRadius: TUNING.hitRadius, nowMs: 1000 + COMPLETE_EASE_MS, easeMs: COMPLETE_EASE_MS, targets: inputs(), pointers }),
    );

    const ringA = parts.targets.get('a')?.ring;
    const diamondB = parts.targets.get('b')?.diamond;
    expect(ringA?.getAttribute('visibility')).toBe('visible');
    expect(Number(ringA?.getAttribute('r')) + Number(ringA?.getAttribute('stroke-width')) / 2).toBeCloseTo(TUNING.hitRadius, 12);
    expect(ringA?.getAttribute('stroke-dasharray')).toMatch(/^\S+ \S+$/);
    expect(diamondB?.getAttribute('visibility')).toBe('visible');
    expect(diamondB?.getAttribute('opacity')).toBe('1');
    expect(parts.targets.get('b')?.circle?.getAttribute('visibility')).toBe('hidden');
    expect(container.querySelector('circle.playground-orb')?.getAttribute('visibility')).toBe('hidden');
  });

  it('shows the orb at the pointer position when the wrist is valid', () => {
    const parts = createPlayAreaParts();
    const { container } = render(
      <PlayArea label="Play area" targets={[]} completedIds={[]} wrists={['right']} parts={parts} />,
    );
    applyPlayAreaPlan(
      parts,
      planPlayArea({
        hitRadius: TUNING.hitRadius,
        nowMs: 0,
        easeMs: COMPLETE_EASE_MS,
        targets: [],
        pointers: [{ wrist: 'right', valid: true, pos: { x: 0.25, y: 0.75 } }],
      }),
    );
    const orb = container.querySelector('circle.playground-orb');
    expect(orb?.getAttribute('visibility')).toBe('visible');
    expect(orb?.getAttribute('cx')).toBe('0.25');
    expect(orb?.getAttribute('cy')).toBe('0.75');
  });
});
