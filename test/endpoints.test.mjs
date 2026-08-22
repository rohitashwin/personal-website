/* Endpoint checks over real HTTP.
 *
 * By default these run against the local emulator. Point them at a deployment
 * to verify the same contract there:
 *
 *   BASE_URL=https://www.ashwinrohit.com node --test test/endpoints.test.mjs
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { listen } from './serve.mjs';

const LIVE = process.env.BASE_URL;
let base = LIVE;
let server;

before(async () => {
  if (LIVE) return;
  const started = await listen();
  server = started.server;
  base = started.base;
});

after(() => server?.close());

const get = (p, accept) =>
  fetch(base + p, {
    redirect: 'manual',
    headers: accept === undefined ? {} : { accept },
  });

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

test('the homepage still serves html to a browser', async () => {
  const res = await get('/', BROWSER);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  const body = await res.text();
  assert.match(body, /<h1 class="name">Ashwin Rohit Alagiri Rajan<\/h1>/);
  assert.match(body, /application\/ld\+json/);
});

test('the trust anchor pages are reachable and substantial', async () => {
  for (const page of ['/about', '/contact', '/privacy']) {
    const res = await get(page, BROWSER);
    assert.equal(res.status, 200, page);
    assert.match(res.headers.get('content-type'), /^text\/html/, page);
    const text = await res.text();
    const visible = text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
    assert.ok(visible.replace(/\s+/g, ' ').trim().length > 500, page + ' needs more than 500 characters of prose');
  }
});

test('Accept: text/markdown returns markdown at the same url, with Vary', async () => {
  for (const page of ['/', '/about', '/contact', '/privacy']) {
    const res = await get(page, 'text/markdown');
    assert.equal(res.status, 200, page);
    assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8', page);
    assert.match(res.headers.get('vary') ?? '', /\bAccept\b/, page + ' must vary on Accept');
    assert.match(await res.text(), /^# /m, page);
  }
});

test('the html variant also advertises Vary: Accept', async () => {
  for (const page of ['/', '/about', '/contact', '/privacy']) {
    const res = await get(page, BROWSER);
    assert.match(res.headers.get('vary') ?? '', /\bAccept\b/, page);
  }
});

test('q-values are honoured in both directions', async () => {
  const html = await get('/', 'text/markdown;q=0.1, text/html;q=0.9');
  assert.match(html.headers.get('content-type'), /^text\/html/);

  const markdown = await get('/', 'text/html;q=0.1, text/markdown;q=0.9');
  assert.match(markdown.headers.get('content-type'), /^text\/markdown/);
});

test('a client that accepts neither form gets 406, not a guess', async () => {
  const res = await get('/', 'application/pdf');
  assert.equal(res.status, 406);
  assert.match(res.headers.get('vary') ?? '', /\bAccept\b/);
  assert.match(await res.text(), /text\/markdown/);
});

test('a nonexistent path returns a real 404 with a recoverable body', async () => {
  const res = await get('/some-path-that-does-not-exist', BROWSER);
  assert.equal(res.status, 404);
  const body = await res.text();
  for (const pointer of ['/llms.txt', '/sitemap.xml', '/about', '/contact', '/index.md']) {
    assert.ok(body.includes(pointer), '404 body should point at ' + pointer);
  }
});

test('a nonexistent path asked for in markdown returns a 404 markdown body', async () => {
  const res = await get('/some-path-that-does-not-exist', 'text/markdown');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /^text\/markdown/);
  const body = await res.text();
  assert.match(body, /^# 404/m);
  assert.ok(body.includes('/llms.txt') && body.includes('/sitemap.xml'));
});

test('the machine-readable files are served', async () => {
  const cases = [
    ['/robots.txt', /^text\/plain/, /Sitemap: https:\/\/www\.ashwinrohit\.com\/sitemap\.xml/],
    ['/sitemap.xml', /xml/, /<urlset/],
    ['/llms.txt', /^text\//, /^# Ashwin Rohit Alagiri Rajan/m],
    ['/index.md', /^text\/markdown/, /^# Ashwin Rohit Alagiri Rajan/m],
    ['/about.md', /^text\/markdown/, /^# About/m],
    ['/contact.md', /^text\/markdown/, /^# Contact/m],
    ['/privacy.md', /^text\/markdown/, /^# Privacy/m],
  ];
  for (const [p, type, body] of cases) {
    const res = await get(p, '*/*');
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type'), type, p);
    assert.match(await res.text(), body, p);
  }
});

test('the og image and stylesheet are served', async () => {
  for (const [p, type] of [['/assets/og.png', /^image\/png/], ['/assets/page.css', /^text\/css/]]) {
    const res = await get(p, '*/*');
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type'), type, p);
  }
});

test('the .html urls redirect to the canonical ones', async () => {
  for (const [from, to] of Object.entries({
    '/home.html': '/',
    '/about.html': '/about',
    '/contact.html': '/contact',
    '/privacy.html': '/privacy',
  })) {
    const res = await get(from, BROWSER);
    assert.equal(res.status, 308, from);
    assert.equal(new URL(res.headers.get('location'), base).pathname, to, from);
  }
});
