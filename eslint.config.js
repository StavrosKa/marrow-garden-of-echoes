// Dependency rules from .kiro/steering/structure.md, enforced here and again
// by tests/dependency-graph.test.ts (which reads the real import graph).
//
// no-restricted-imports only sees the import string, not the resolved file.
// Cross-workspace relative imports are therefore blocked by depth: a file
// that sits N directories below its workspace root may use at most N "../"
// segments, so any relative import that leaves the workspace is rejected.
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const APP = 'garden-of-echoes';
const PIXI = '^(?:pixi\\.js|@pixi/)';
const MAX_DEPTH = 6;

const rx = {
  escape: (n) => [
    `^(?:\\.\\./){${n},}`,
    'A relative import must not leave its workspace. Import another workspace through a package entry point.',
  ],
  noApp: [`^${APP}(?:/|$)`, 'packages/* never import from apps/*.'],
  entryPoints: [
    '^marrow(?:$|/(?!(?:core|challenges|input|sim|react)$))',
    'Import marrow only through marrow/core, marrow/challenges, marrow/input, marrow/sim or marrow/react.',
  ],
  worldViewEntry: [
    '^world-view/(?!pixi$)',
    'Import world-view only through world-view or world-view/pixi.',
  ],
  marrowNoWorldView: ['^world-view(?:/|$)', 'packages/marrow does not import packages/world-view.'],
  worldViewMarrowCoreOnly: [
    '^marrow(?:$|/(?!core$))',
    'packages/world-view may import only marrow/core.',
  ],
  noReactDom: ['^(?:react|react-dom)(?:/|$)', 'This zone must stay free of React.'],
  noPixi: [PIXI, 'PixiJS code lives only in packages/world-view/src/pixi.'],
  noMediaPipe: ['^@mediapipe/', 'This zone must stay free of MediaPipe.'],
};

const workspaces = {
  marrow: { root: 'packages/marrow', kind: 'package' },
  'world-view': { root: 'packages/world-view', kind: 'package' },
  [APP]: { root: 'apps/garden-of-echoes', kind: 'app' },
};

function wsPatterns(name, { pure = false, allowPixi = false } = {}) {
  const ws = workspaces[name];
  const list = [];
  if (ws.kind === 'app') {
    list.push(rx.entryPoints, rx.worldViewEntry);
  } else {
    list.push(rx.noApp);
    if (name === 'marrow') list.push(rx.marrowNoWorldView);
    if (name === 'world-view') {
      list.push(rx.worldViewMarrowCoreOnly);
      if (!allowPixi) list.push(rx.noPixi);
    }
  }
  if (pure) {
    list.push(rx.noReactDom, rx.noMediaPipe);
    if (!list.includes(rx.noPixi)) list.push(rx.noPixi);
  }
  return list;
}

function zone(files, patterns) {
  return {
    files,
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: patterns.map(([regex, message]) => ({ regex, message })) },
      ],
    },
  };
}

// [workspace, sub directory below src, pure, allowPixi]
const regions = [
  ['marrow', 'core', true, false],
  ['marrow', 'challenges', true, false],
  ['marrow', 'sim', true, false],
  ['world-view', 'core', true, false],
  ['world-view', 'pixi', false, true],
];

const importZones = [];
for (const [name, ws] of Object.entries(workspaces)) {
  // Files directly in the workspace root (vite.config.ts and similar).
  importZones.push(zone([`${ws.root}/*.{ts,tsx}`], [rx.escape(1), ...wsPatterns(name)]));
  // Files under src, by directory depth.
  for (let d = 0; d <= MAX_DEPTH; d++) {
    importZones.push(
      zone(
        [`${ws.root}/src/${'*/'.repeat(d)}*.{ts,tsx}`],
        [rx.escape(d + 2), ...wsPatterns(name)],
      ),
    );
  }
}
// Region zones come later, so they replace the general zone for their files.
for (const [name, sub, pure, allowPixi] of regions) {
  const root = workspaces[name].root;
  for (let k = 0; k <= MAX_DEPTH; k++) {
    importZones.push(
      zone(
        [`${root}/src/${sub}/${'*/'.repeat(k)}*.{ts,tsx}`],
        [rx.escape(k + 3), ...wsPatterns(name, { pure, allowPixi })],
      ),
    );
  }
}

// Nothing in packages/ mentions app content or carries player-facing text.
const CONTENT = 'lantern|spirit|glade|whisper|candle|firefl|bloom|forest|echo';
const contentMessage =
  'Story content belongs in the app, not in packages/ (structure.md).';
const packageContent = {
  files: ['packages/*/src/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-syntax': [
      'error',
      { selector: `Identifier[name=/${CONTENT}/i]`, message: contentMessage },
      { selector: 'Identifier[name=/^hall|Hall|HALL/]', message: contentMessage },
      { selector: `Literal[value=/${CONTENT}|\\bhall\\b/i]`, message: contentMessage },
      { selector: `TemplateElement[value.raw=/${CONTENT}|\\bhall\\b/i]`, message: contentMessage },
      {
        selector: 'JSXText[value=/\\S/]',
        message: 'packages/ contain no player-facing text. Take strings from MarrowCopy.',
      },
    ],
  },
};

// DOM is off limits in the pure zones. (Keep in sync with tests/dependency-graph.test.ts.)
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'HTMLElement',
  'HTMLCanvasElement',
  'HTMLVideoElement',
  'MediaStream',
  'ImageData',
  'OffscreenCanvas',
];
const pureNoDom = {
  files: [
    'packages/marrow/src/core/**',
    'packages/marrow/src/challenges/**',
    'packages/marrow/src/sim/**',
    'packages/world-view/src/core/**',
  ].map((g) => `${g}/*.{ts,tsx}`),
  rules: {
    'no-restricted-globals': [
      'error',
      ...DOM_GLOBALS.map((name) => ({ name, message: 'The DOM is off limits in pure logic.' })),
    ],
  },
};

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '.kiro/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
  },
  ...importZones,
  packageContent,
  pureNoDom,
);
