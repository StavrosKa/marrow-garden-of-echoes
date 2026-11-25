// @vitest-environment jsdom
// The instruction line (garden-level requirements 15.1 to 15.3). The line is one element, in a polite live region.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GARDEN_COPY } from '../copy/garden';
import { InstructionLine, lineTextOf } from './InstructionLine';

describe('InstructionLine (requirements 15.1 to 15.3)', () => {
  it('15.1: shows the one required instruction', () => {
    render(<InstructionLine required={GARDEN_COPY.lantern.first} />);
    expect(screen.getByText(GARDEN_COPY.lantern.first)).toBeTruthy();
  });

  it('15.2: the line is an aria-live polite region, so the current instruction is announced', () => {
    const { container } = render(<InstructionLine required={GARDEN_COPY.lantern.first} />);
    const line = container.querySelector('p');
    expect(line?.getAttribute('aria-live')).toBe('polite');
    expect(line?.textContent).toBe(GARDEN_COPY.lantern.first);
  });

  it('15.3: the quiet hint shows when no required instruction is pending', () => {
    render(<InstructionLine required={null} quiet={GARDEN_COPY.hint.light} />);
    expect(screen.getByText(GARDEN_COPY.hint.light)).toBeTruthy();
  });

  it('15.3: the quiet hint never replaces a required instruction', () => {
    render(<InstructionLine required={GARDEN_COPY.lantern.first} quiet={GARDEN_COPY.hint.light} />);
    expect(screen.getByText(GARDEN_COPY.lantern.first)).toBeTruthy();
    expect(screen.queryByText(GARDEN_COPY.hint.light)).toBeNull();
  });

  it('15.1: with nothing to say the line is empty, and it is still in the live region', () => {
    const { container } = render(<InstructionLine required={null} />);
    expect(container.querySelector('p')?.textContent).toBe('');
  });
});

describe('lineTextOf (requirement 15.3)', () => {
  it('a required line wins over the quiet hint, and the hint shows only alone', () => {
    expect(lineTextOf('Required.', 'Quiet.')).toBe('Required.');
    expect(lineTextOf(null, 'Quiet.')).toBe('Quiet.');
    expect(lineTextOf(null)).toBeNull();
  });
});
