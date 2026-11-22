// The input playground (Req 26). This step is the entry only: on load it validates the tuning and the content,
// and shows the first problem instead of running. The setup flow, the round and the play area come in later steps.
import { formatTuningErrors, TUNING, validateTuning, type Tuning } from 'marrow/core';
import { MarrowCopyProvider } from 'marrow/react';
import { copy } from '../copy';
import { ThemeProvider } from '../ui/themeProvider';
import { readPlaygroundContent, type PlaygroundContent } from './playgroundContent';
import shipped from './playground-content.json';

export interface PlaygroundProps {
  /** The tuning object to check. The shipped TUNING by default (Req 1.4). */
  readonly tuning?: Tuning;
  /** The parsed playground-content.json. The shipped file by default (Req 26.3). */
  readonly content?: unknown;
}

/** What the playground can run with, or the one problem to show. */
export type PlaygroundLoad =
  | { readonly kind: 'ready'; readonly content: PlaygroundContent }
  | { readonly kind: 'tuning'; readonly message: string }
  | { readonly kind: 'content'; readonly message: string };

/** Checks the tuning first, then the content. The first failing check decides what is shown. */
export function loadPlayground(tuning: Tuning, content: unknown): PlaygroundLoad {
  const errors = validateTuning(tuning);
  if (errors.length > 0) return { kind: 'tuning', message: formatTuningErrors(errors) };
  const result = readPlaygroundContent(content);
  if (!result.ok) return { kind: 'content', message: result.message };
  return { kind: 'ready', content: result.content };
}

export function Playground({ tuning = TUNING, content = shipped }: PlaygroundProps) {
  const load = loadPlayground(tuning, content);
  return (
    <ThemeProvider>
      <MarrowCopyProvider value={copy.marrow}>
        <main>
          <h1>{copy.playground.title}</h1>
          {load.kind === 'ready' ? null : (
            <>
              <p role="alert">{load.kind === 'tuning' ? copy.playground.tuningInvalid : copy.playground.contentInvalid}</p>
              <h2>{copy.playground.detailHeading}</h2>
              <pre>{load.message}</pre>
            </>
          )}
        </main>
      </MarrowCopyProvider>
    </ThemeProvider>
  );
}
