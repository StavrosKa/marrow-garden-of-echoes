// The package imports its stylesheet for the side effect (primitives.tsx). Vite resolves the import
// in the app; this declaration lets the package typecheck on its own.
declare module '*.css';
