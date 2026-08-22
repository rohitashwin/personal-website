import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT, config, resolve } from './router.mjs';

const onDisk = (rel) => rel !== '' && !rel.includes('..')
  && existsSync(path.join(ROOT, rel)) && statSync(path.join(ROOT, rel)).isFile();

const BROWSER = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' };
const MARKDOWN = { accept: 'text/markdown' };
const CURL = { accept: '*/*' };
const PDF_ONLY = { accept: 'application/pdf' };

const go = (p, headers = BROWSER) => resolve(p, headers, onDisk);

test('the homepage is served from home.html for a browser', () => {
  const r = go('/');
  assert.equal(r.kind, 'file');
  assert.equal(r.file, 'home.html');
  assert.equal(r.status, 200);
});

test('no root index.* file can shadow the rewrite that serves /', () => {
  // Vercel resolves / to an index file of any extension before it looks at
  // rewrites. An index.md at the root served itself as the homepage.
  for (const ext of ['.html', '.htm', '.md', '.txt', '.xml', '.json']) {
    assert.ok(!onDisk('index' + ext), 'index' + ext + ' would take over /');
  }
  assert.equal(go('/', MARKDOWN).kind, 'function', '/ must still reach negotiation');
});

test('every page route resolves to its html file for a browser', () => {
  for (const page of ['about', 'contact', 'privacy']) {
    const r = go('/' + page);
    assert.equal(r.kind, 'file', page);
    assert.equal(r.file, page + '.html');
  }
});

test('a markdown request reaches the negotiation function for every page', () => {
  assert.deepEqual(go('/', MARKDOWN), { kind: 'function', page: 'index', headers: { Vary: 'Accept, Accept-Encoding' } });
  for (const page of ['about', 'contact', 'privacy']) {
    const r = go('/' + page, MARKDOWN);
    assert.equal(r.kind, 'function', page);
    assert.equal(r.page, page);
  }
});

test('a client that names neither html nor a wildcard reaches the function', () => {
  assert.equal(go('/', PDF_ONLY).kind, 'function');
  assert.equal(go('/about', PDF_ONLY).kind, 'function');
  assert.equal(go('/nope', PDF_ONLY).page, '404');
});

test('curl and browsers stay on the static path', () => {
  for (const headers of [BROWSER, CURL]) {
    assert.equal(go('/', headers).kind, 'file');
    assert.equal(go('/about', headers).kind, 'file');
  }
});

test('an unknown path falls through to the 404 page', () => {
  const r = go('/some-path-that-does-not-exist');
  assert.equal(r.kind, 'file');
  assert.equal(r.file, '404.html');
  assert.equal(r.status, 404);
});

test('an unknown path asked for in markdown gets the markdown 404', () => {
  const r = go('/some-path-that-does-not-exist', MARKDOWN);
  assert.equal(r.kind, 'function');
  assert.equal(r.page, '404');
});

test('markdown twins and assets are served straight off the filesystem', () => {
  for (const file of ['/home.md', '/about.md', '/contact.md', '/privacy.md', '/404.md',
                      '/llms.txt', '/robots.txt', '/sitemap.xml', '/hiring.md',
                      '/assets/page.css', '/assets/og.png', '/assets/resume.pdf']) {
    const r = go(file, MARKDOWN);
    assert.equal(r.kind, 'file', file + ' should not be swallowed by a rewrite');
    assert.equal(r.file, file.slice(1));
    assert.equal(r.status, 200);
  }
});

test('the html filenames redirect to the canonical urls', () => {
  const cases = {
    '/index.html': '/',
    '/home.html': '/',
    '/about.html': '/about',
    '/contact.html': '/contact',
    '/privacy.html': '/privacy',
  };
  for (const [from, to] of Object.entries(cases)) {
    const r = go(from);
    assert.equal(r.kind, 'redirect', from);
    assert.equal(r.location, to);
    assert.equal(r.status, 308);
  }
});

test('Vary: Accept is set on every negotiated url', () => {
  for (const p of ['/', '/about', '/contact', '/privacy', '/home.md', '/about.md', '/404.md']) {
    assert.equal(go(p).headers.Vary, 'Accept, Accept-Encoding', p);
  }
});

test('assets keep their immutable cache header, and css was added to it', () => {
  assert.match(go('/assets/inter.woff2').headers['Cache-Control'], /immutable/);
  assert.match(go('/assets/page.css').headers['Cache-Control'], /immutable/);
  assert.match(go('/assets/og.png').headers['Cache-Control'], /immutable/);
});

test('every rewrite destination exists', () => {
  for (const rule of config.rewrites) {
    const target = rule.destination.split('?')[0];
    if (target === '/api/negotiate') {
      assert.ok(onDisk('api/negotiate.js'), 'the negotiation function must exist');
      continue;
    }
    assert.ok(onDisk(target.slice(1)), 'missing rewrite target: ' + target);
  }
});

test('the includeFiles glob covers every file the function reads', async () => {
  const { globSync } = await import('node:fs');
  const glob = config.functions['api/negotiate.js'].includeFiles;
  const covered = new Set(globSync(glob, { cwd: ROOT }));
  for (const file of ['home.html', 'about.html', 'contact.html', 'privacy.html', '404.html',
                      'home.md', 'about.md', 'contact.md', 'privacy.md', '404.md']) {
    assert.ok(covered.has(file), file + ' is not matched by includeFiles "' + glob + '"');
  }
});
