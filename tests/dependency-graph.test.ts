// Checks the real import graph against the dependency rules in
// .kiro/steering/structure.md. The same rules are enforced a second time by
// ESLint (eslint.config.js). It parses every source file with the TypeScript
// compiler API and resolves relative imports to the workspace they land in.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Kind = 'package' | 'app';
interface Workspace {
  name: string;
  kind: Kind;
  abs: string;
}
interface Violation {
  rule: string;
  file: string;
  detail: string;
}

const ENTRY_POINTS = new Set([
  'marrow/core',
  'marrow/challenges',
  'marrow/input',
  'marrow/sim',
  'marrow/react',
  'world-view',
  'world-view/pixi',
]);
interface PureZone {
  readonly workspace: string;
  readonly label: string;
  readonly matches: (inWorkspace: string) => boolean;
}
const inFolder = (folder: string) => (inWorkspace: string) => inWorkspace.startsWith(folder + '/');
const STAGE_RULES_FILE = /^src\/stages\/[^/]+\/rules\.ts$/;
const PURE_ZONES: readonly PureZone[] = [
  { workspace: 'marrow', label: 'src/core', matches: inFolder('src/core') },
  { workspace: 'marrow', label: 'src/challenges', matches: inFolder('src/challenges') },
  { workspace: 'marrow', label: 'src/sim', matches: inFolder('src/sim') },
  { workspace: 'world-view', label: 'src/core', matches: inFolder('src/core') },
  { workspace: 'garden-of-echoes', label: 'src/session', matches: inFolder('src/session') },
  { workspace: 'garden-of-echoes', label: 'src/stages/*/rules.ts', matches: (p) => STAGE_RULES_FILE.test(p) },
];
const FORBIDDEN_IN_PURE = [/^react(\/|$)/, /^react-dom(\/|$)/, /^pixi\.js(\/|$)/, /^@pixi\//, /^@mediapipe\//];
const PIXI = /^(pixi\.js|@pixi\/)/;
// Keep in sync with DOM_GLOBALS in eslint.config.js.
const DOM_GLOBALS = new Set([
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
]);
const CONTENT_WORDS = /lantern|spirit|glade|whisper|candle|firefl|bloom|forest|echo|\bhall\b/i;

function discoverWorkspaces(): Workspace[] {
  const found: Workspace[] = [];
  for (const group of ['packages', 'apps']) {
    const groupDir = path.join(repoRoot, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
      const pkgPath = path.join(groupDir, entry.name, 'package.json');
      if (!entry.isDirectory() || !fs.existsSync(pkgPath)) continue;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name: string };
      found.push({
        name: pkg.name,
        kind: group === 'packages' ? 'package' : 'app',
        abs: path.join(groupDir, entry.name),
      });
    }
  }
  return found;
}

function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}

const workspaces = discoverWorkspaces();
const byName = new Map(workspaces.map((w) => [w.name, w]));
const rel = (abs: string) => path.relative(repoRoot, abs).split(path.sep).join('/');

function workspaceOf(abs: string): Workspace | undefined {
  return workspaces.find((w) => abs === w.abs || abs.startsWith(w.abs + path.sep));
}

function packageNameOf(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
}

interface Parsed {
  specs: string[];
  jsxText: boolean;
  domGlobals: string[];
}

function isDeclarationOrPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isTypeAliasDeclaration(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isImportSpecifier(parent)
  ) {
    return parent.name === node;
  }
  return false;
}

