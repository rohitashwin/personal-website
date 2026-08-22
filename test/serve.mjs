/* Local server that answers requests through the emulated Vercel router, so
 * the endpoint tests can speak real HTTP against the real config and the real
 * negotiation handler. */

import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, resolve } from './router.mjs';

const require = createRequire(import.meta.url);
const negotiate = require(path.join(ROOT, 'api/negotiate.js'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
};

const fileExists = (rel) => {
  if (rel === '' || rel.includes('..')) return false;
  const full = path.join(ROOT, rel);
  return existsSync(full) && statSync(full).isFile();
};

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const result = resolve(url.pathname, req.headers, fileExists);

    for (const [key, value] of Object.entries(result.headers ?? {})) {
      res.setHeader(key, value);
    }

    if (result.kind === 'redirect') {
      res.statusCode = result.status;
      res.setHeader('Location', result.location);
      return res.end();
    }

    if (result.kind === 'function') {
      // Minimal shim for the two helpers Vercel adds to req/res.
      req.query = { p: result.page };
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      return negotiate(req, res);
    }

    const body = readFileSync(path.join(ROOT, result.file));
    res.statusCode = result.status;
    res.setHeader('Content-Type', TYPES[path.extname(result.file)] ?? 'application/octet-stream');
    res.setHeader('Content-Length', body.length);
    return res.end(req.method === 'HEAD' ? undefined : body);
  });
}

export function listen() {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => done({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}
