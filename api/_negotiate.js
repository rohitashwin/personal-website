'use strict';

/* Accept-header parsing for markdown content negotiation.
 *
 * Kept apart from the request handler so the interesting half — precedence,
 * q-values, "nothing here is acceptable" — can be unit-tested without a
 * server. Filenames beginning with an underscore are not routed by Vercel,
 * so this file is a module and not an endpoint.
 *
 * Follows RFC 9110 section 12.5.1: a media range matches by specificity
 * (an exact type beats a type wildcard beats a full wildcard), the most
 * specific match supplies the
 * quality value, and q=0 means "not acceptable" rather than "least preferred".
 */

/** Parse an Accept header into media ranges, most specific first. */
function parseAccept(header) {
  if (typeof header !== 'string') return [];

  return header
    .split(',')
    .map(function (part, index) {
      const pieces = part.trim().split(';');
      const range = pieces.shift().trim().toLowerCase();
      const slash = range.indexOf('/');
      if (slash === -1) return null;

      let q = 1;
      for (const param of pieces) {
        const eq = param.indexOf('=');
        if (eq === -1) continue;
        if (param.slice(0, eq).trim().toLowerCase() !== 'q') continue;
        const parsed = Number.parseFloat(param.slice(eq + 1).trim());
        // An unparseable q is a malformed header, not a request for q=0.
        q = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 1;
      }

      return {
        type: range.slice(0, slash),
        subtype: range.slice(slash + 1),
        q: q,
        index: index,
      };
    })
    .filter(Boolean);
}

// How well `range` matches `mediaType`: 2 exact, 1 subtype wildcard,
// 0 full wildcard, -1 no match.
function specificity(range, mediaType) {
  const slash = mediaType.indexOf('/');
  const type = mediaType.slice(0, slash);
  const subtype = mediaType.slice(slash + 1);

  if (range.type === type && range.subtype === subtype) return 2;
  if (range.type === type && range.subtype === '*') return 1;
  if (range.type === '*' && range.subtype === '*') return 0;
  return -1;
}

/** The quality the client assigned to `mediaType`, 0 if unacceptable. */
function qualityFor(ranges, mediaType) {
  let best = null;
  for (const range of ranges) {
    const score = specificity(range, mediaType);
    if (score === -1) continue;
    if (best === null || score > best.score) best = { score: score, q: range.q };
  }
  return best === null ? 0 : best.q;
}

/**
 * Pick a representation to serve.
 *
 * `available` is in server preference order, which breaks ties: a client
 * that sends a bare wildcard, or no Accept at all, gets the first entry.
 *
 * Returns the chosen media type, or null when the client accepts none of
 * them — the caller answers that with 406.
 */
function selectMediaType(header, available) {
  // A missing Accept header means "anything" (RFC 9110 section 12.5.1).
  if (header === undefined || header === null || String(header).trim() === '') {
    return available[0];
  }

  const ranges = parseAccept(header);
  if (ranges.length === 0) return available[0];

  let chosen = null;
  for (const mediaType of available) {
    const q = qualityFor(ranges, mediaType);
    if (q <= 0) continue;
    if (chosen === null || q > chosen.q) chosen = { mediaType: mediaType, q: q };
  }

  return chosen === null ? null : chosen.mediaType;
}

module.exports = { parseAccept, specificity, qualityFor, selectMediaType };
