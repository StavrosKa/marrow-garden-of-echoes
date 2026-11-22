// Applies the app's theme to the playground (design section 14.5, Req 24.5). It adds no logic: it
// renders one div with the class that theme.css styles, and imports the stylesheet.
import type { ReactNode } from 'react';
import './theme.css';

export interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  return <div className="garden-theme">{children}</div>;
}
