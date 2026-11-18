// vendored_assets_match_licenses (Req 4.5, 28.11): every file under
// apps/garden-of-echoes/public/mediapipe is recorded in the "Vendored runtime assets"
// table of docs/licenses.md with its source URL, download date, licence and SHA-256,
// and the recorded SHA-256 is the real one. A file missing from the table, a row with no
// file, and a changed hash each fail, with the file's path in the message.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDORED_DIR = 'apps/garden-of-echoes/public/mediapipe';
const LICENSES_FILE = 'docs/licenses.md';
const SECTION_HEADING = '## Vendored runtime assets';
const COLUMNS = ['File', 'Source URL', 'Downloaded', 'Licence', 'SHA-256'];

interface Row {
  readonly file: string;
  readonly source: string;
  readonly date: string;
  readonly licence: string;
  readonly sha256: string;
}

function sha256Of(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? listFiles(full, base)
      : [path.relative(base, full).split(path.sep).join('/')];
  });
}

/** The rows of the table under the heading, and the problems found while reading it. */
function readTable(markdown: string): { rows: Row[]; problems: string[] } {
  const problems: string[] = [];
  const at = markdown.indexOf(SECTION_HEADING);
  if (at < 0) return { rows: [], problems: [`${LICENSES_FILE} has no "${SECTION_HEADING}" section`] };
  const rest = markdown.slice(at + SECTION_HEADING.length);
  const next = rest.indexOf('\n## ');
  const section = next < 0 ? rest : rest.slice(0, next);
  const lines = section.split(/\r?\n/).filter((l) => l.trim().startsWith('|'));
  const cells = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const header = lines[0] ? cells(lines[0]) : [];
  if (header.join('|') !== COLUMNS.join('|')) {
    problems.push(`${LICENSES_FILE}: the table header must be ${COLUMNS.join(' | ')}`);
    return { rows: [], problems };
  }
  const rows: Row[] = [];
  for (const line of lines.slice(2)) {
    const c = cells(line);
    if (c.length !== COLUMNS.length) {
      problems.push(`${LICENSES_FILE}: a row has ${c.length} columns, not ${COLUMNS.length}: ${line.trim()}`);
      continue;
    }
    const [file = '', source = '', date = '', licence = '', sha256 = ''] = c;
    rows.push({ file: file.replace(/^`|`$/g, ''), source, date, licence, sha256 });
  }
  return { rows, problems };
}

/** Every problem between a licences file and the vendored files under `root`; empty when they agree. */
function checkVendoredAssets(licensesText: string, root: string): string[] {
  const { rows, problems } = readTable(licensesText);
  if (rows.length === 0 && problems.length === 0) {
    problems.push(`${LICENSES_FILE}: the vendored assets table has no rows`);
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.file)) problems.push(`${row.file}: listed twice in ${LICENSES_FILE}`);
    seen.add(row.file);
    if (!row.source.startsWith('https://')) problems.push(`${row.file}: source URL "${row.source}" is not an https URL`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) problems.push(`${row.file}: download date "${row.date}" is not YYYY-MM-DD`);
    if (row.licence === '') problems.push(`${row.file}: no licence recorded`);
    if (!/^[0-9a-f]{64}$/.test(row.sha256)) {
      problems.push(`${row.file}: recorded SHA-256 "${row.sha256}" is not 64 lowercase hexadecimal digits`);
    }
    const abs = path.join(root, row.file);
    if (!fs.existsSync(abs)) {
      problems.push(`${row.file}: listed in ${LICENSES_FILE} but the file does not exist`);
    } else if (!row.file.startsWith(`${VENDORED_DIR}/`)) {
      problems.push(`${row.file}: is not under ${VENDORED_DIR}`);
    } else {
      const actual = sha256Of(abs);
      if (actual !== row.sha256) {
        problems.push(`${row.file}: SHA-256 is ${actual}, but ${LICENSES_FILE} records ${row.sha256}`);
      }
    }
  }
  for (const rel of listFiles(path.join(root, VENDORED_DIR))) {
    const file = `${VENDORED_DIR}/${rel}`;
    if (!seen.has(file)) problems.push(`${file}: vendored but not listed in ${LICENSES_FILE}`);
  }
  return problems;
}

describe('vendored assets', () => {
  it('vendored_assets_match_licenses', () => {
    const text = fs.readFileSync(path.join(repoRoot, LICENSES_FILE), 'utf8');
    expect(checkVendoredAssets(text, repoRoot)).toEqual([]);
    expect(listFiles(path.join(repoRoot, VENDORED_DIR)).length).toBeGreaterThan(0);
  });
});

