// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from './themeProvider';

describe('ThemeProvider', () => {
  it('wraps its children in the element that theme.css styles', () => {
    const { container } = render(
      <ThemeProvider>
        <p>Inside the theme</p>
      </ThemeProvider>,
    );
    const root = container.firstElementChild;
    expect(root?.classList.contains('garden-theme')).toBe(true);
    expect(root?.contains(screen.getByText('Inside the theme'))).toBe(true);
  });
});
