// @vitest-environment jsdom
// The play area (garden-level requirement 13.1). The touch rule is read through the computed style of the element.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlayArea } from './PlayArea';

describe('PlayArea (requirement 13.1)', () => {
  it('13.1: the play area sets touch-action to none, read from the computed style', () => {
    render(<PlayArea aspect={16 / 9}>target</PlayArea>);
    const area = screen.getByTestId('play-area');
    expect(getComputedStyle(area).touchAction).toBe('none');
  });

  it('13.1: the box is 16:9 and hides its overflow, so the canvas cannot make it taller', () => {
    render(<PlayArea aspect={16 / 9}>target</PlayArea>);
    const area = screen.getByTestId('play-area');
    // jsdom does not parse aspect-ratio, so the declaration is read from the style attribute (it reads 16:9 as 1.77778 / 1).
    expect(area.getAttribute('style')).toMatch(/aspect-ratio:\s*1\.7777/);
    expect(getComputedStyle(area).overflow).toBe('hidden');
  });

  it('renders its children inside the box, and reports pointer downs to its handler', () => {
    let downs = 0;
    render(
      <PlayArea aspect={16 / 9} onPointerDown={() => (downs += 1)}>
        <span>inside</span>
      </PlayArea>,
    );
    const area = screen.getByTestId('play-area');
    expect(area.contains(screen.getByText('inside'))).toBe(true);
    area.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(downs).toBe(1);
  });
});
