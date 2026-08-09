'use strict';

/**
 * Serves public/ and nothing else.
 *
 * The page used to be one file, so "serve the page" was a single readFileSync.
 * It is now a page plus stylesheets plus modules, which means a real static
 * handler — and a static handler is exactly where a server accidentally starts
 * handing out .env. Two rules keep that from happening:
 *
 *   1. Every path is resolved and then checked to still be inside public/, so
 *      ../ cannot climb out. .env, data/ and src/ are outside it.
 *   2. Only the extensions below are served at all. An unknown one is a 404
 *      whether or not the file exists.
 */

const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR } = require('../config/paths');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};

// Cheap validator, no hashing. `no-cache` then means the browser asks every
// time and is answered with an empty 304 unless the file actually changed —
// so a reload costs a round trip instead of the whole page, and a deploy is
// never half old and half new.
const etagOf = st => '"' + st.size.toString(16) + '-' + st.mtimeMs.toString(16) + '"';

// Returns the absolute path to serve, or null if the request is not ours.
function resolve(pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;

  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;    // malformed %-escape
  }
  if (decoded.includes('\0')) return null;

  const file = path.resolve(PUBLIC_DIR, '.' + path.posix.normalize(decoded));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return null;
  if (!TYPES[path.extname(file).toLowerCase()]) return null;
  return file;
}

// Returns true when it answered, false when the request was for something else
// and the router should carry on.
function serve(req, res, pathname) {
  const file = resolve(pathname);
  if (!file) return false;

  let st;
  try {
    st = fs.statSync(file);
    if (!st.isFile()) return false;
  } catch {
    return false;
  }

  const etag = etagOf(st);
  const headers = {
    'content-type': TYPES[path.extname(file).toLowerCase()],
    'cache-control': 'no-cache',
    etag
  };

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  headers['content-length'] = st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

module.exports = { serve };
