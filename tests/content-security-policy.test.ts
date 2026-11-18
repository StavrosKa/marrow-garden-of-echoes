// content_security_policy_blocks_other_hosts (Req 4.9): the app's page declares a
// Content-Security-Policy in a meta tag (GitHub Pages sends no headers) whose connect-src is
// exactly 'self', so no runtime request, including a library's telemetry, reaches another host.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_HTML = 'apps/garden-of-echoes/index.html';

/** The content of every `<meta http-equiv="Content-Security-Policy">` tag in an HTML text. */
function cspMetaContents(html: string): string[] {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const contents: string[] = [];
  for (const tag of withoutComments.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string): string | undefined =>
      new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined);
    if (attr('http-equiv')?.trim().toLowerCase() === 'content-security-policy') {
      contents.push(attr('content') ?? '');
    }
  }
  return contents;
}

/** The source list of a directive in a policy, or undefined when the policy has no such directive. */
function directiveSources(policy: string, name: string): string[] | undefined {
  const directives = policy.split(';').map((d) => d.trim().split(/\s+/).filter((t) => t !== ''));
  const found = directives.filter((d) => d[0]?.toLowerCase() === name);
  return found.length === 1 ? (found[0] as string[]).slice(1) : undefined;
}

describe('content security policy of the app page', () => {
  it('content_security_policy_blocks_other_hosts', () => {
    const html = fs.readFileSync(path.join(repoRoot, INDEX_HTML), 'utf8');
    const policies = cspMetaContents(html);
    expect(policies, `${INDEX_HTML} must have exactly one Content-Security-Policy meta tag`).toHaveLength(1);
    expect(directiveSources(policies[0] as string, 'connect-src')).toEqual(["'self'"]);
  });

  describe('the check itself', () => {
    const page = (meta: string): string => `<!doctype html><html><head>${meta}</head><body></body></html>`;
    const policyOf = (meta: string): string[] => cspMetaContents(page(meta));

    it('reads the policy whatever the attribute order and quote style', () => {
      expect(policyOf(`<meta content="connect-src 'self'" http-equiv="Content-Security-Policy">`)).toEqual([
        "connect-src 'self'",
      ]);
      expect(policyOf(`<meta HTTP-EQUIV='content-security-policy' content="connect-src 'self'" />`)).toEqual([
        "connect-src 'self'",
      ]);
    });

    it('ignores other meta tags and commented-out policies', () => {
      expect(policyOf(`<meta name="viewport" content="width=device-width">`)).toEqual([]);
      expect(policyOf(`<!-- <meta http-equiv="Content-Security-Policy" content="connect-src 'self'"> -->`)).toEqual([]);
    });

    it('accepts only a connect-src that is exactly self', () => {
      expect(directiveSources("connect-src 'self'", 'connect-src')).toEqual(["'self'"]);
      expect(directiveSources("connect-src 'self' https://odml.pa.googleapis.com", 'connect-src')).toEqual([
        "'self'",
        'https://odml.pa.googleapis.com',
      ]);
      expect(directiveSources('connect-src *', 'connect-src')).toEqual(['*']);
      expect(directiveSources('connect-src https:', 'connect-src')).toEqual(['https:']);
      expect(directiveSources("connect-src 'none'", 'connect-src')).toEqual(["'none'"]);
      expect(directiveSources("default-src 'self'", 'connect-src')).toBeUndefined();
      expect(directiveSources("connect-src 'self'; connect-src *", 'connect-src')).toBeUndefined();
    });
  });
});
