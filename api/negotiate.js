'use strict';

/* Content negotiation for the four pages of this site.
 *
 * The site is static, and stays static for browsers: vercel.json only routes a
 * request here when the Accept header mentions markdown, or when it names
 * neither HTML nor a wildcard. Everything else is served straight off the CDN
 * exactly as before, so the homepage keeps its single-request first paint.
 *
 * See https://acceptmarkdown.com for the convention this implements: markdown
 * at the same URL for `Accept: text/markdown`, `Vary: Accept` on the response,
 * honoured q-values, and 406 for a client that will take neither form.
 */

const fs = require('fs');
const path = require('path');
const { selectMediaType } = require('./_negotiate.js');

// Allowlist, so the `p` parameter can never reach outside these four pages.
const PAGES = {
  index:   { html: 'home.html',    markdown: 'home.md',   status: 200 },
  about:   { html: 'about.html',   markdown: 'about.md',   status: 200 },
  contact: { html: 'contact.html', markdown: 'contact.md', status: 200 },
  privacy: { html: 'privacy.html', markdown: 'privacy.md', status: 200 },
  404:     { html: '404.html',     markdown: '404.md',     status: 404 },
};

// Order matters: it is the server's preference, and so the tie-break for a
// client that asks for anything. HTML stays the primary representation.
const AVAILABLE = ['text/html', 'text/markdown'];

const CONTENT_TYPE = {
  'text/html': 'text/html; charset=utf-8',
  'text/markdown': 'text/markdown; charset=utf-8',
};

// The files are pulled into the bundle by the `includeFiles` glob in
// vercel.json; they sit at the deployment root next to the api directory.
const ROOTS = [process.cwd(), path.join(__dirname, '..')];

function readPage(name) {
  for (const root of ROOTS) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) return fs.readFileSync(file);
  }
  return null;
}

module.exports = function handler(req, res) {
  const requested = (req.query && req.query.p) || 'index';
  const page = Object.prototype.hasOwnProperty.call(PAGES, requested)
    ? PAGES[requested]
    : PAGES['404'];

  // Both representations are the same resource, so the cache has to key on
  // Accept or an agent and a browser will be handed each other's copy.
  res.setHeader('Vary', 'Accept, Accept-Encoding');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('405 Method Not Allowed\n');
  }

  const chosen = selectMediaType(req.headers.accept, AVAILABLE);

  if (chosen === null) {
    res.status(406);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(
      '406 Not Acceptable\n\n' +
        'This URL is available as text/html or text/markdown.\n' +
        'See https://www.ashwinrohit.com/llms.txt\n'
    );
  }

  const body = readPage(chosen === 'text/markdown' ? page.markdown : page.html);

  if (body === null) {
    res.status(500);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('500 Internal Server Error\n');
  }

  // A markdown twin lives at its own URL as well; point clients that followed
  // negotiation at the stable one.
  res.setHeader(
    'Link',
    '<https://www.ashwinrohit.com/' + page.markdown + '>; rel="alternate"; type="text/markdown"'
  );
  res.setHeader('Content-Type', CONTENT_TYPE[chosen]);
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.status(page.status);

  if (req.method === 'HEAD') return res.end();
  return res.end(body);
};