function parse(file: string): Parsed {
  const text = fs.readFileSync(file, 'utf8');
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const result: Parsed = { specs: [], jsxText: false, domGlobals: [] };
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.specs.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const [arg] = node.arguments;
      const isImportCall = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isImportCall || isRequire) && arg && ts.isStringLiteralLike(arg)) result.specs.push(arg.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      if (ts.isStringLiteral(node.argument.literal)) result.specs.push(node.argument.literal.text);
    } else if (ts.isJsxText(node) && node.text.trim() !== '') {
      result.jsxText = true;
    } else if (ts.isIdentifier(node) && DOM_GLOBALS.has(node.text) && !isDeclarationOrPropertyName(node)) {
      result.domGlobals.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

function analyse(): { violations: Violation[]; filesScanned: number } {
  const violations: Violation[] = [];
  const add = (rule: string, file: string, detail: string) => violations.push({ rule, file: rel(file), detail });
  let filesScanned = 0;

  for (const ws of workspaces) {
    const sources = walk(ws.abs, (f) => /\.(ts|tsx|mts|cts)$/.test(f));
    for (const file of sources) {
      filesScanned++;
      const inWs = path.relative(ws.abs, file).split(path.sep).join('/');
      const zone = PURE_ZONES.find((z) => z.workspace === ws.name && z.matches(inWs));
      const isWorldViewOutsidePixi = ws.name === 'world-view' && !inWs.startsWith('src/pixi/');
      const parsed = parse(file);

      for (const spec of parsed.specs) {
        if (spec.startsWith('.')) {
          const target = path.resolve(path.dirname(file), spec);
          const targetWs = workspaceOf(target);
          if (targetWs === ws) continue;
          const where = targetWs ? targetWs.name : 'a folder outside every workspace';
          const detail = `"${spec}" reaches ${where} by a relative path`;
          if (ws.kind === 'app') {
            add('app-only-packages', file, detail);
          } else {
            if (targetWs?.kind === 'app') add('packages-not-apps', file, detail);
            else if (ws.name === 'marrow' && targetWs?.name === 'world-view') add('marrow-not-world-view', file, detail);
            else add('entry-points', file, detail);
          }
          continue;
        }

        const pkgName = packageNameOf(spec);
        const targetWs = byName.get(pkgName);
        if (targetWs && targetWs !== ws) {
          if (!ENTRY_POINTS.has(spec) && targetWs.kind === 'package') {
            add('entry-points', file, `"${spec}" is not one of the seven package entry points`);
          }
          if (ws.kind === 'app') {
            if (targetWs.kind === 'app') {
              add('app-only-packages', file, `"${spec}" imports a workspace that is not a package`);
            }
          } else {
            if (targetWs.kind === 'app') add('packages-not-apps', file, `"${spec}" imports the app`);
            if (ws.name === 'marrow' && targetWs.name === 'world-view') {
              add('marrow-not-world-view', file, `"${spec}" imports world-view`);
            }
            if (ws.name === 'world-view' && targetWs.name === 'marrow' && spec !== 'marrow/core') {
              add('world-view-marrow-core-only', file, `"${spec}" is not marrow/core`);
            }
          }
          continue;
        }

        if (zone && FORBIDDEN_IN_PURE.some((re) => re.test(spec))) {
          add('pure-zones', file, `"${spec}" is not allowed in ${ws.name}/${zone.label}`);
        }
        if (isWorldViewOutsidePixi && PIXI.test(spec)) {
          add('pixi-only-in-pixi-folder', file, `"${spec}" is outside packages/world-view/src/pixi`);
        }
      }

      if (zone) {
        for (const name of parsed.domGlobals) {
          add('pure-zones', file, `uses the DOM global "${name}" in ${ws.name}/${zone.label}`);
        }
      }
      if (ws.kind === 'package' && parsed.jsxText) {
        add('no-player-text-in-packages', file, 'contains JSX text; take strings from MarrowCopy');
      }
    }

    if (ws.kind === 'package') {
      const textFiles = walk(ws.abs, (f) => /\.(ts|tsx|json|md|css|html)$/.test(f));
      for (const file of textFiles) {
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, i) => {
          const hit = CONTENT_WORDS.exec(line);
          if (hit) add('no-app-content-in-packages', file, `line ${i + 1} mentions "${hit[0]}"`);
        });
      }
    }
  }
  return { violations, filesScanned };
}

const { violations, filesScanned } = analyse();
const listFor = (rule: string) => violations.filter((v) => v.rule === rule).map((v) => `${v.file}: ${v.detail}`);

describe('dependency rules (structure.md)', () => {
  it('finds the five workspaces and scans their files', () => {
    expect(workspaces.map((w) => w.name).sort()).toEqual(['garden-of-echoes', 'marrow', 'world-view']);
    expect(filesScanned).toBeGreaterThan(5);
  });

  it('there is exactly one app and no templates folder', () => {
    expect(fs.readdirSync(path.join(repoRoot, 'apps'))).toEqual(['garden-of-echoes']);
    expect(fs.existsSync(path.join(repoRoot, 'templates'))).toBe(false);
  });

  it('the app imports only from packages', () => {
    expect(listFor('app-only-packages')).toEqual([]);
  });

  it('pure zones import no React, PixiJS, MediaPipe or DOM', () => {
    expect(listFor('pure-zones')).toEqual([]);
  });

  it('PixiJS code in world-view lives only in src/pixi', () => {
    expect(listFor('pixi-only-in-pixi-folder')).toEqual([]);
  });

  it('marrow does not import world-view', () => {
    expect(listFor('marrow-not-world-view')).toEqual([]);
  });

  it('world-view imports only marrow/core from marrow', () => {
    expect(listFor('world-view-marrow-core-only')).toEqual([]);
  });

  it('packages never import from the app', () => {
    expect(listFor('packages-not-apps')).toEqual([]);
  });

  it('packages mention no app content', () => {
    expect(listFor('no-app-content-in-packages')).toEqual([]);
  });

  it('packages contain no player-facing text', () => {
    expect(listFor('no-player-text-in-packages')).toEqual([]);
  });

  it('other workspaces are reached only through the seven package entry points', () => {
    expect(listFor('entry-points')).toEqual([]);
  });
});
