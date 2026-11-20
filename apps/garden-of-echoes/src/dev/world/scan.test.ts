// Scans of the slice source (design 9.2): player-facing text, images and fonts, and ambient motion and audio.
// The files are parsed with the TypeScript compiler, so the scans see string literals and imports, not text.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Files that hold developer diagnostics (design 11 item 15). They may hold strings with spaces. */
const DIAGNOSTIC_FILES = new Set(['worldContent.ts']);
const IMAGE_OR_FONT = /\.(png|jpe?g|gif|webp|svg|woff2?|ttf|otf|mp3|wav|ogg|task)$/i;
const AUDIO_OR_MOTION_MODULE = /audio|sound|howler|tone|animation/i;
const FORBIDDEN_GLOBALS = new Set([
  'Image',
  'FontFace',
  'Audio',
  'AudioContext',
  'webkitAudioContext',
  'HTMLAudioElement',
  'OscillatorNode',
  'requestAnimationFrame',
  'setInterval',
]);

/** Every source file of the slice that the app ships: .ts and .tsx and .json, not the tests. */
function sliceFiles(dir: string = HERE): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sliceFiles(full));
    } else if (/\.(tsx?|json)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && entry.name !== 'testgen.ts') {
      found.push(full);
    }
  }
  return found;
}

interface Finding {
  readonly file: string;
  readonly what: string;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2023, true);
}

/** Player-facing text: a string literal with a space, outside the developer diagnostics. */
function textFindings(file: string): Finding[] {
  if (file.endsWith('.json')) {
    const json = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    const found: Finding[] = [];
    const walk = (value: unknown, key: string): void => {
      if (typeof value === 'string') {
        // The layer `name` is a developer label for the debug panel, not player text.
        if (key !== 'name' && value.includes(' ')) found.push({ file, what: `"${value}"` });
      } else if (Array.isArray(value)) {
        value.forEach((item: unknown) => walk(item, key));
      } else if (typeof value === 'object' && value !== null) {
        for (const [k, item] of Object.entries(value)) walk(item, k);
      }
    };
    walk(json, '');
    return found;
  }
  if (DIAGNOSTIC_FILES.has(path.basename(file))) return [];
  const found: Finding[] = [];
  const visit = (node: ts.Node): void => {
    const literal =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
          ? node.text
          : undefined;
    // A template with a substitution sits inside TemplateExpression and TemplateSpan nodes, so walk up past them.
    let owner = node.parent as ts.Node | undefined;
    while (owner !== undefined && (ts.isTemplateExpression(owner) || ts.isTemplateSpan(owner))) owner = owner.parent;
    const parent = owner;
    const isError = parent !== undefined && ts.isNewExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'Error';
    const isImport = parent !== undefined && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent));
    if (literal !== undefined && literal.includes(' ') && !isError && !isImport) {
      found.push({ file, what: JSON.stringify(literal) });
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return found;
}

/** Images, fonts and audio, and ambient motion (a frame loop of its own, audio objects, timers). */
function mediaFindings(file: string): Finding[] {
  if (file.endsWith('.json')) return [];
  const found: Finding[] = [];
  const visit = (node: ts.Node): void => {
    const specifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0] ?? node)
          ? (node.arguments[0] as ts.StringLiteral).text
          : undefined;
    if (specifier !== undefined) {
      if (IMAGE_OR_FONT.test(specifier)) found.push({ file, what: `import of ${specifier}` });
      if (AUDIO_OR_MOTION_MODULE.test(specifier)) found.push({ file, what: `import of ${specifier}` });
    }
    if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text)) {
      found.push({ file, what: `use of ${node.text}` });
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return found;
}

describe('slice source scans', () => {
  it('no player-facing string outside copy', () => {
    const findings = sliceFiles().flatMap(textFindings);
    expect(findings.map((finding) => `${path.basename(finding.file)}: ${finding.what}`).join('\n')).toBe('');
  });

  it('no image or font import', () => {
    const findings = sliceFiles().flatMap(mediaFindings).filter((finding) => /image|font|\.(png|jpe?g|svg|woff)/i.test(finding.what));
    expect(findings.map((finding) => `${path.basename(finding.file)}: ${finding.what}`)).toEqual([]);
  });

  it('no ambient motion or audio import', () => {
    const findings = sliceFiles().flatMap(mediaFindings).filter((finding) => !/image|font|\.(png|jpe?g|svg|woff)/i.test(finding.what));
    expect(findings.map((finding) => `${path.basename(finding.file)}: ${finding.what}`)).toEqual([]);
  });
});