describe('the check itself, on a copy in a temporary folder', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  /** A temporary root with two vendored files and a licences file that lists both correctly. */
  function makeCopy(): { root: string; text: string; a: string; b: string; shaA: string; shaB: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendored-check-'));
    dirs.push(root);
    const a = `${VENDORED_DIR}/wasm/one.bin`;
    const b = `${VENDORED_DIR}/models/two.bin`;
    for (const [rel, content] of [[a, 'first file'], [b, 'second file']] as const) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    }
    const shaA = sha256Of(path.join(root, a));
    const shaB = sha256Of(path.join(root, b));
    const text = [
      '# Licenses',
      '',
      SECTION_HEADING,
      '',
      `| ${COLUMNS.join(' | ')} |`,
      '|---|---|---|---|---|',
      `| \`${a}\` | https://example.test/one | 2026-01-02 | Apache-2.0 | ${shaA} |`,
      `| \`${b}\` | https://example.test/two | 2026-01-03 | Apache-2.0 | ${shaB} |`,
      '',
      'Notes: none.',
      '',
      '## Later section',
      '',
      '| not | part | of | it |',
    ].join('\n');
    return { root, text, a, b, shaA, shaB };
  }

  it('passes when the table and the files agree', () => {
    const c = makeCopy();
    expect(checkVendoredAssets(c.text, c.root)).toEqual([]);
  });

  it('a changed recorded SHA-256 fails and names the file', () => {
    const c = makeCopy();
    const flipped = (c.shaA.startsWith('0') ? '1' : '0') + c.shaA.slice(1);
    const problems = checkVendoredAssets(c.text.replace(c.shaA, flipped), c.root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(c.a);
    expect(problems[0]).toContain('SHA-256');
  });

  it('a removed row fails and names the file', () => {
    const c = makeCopy();
    const without = c.text.split('\n').filter((l) => !l.includes(c.b)).join('\n');
    const problems = checkVendoredAssets(without, c.root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(c.b);
    expect(problems[0]).toContain('not listed');
  });

  it('a file that changed after it was recorded fails and names the file', () => {
    const c = makeCopy();
    fs.appendFileSync(path.join(c.root, c.a), '!');
    const problems = checkVendoredAssets(c.text, c.root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(c.a);
  });

  it('a listed file that is missing fails and names the file', () => {
    const c = makeCopy();
    fs.rmSync(path.join(c.root, c.b));
    const problems = checkVendoredAssets(c.text, c.root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(c.b);
    expect(problems[0]).toContain('does not exist');
  });

  it('an unlisted extra file fails and names the file', () => {
    const c = makeCopy();
    const extra = `${VENDORED_DIR}/models/three.bin`;
    fs.writeFileSync(path.join(c.root, extra), 'third');
    const problems = checkVendoredAssets(c.text, c.root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(extra);
  });

  it('a row listed twice fails and names the file', () => {
    const c = makeCopy();
    const row = c.text.split('\n').find((l) => l.includes(c.a)) as string;
    const problems = checkVendoredAssets(c.text.replace(row, `${row}\n${row}`), c.root);
    expect(problems.some((p) => p.includes(c.a) && p.includes('twice'))).toBe(true);
  });

  it('a row with a bad source URL, date, licence or hash fails and names the file and the field', () => {
    const c = makeCopy();
    const broken: [string, string][] = [
      [c.text.replace('https://example.test/one', 'ftp://example.test/one'), 'not an https URL'],
      [c.text.replace('2026-01-02', '2 January'), 'is not YYYY-MM-DD'],
      [c.text.replace('| Apache-2.0 | ' + c.shaA, '|  | ' + c.shaA), 'no licence recorded'],
      [c.text.replace(c.shaA, c.shaA.toUpperCase()), 'lowercase hexadecimal'],
      [c.text.replace(c.shaA, c.shaA.slice(1)), 'lowercase hexadecimal'],
    ];
    for (const [text, expected] of broken) {
      const problems = checkVendoredAssets(text, c.root);
      expect(problems.length, expected).toBeGreaterThan(0);
      expect(problems.every((p) => p.includes(c.a)), expected).toBe(true);
      expect(problems.some((p) => p.includes(expected)), expected).toBe(true);
    }
  });

  it('a row with the wrong number of columns fails', () => {
    const c = makeCopy();
    const row = c.text.split('\n').find((l) => l.includes(c.a)) as string;
    const short = row.replace(/ \| [0-9a-f]{64} \|$/, ' |');
    const problems = checkVendoredAssets(c.text.replace(row, short), c.root);
    expect(problems.some((p) => p.includes('4 columns') && p.includes(c.a))).toBe(true);
  });

  it('a table with no rows fails and says so', () => {
    const c = makeCopy();
    const rowsRemoved = c.text.split('\n').filter((l) => !l.includes(VENDORED_DIR)).join('\n');
    expect(checkVendoredAssets(rowsRemoved, c.root).some((p) => p.includes('has no rows'))).toBe(true);
  });

  it('a licences file with no section fails and says so', () => {
    const c = makeCopy();
    const problems = checkVendoredAssets('# Licenses\n', c.root);
    expect(problems.some((p) => p.includes(`has no "${SECTION_HEADING}" section`))).toBe(true);
  });

  it('a table with another header fails and says so', () => {
    const c = makeCopy();
    const problems = checkVendoredAssets(c.text.replace('| File |', '| Path |'), c.root);
    expect(problems.some((p) => p.includes('the table header must be'))).toBe(true);
  });

  it('a file outside the vendored folder is not accepted as vendored', () => {
    const c = makeCopy();
    const outside = 'docs/elsewhere.bin';
    fs.mkdirSync(path.join(c.root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(c.root, outside), 'x');
    const sha = sha256Of(path.join(c.root, outside));
    const text = c.text.replace('\nNotes: none.', `\n| \`${outside}\` | https://example.test/x | 2026-01-04 | MIT | ${sha} |\nNotes: none.`);
    const problems = checkVendoredAssets(text, c.root);
    expect(problems.some((p) => p.includes(outside) && p.includes('not under'))).toBe(true);
  });

  it('a row of the later section is not read as part of the table', () => {
    const c = makeCopy();
    expect(checkVendoredAssets(c.text, c.root)).toEqual([]);
  });
});
