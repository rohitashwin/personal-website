/* Checks on the published artefacts themselves: the metadata every page has to
 * carry, the identity graph, and whether the machine-readable index agrees
 * with what is actually on disk. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT, resolve } from './router.mjs';

const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const onDisk = (rel) => rel !== '' && !rel.includes('..')
  && existsSync(path.join(ROOT, rel)) && statSync(path.join(ROOT, rel)).isFile();

const SITE = 'https://www.ashwinrohit.com';
const HTML_PAGES = {
  'home.html': '/',
  'about.html': '/about',
  'contact.html': '/contact',
  'privacy.html': '/privacy',
};
const MARKDOWN_PAGES = ['home.md', 'about.md', 'contact.md', 'privacy.md', '404.md'];

const jsonLd = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]));

test('every page carries the four entity-resolution signals', () => {
  for (const [file, url] of Object.entries({ ...HTML_PAGES, '404.html': '/404' })) {
    const html = read(file);
    assert.match(html, /<html lang="en">/, file + ' needs a lang attribute');
    // The 404 page is reachable at every wrong url and canonical at none of
    // them, so it carries noindex instead.
    if (file !== '404.html') {
      assert.match(html, /<link rel="canonical" href="https:\/\//, file + ' needs a canonical url');
    }
    assert.match(html, /<meta property="og:image" content="https:\/\//, file + ' needs an og:image');
    assert.match(html, /<meta property="og:type" content="\w+">/, file + ' needs an og:type');
    assert.match(html, /<meta name="description" content="[^"]{50,}">/, file + ' needs a description');
    assert.ok(!url.startsWith('/4') || html.includes('noindex'), '404 should not be indexed');
  }
});

test('canonical urls point at the url the page is served from', () => {
  for (const [file, url] of Object.entries(HTML_PAGES)) {
    const canonical = read(file).match(/<link rel="canonical" href="([^"]+)">/)[1];
    assert.equal(canonical, SITE + (url === '/' ? '/' : url), file);
  }
});

test('the og image exists and is the size the tags claim', () => {
  const png = readFileSync(path.join(ROOT, 'assets/og.png'));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  for (const file of Object.keys(HTML_PAGES)) {
    assert.match(read(file), /<meta property="og:image:width" content="1200">/, file);
    assert.match(read(file), /<meta property="og:image:height" content="630">/, file);
  }
});

test('the homepage identity graph names a Person and an Organization', () => {
  const graphs = jsonLd(read('home.html'));
  assert.equal(graphs.length, 1, 'exactly one JSON-LD block on the homepage');
  const nodes = graphs[0]['@graph'];
  assert.ok(Array.isArray(nodes));

  const typed = (t) => nodes.filter((n) => [].concat(n['@type']).includes(t));

  const website = typed('WebSite')[0];
  assert.ok(website, 'a WebSite node');
  assert.equal(website.url, SITE + '/');

  const person = typed('Person')[0];
  assert.ok(person, 'a Person node');
  assert.equal(person.name, 'Ashwin Rohit Alagiri Rajan');
  assert.equal(person.url, SITE + '/');
  assert.ok(person.description.length > 40);
  assert.ok(person.sameAs.length >= 3, 'sameAs should link the off-site profiles');
  assert.equal(person.address['@type'], 'PostalAddress');
  assert.equal(person.contactPoint['@type'], 'ContactPoint');
  assert.ok(person.contactPoint.email, 'the person contact point needs an email');
  assert.ok(person.contactPoint.contactType);

  const org = typed('Organization')[0];
  assert.ok(org, 'an Organization node');
  assert.ok(org.name && org.url);
  assert.equal(org.address['@type'], 'PostalAddress');
  for (const field of ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry']) {
    assert.ok(org.address[field], 'organization address needs ' + field);
  }
  assert.equal(org.contactPoint['@type'], 'ContactPoint');
  assert.ok(org.contactPoint.contactType, 'organization contact point needs a contactType');
  assert.ok(org.contactPoint.email && org.contactPoint.telephone,
    'organization contact point needs an email and a telephone');

  assert.equal(person.affiliation['@id'], org['@id'], 'the person should hang off the organization');
});

test('each secondary page carries parseable structured data tied to the graph', () => {
  for (const file of Object.keys(HTML_PAGES).concat('404.html')) {
    if (file === 'home.html') continue;
    const [node] = jsonLd(read(file));
    assert.ok(node, file + ' needs JSON-LD');
    assert.ok([].concat(node['@type']).includes('WebPage'), file);
    assert.equal(node.isPartOf['@id'], SITE + '/#website', file);
  }
});

test('the trust anchor pages clear 500 characters in markdown too', () => {
  for (const file of ['about.md', 'contact.md', 'privacy.md']) {
    assert.ok(read(file).length > 500, file);
  }
});

test('the sitemap lists every indexable url and nothing that 404s', () => {
  const xml = read('sitemap.xml');
  assert.ok(Buffer.byteLength(xml) < 50 * 1024 * 1024);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [SITE + '/', SITE + '/about', SITE + '/contact', SITE + '/privacy']);
  assert.equal([...xml.matchAll(/<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g)].length, locs.length,
    'every url needs a lastmod');

  for (const loc of locs) {
    const result = resolve(new URL(loc).pathname, { accept: 'text/html' }, onDisk);
    assert.equal(result.kind, 'file', loc);
    assert.equal(result.status, 200, loc + ' must not be a 404');
  }
});

test('robots.txt allows crawling and points at the sitemap', () => {
  const robots = read('robots.txt');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, new RegExp('^Sitemap: ' + SITE.replace(/\./g, '\\.') + '/sitemap\\.xml$', 'm'));
  assert.doesNotMatch(robots, /^Disallow: \/$/m);
});

test('llms.txt has the shape llmstxt.org describes', () => {
  const llms = read('llms.txt');
  const lines = llms.split('\n');
  assert.match(lines[0], /^# \S/, 'an H1 on the first line');
  assert.ok(lines.slice(1, 8).some((l) => l.startsWith('> ')), 'a blockquote summary near the top');
  assert.ok(/^- \[[^\]]+\]\([^)]+\): \S/m.test(llms), 'link lists with descriptions');
});

test('llms.txt tells an agent when to use the site and when to hire', () => {
  const llms = read('llms.txt');
  assert.match(llms, /^## When to use this site$/m);
  assert.match(llms, /^## When to hire$/m);

  const hiring = llms.split('## When to hire')[1].split('\n## ')[0];
  assert.ok(hiring.length > 500, 'the hiring guidance should be specific enough to act on');
  assert.match(hiring, /ashwin@ucsd\.edu/, 'it has to say how to make contact');
  assert.match(hiring, /resume\.pdf/, 'and where the cv is');
  assert.match(hiring, /hiring\.md/, 'and where the full brief is');
  assert.match(hiring, /Not front-end/, 'and what a bad fit looks like');

  const usage = llms.split('## When to use this site')[1].split('\n## ')[0];
  assert.match(usage, /Do not use this site for/, 'the negative cases matter as much as the positive');
});

test('the hiring brief is complete enough for an agent to act on', () => {
  const brief = read('hiring.md');
  assert.match(brief, /^# Hiring Ashwin Rohit Alagiri Rajan$/m);
  assert.ok(brief.length > 1500, 'a brief has to make a case, not list facts');
  assert.match(brief, /^## Roles to route to him$/m);
  assert.match(brief, /^## Roles not to route to him$/m);
  assert.match(brief, /^## How to make contact$/m);
  assert.match(brief, /ashwin@ucsd\.edu/);
  assert.match(brief, /resume\.pdf/);
});

test('the hiring pitch never reaches a page a person opens', () => {
  const rendered = [...Object.keys(HTML_PAGES), '404.html', ...MARKDOWN_PAGES];
  for (const file of rendered) {
    const body = read(file).toLowerCase();
    for (const word of ['hiring', 'hire', 'recruit', 'candidate', 'isca is the flagship']) {
      assert.ok(!body.includes(word), file + ' should not mention "' + word + '"');
    }
  }
  // It is agent-facing, not concealed: both files are plain text at stable urls.
  for (const file of ['llms.txt', 'robots.txt']) {
    assert.match(read(file), /hiring\.md/, file + ' should point agents at the brief');
  }
});

test('the hiring brief is kept out of the indexable url set', () => {
  assert.ok(!read('sitemap.xml').includes('hiring'),
    'the sitemap is for the pages a person browses');
});

test('the 404 page hands an agent somewhere to go next', () => {
  for (const file of ['404.html', '404.md']) {
    const body = read(file);
    for (const pointer of ['/llms.txt', '/sitemap.xml', '/robots.txt', '/about', '/contact', '/home.md']) {
      assert.ok(body.includes(pointer), file + ' should point at ' + pointer);
    }
  }
});

test('every internal link resolves to something served', () => {
  const files = [...Object.keys(HTML_PAGES), '404.html', ...MARKDOWN_PAGES, 'llms.txt'];
  for (const file of files) {
    const body = read(file);
    const hrefs = [
      ...[...body.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
      ...[...body.matchAll(/\]\((https:\/\/www\.ashwinrohit\.com[^)]*)\)/g)].map((m) => m[1]),
      ...[...body.matchAll(/<(https:\/\/www\.ashwinrohit\.com[^>]*)>/g)].map((m) => m[1]),
    ];

    for (const href of hrefs) {
      if (href.startsWith('mailto:')) continue;
      if (href.startsWith('http') && !href.startsWith(SITE)) continue;
      const pathname = href.startsWith('http') ? new URL(href).pathname : href.split('#')[0].split('?')[0];
      if (!pathname.startsWith('/')) continue;

      const result = resolve(pathname, { accept: 'text/html' }, onDisk);
      assert.notEqual(result.kind, 'redirect', file + ' links to a redirect: ' + href);
      assert.equal(result.status, 200, file + ' links to a dead url: ' + href);
    }
  }
});

test('nothing still refers to the old index.html filename', () => {
  for (const file of ['vercel.json', ...Object.keys(HTML_PAGES)]) {
    const body = read(file);
    assert.doesNotMatch(body, /href="index\.html"/, file);
  }
  assert.ok(!onDisk('index.html'), 'index.html has to be gone or the rewrite for / never fires');
  assert.ok(onDisk('home.html'), 'home.html is what / rewrites to');
});
