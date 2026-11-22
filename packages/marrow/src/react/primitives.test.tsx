// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, InstructionLine, Panel, RadioGroup, Slider } from './primitives';

// Requirement 21.1 and 24.1: the primitives are real elements whose names and text come in as props.
// The values used here are fixture strings of the test, not copy the component holds. Strings are
// written as expressions, because packages/ may contain no JSX text (tests/dependency-graph.test.ts).

type Motion = 'full' | 'gentle' | 'reduced';
const MOTION_OPTIONS = [
  { value: 'full', label: 'Fixture full' },
  { value: 'gentle', label: 'Fixture gentle' },
  { value: 'reduced', label: 'Fixture reduced' },
] as const;

describe('Panel', () => {
  it('is a named region that holds its children', () => {
    render(
      <Panel label="Fixture panel">
        <Button onClick={() => undefined}>{'Fixture inside'}</Button>
      </Panel>,
    );
    const region = screen.getByRole('region', { name: 'Fixture panel' });
    expect(region).toContainElement(screen.getByRole('button', { name: 'Fixture inside' }));
  });
});

describe('Button', () => {
  it('is a real button named by its children', () => {
    render(<Button onClick={() => undefined}>{'Fixture retry'}</Button>);
    const button = screen.getByRole('button', { name: 'Fixture retry' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('calls onClick when pressed with the mouse and with the keyboard', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>{'Fixture go'}</Button>);
    await user.click(screen.getByRole('button', { name: 'Fixture go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: 'Fixture go' }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('does not respond when disabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button onClick={onClick} disabled>
        {'Fixture off'}
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Fixture off' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Fixture off' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks the primary variant with its own class and keeps the secondary one plain', () => {
    const { rerender } = render(
      <Button onClick={() => undefined} variant="primary">
        {'Fixture main'}
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Fixture main' })).toHaveClass('marrow-button', 'marrow-button--primary');
    rerender(<Button onClick={() => undefined}>{'Fixture main'}</Button>);
    expect(screen.getByRole('button', { name: 'Fixture main' })).toHaveClass('marrow-button');
    expect(screen.getByRole('button', { name: 'Fixture main' })).not.toHaveClass('marrow-button--primary');
  });
});

describe('RadioGroup', () => {
  it('is a group named by its legend, with one real radio per option named by its label', () => {
    render(<RadioGroup legend="Fixture motion" name="motion" options={MOTION_OPTIONS} value="full" onChange={() => undefined} />);
    expect(screen.getByRole('group', { name: 'Fixture motion' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['full', 'gentle', 'reduced']);
    for (const radio of radios) expect(radio.tagName).toBe('INPUT');
    expect(screen.getByRole('radio', { name: 'Fixture gentle' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Fixture full' })).toBeChecked();
  });

  it('selects nothing when the value is null', () => {
    render(<RadioGroup legend="Fixture hands" name="hands" options={MOTION_OPTIONS} value={null} onChange={() => undefined} />);
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
  });

  it('reports the chosen value with the mouse, and the arrow keys move the choice', async () => {
    const seen: Motion[] = [];
    const user = userEvent.setup();
    render(
      <RadioGroup<Motion>
        legend="Fixture motion"
        name="motion"
        options={MOTION_OPTIONS}
        value="full"
        onChange={(value) => seen.push(value)}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'Fixture reduced' }));
    expect(seen).toEqual(['reduced']);
    // Focus the checked radio of the group and move with the arrow keys, as a keyboard player does.
    screen.getByRole('radio', { name: 'Fixture full' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(seen).toEqual(['reduced', 'gentle']);
  });
});

describe('Slider', () => {
  it('is a real range input named by its label, with the given bounds and value', () => {
    render(<Slider label="Fixture volume" min={0} max={1} step="any" value={0.25} onChange={() => undefined} />);
    const slider = screen.getByRole('slider', { name: 'Fixture volume' });
    expect(slider.tagName).toBe('INPUT');
    expect(slider).toHaveAttribute('type', 'range');
    expect(slider).toHaveValue('0.25');
  });

  it('reports the new value as a number when it changes, and is reached by the keyboard', async () => {
    const seen: number[] = [];
    const user = userEvent.setup();
    render(<Slider label="Fixture volume" min={0} max={1} step="any" value={0.5} onChange={(v) => seen.push(v)} />);
    const slider = screen.getByRole('slider', { name: 'Fixture volume' });
    await user.tab();
    expect(slider).toHaveFocus();
    // user-event does not step a range with the arrow keys, so the change a browser makes is sent as an event here.
    fireEvent.change(slider, { target: { value: '0.75' } });
    expect(seen).toEqual([0.75]);
  });
});

describe('InstructionLine', () => {
  it('shows its text in a polite live region', () => {
    render(<InstructionLine text="Fixture instruction" />);
    const line = screen.getByText('Fixture instruction');
    expect(line.tagName).toBe('P');
    expect(line).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps the same live region when its text changes', () => {
    const { rerender } = render(<InstructionLine text="Fixture first" />);
    const before = screen.getByText('Fixture first');
    rerender(<InstructionLine text="Fixture second" />);
    expect(screen.getByText('Fixture second')).toBe(before);
    expect(before).toHaveAttribute('aria-live', 'polite');
  });
});
