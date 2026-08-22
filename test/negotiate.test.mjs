import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './router.mjs';

const require = createRequire(import.meta.url);
const { parseAccept, qualityFor, selectMediaType } = require(path.join(ROOT, 'api/_negotiate.js'));

const AVAILABLE = ['text/html', 'text/markdown'];
const pick = (accept) => selectMediaType(accept, AVAILABLE);

test('an explicit markdown request gets markdown', () => {
  assert.equal(pick('text/markdown'), 'text/markdown');
  assert.equal(pick('text/markdown, text/plain'), 'text/markdown');
});

test('a browser request gets html', () => {
  assert.equal(pick('text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8'), 'text/html');
  assert.equal(pick('text/html'), 'text/html');
});

test('a wildcard or an absent header falls back to the server preference', () => {
  assert.equal(pick('*/*'), 'text/html');
  assert.equal(pick(undefined), 'text/html');
  assert.equal(pick(''), 'text/html');
  assert.equal(pick('   '), 'text/html');
});

test('q-values decide when both are acceptable', () => {
  assert.equal(pick('text/markdown;q=0.1, text/html;q=0.9'), 'text/html');
  assert.equal(pick('text/markdown;q=0.9, text/html;q=0.1'), 'text/markdown');
  assert.equal(pick('text/html;q=0.5,text/markdown;q=0.5'), 'text/html', 'ties go to the server preference');
});

test('q=0 means unacceptable, not least preferred', () => {
  assert.equal(pick('text/html;q=0, text/markdown'), 'text/markdown');
  assert.equal(pick('*/*, text/html;q=0'), 'text/markdown');
  assert.equal(pick('text/markdown;q=0'), null);
});

test('a client that will take neither form gets nothing to serve', () => {
  assert.equal(pick('application/pdf'), null);
  assert.equal(pick('application/json'), null);
  assert.equal(pick('image/png, image/webp'), null);
});

test('a more specific range wins over a wildcard', () => {
  const ranges = parseAccept('*/*;q=0.2, text/markdown;q=0.9');
  assert.equal(qualityFor(ranges, 'text/markdown'), 0.9);
  assert.equal(qualityFor(ranges, 'text/html'), 0.2);
  assert.equal(pick('*/*;q=0.2, text/markdown;q=0.9'), 'text/markdown');
});

test('a subtype wildcard matches both representations', () => {
  assert.equal(pick('text/*'), 'text/html');
  assert.equal(pick('text/*;q=0.4, text/markdown;q=0.8'), 'text/markdown');
});

test('parsing tolerates odd spacing, case and malformed parameters', () => {
  assert.equal(pick('  TEXT/MARKDOWN  '), 'text/markdown');
  assert.equal(pick('text/markdown ;  q = 0.9'), 'text/markdown');
  assert.equal(pick('text/markdown;q=notanumber'), 'text/markdown', 'a broken q is treated as 1, not 0');
  assert.equal(pick('garbage'), 'text/html', 'a header with no usable range means no preference, not 406');
  assert.equal(pick('text/markdown;q=7'), 'text/markdown', 'q is clamped into range');
});
