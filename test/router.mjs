/* A small stand-in for Vercel's router, driven by the real vercel.json.
 *
 * It exists so the routing table can be exercised without a deploy. The order
 * it implements is Vercel's: redirects and headers are evaluated before the
 * filesystem, rewrites only after a filesystem miss, and an unmatched path
 * falls through to the 404.html convention. Sources in this project's config
 * are plain paths or explicit capture groups, so they are used as regular
 * expressions directly.
 *
 * It emulates the config, not Vercel itself — a green run here says the rules
 * mean what they are meant to mean, and a preview deployment is still what
 * confirms the platform agrees.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const config = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

const INDEX_EXTENSIONS = ['.html', '.htm', '.md', '.txt', '.xml', '.json'];

function sourceMatches(source, pathname) {
  const match = new RegExp('^' + source + '$').exec(pathname);
  return match ? match.slice(1) : null;
}

function conditionMatches(condition, headers) {
  if (condition.type !== 'header') {
    throw new Error('unsupported condition type: ' + condition.type);
  }
  const value = headers[condition.key.toLowerCase()];
  if (value === undefined) return false;
  if (condition.value === undefined) return true;
  return new RegExp('^' + condition.value + '$').test(value);
}

// `has` requires every condition to match; `missing` requires that none do —
// which covers both "header absent" and "header present but not matching".
function ruleApplies(rule, headers) {
  if (rule.has && !rule.has.every((c) => conditionMatches(c, headers))) return false;
  if (rule.missing && rule.missing.some((c) => conditionMatches(c, headers))) return false;
  return true;
}

function expand(destination, groups) {
  return destination.replace(/\$(\d+)/g, (_, n) => groups[Number(n) - 1] ?? '');
}

/**
 * Resolve a request to one of:
 *   { kind: 'redirect', location, status }
 *   { kind: 'file',     file,     status, headers }
 *   { kind: 'function', page,     headers }
 *
 * `fileExists` decides the filesystem phase, so tests can drive it directly.
 */
export function resolve(pathname, headers, fileExists) {
  const lower = {};
  for (const [k, v] of Object.entries(headers ?? {})) lower[k.toLowerCase()] = v;

  const extra = {};
  for (const rule of config.headers ?? []) {
    if (sourceMatches(rule.source, pathname) && ruleApplies(rule, lower)) {
      for (const { key, value } of rule.headers) extra[key] = value;
    }
  }

  for (const rule of config.redirects ?? []) {
    const groups = sourceMatches(rule.source, pathname);
    if (groups && ruleApplies(rule, lower)) {
      return {
        kind: 'redirect',
        location: expand(rule.destination, groups),
        status: rule.permanent ? 308 : 307,
        headers: extra,
      };
    }
  }

  // Vercel's filesystem phase resolves a directory path to an index file of
  // any extension, not just index.html — which is how index.md once shadowed
  // the rewrite that serves / from home.html.
  const candidates = pathname.endsWith('/')
    ? INDEX_EXTENSIONS.map((ext) => pathname.slice(1) + 'index' + ext)
    : [pathname.slice(1)];

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return { kind: 'file', file: candidate, status: 200, headers: extra };
    }
  }

  for (const rule of config.rewrites ?? []) {
    const groups = sourceMatches(rule.source, pathname);
    if (!groups || !ruleApplies(rule, lower)) continue;

    const destination = expand(rule.destination, groups);
    const [target, query] = destination.split('?');

    if (target === '/api/negotiate') {
      const page = new URLSearchParams(query).get('p') ?? 'index';
      return { kind: 'function', page, headers: extra };
    }
    return { kind: 'file', file: target.slice(1), status: 200, headers: extra };
  }

  return { kind: 'file', file: '404.html', status: 404, headers: extra };
}
