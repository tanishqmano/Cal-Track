'use strict';

/**
 * The gate.
 *
 * On a home network the audience is whoever is in the house, and no passphrase
 * is needed. On a public host the audience is everyone, and /api/parse is the
 * part that matters: it spends your API key on behalf of whoever calls it.
 * Setting PASSPHRASE in .env closes both the log and the proxy to strangers.
 *
 * The page itself stays open — it holds no data, and you need it in front of
 * you to type the passphrase in.
 */

const crypto = require('crypto');
const { pick } = require('../config/env');

const PASSPHRASE = pick('PASSPHRASE');
const PASS_HASH = PASSPHRASE ? crypto.createHash('sha256').update(PASSPHRASE).digest() : null;
const passphraseRequired = Boolean(PASS_HASH);

// Compared as fixed-length digests so the comparison time cannot leak how much
// of a guess was right.
function authorized(req) {
  if (!PASS_HASH) return true;
  const sent = req.headers['x-macro-pass'];
  if (typeof sent !== 'string' || !sent) return false;
  const got = crypto.createHash('sha256').update(sent).digest();
  return crypto.timingSafeEqual(got, PASS_HASH);
}

// Wrong guesses are cheap to make and cheap to slow down. Counted per caller,
// forgotten after a quiet minute. Only ever consulted for requests that failed
// the passphrase, so a guesser can never lock the owner out of their own log.
const misses = new Map();
const MISS_LIMIT = 15;
const MISS_WINDOW = 60 * 1000;

// Behind a host like Render every request arrives from the platform's proxy, so
// the socket address is the same for everybody and would make one shared
// bucket. The forwarded address is spoofable, but this only paces guessing —
// the passphrase is the actual barrier.
function clientKey(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function throttled(req) {
  const who = clientKey(req);
  const rec = misses.get(who);
  if (!rec) return false;
  if (Date.now() - rec.at > MISS_WINDOW) { misses.delete(who); return false; }
  return rec.n >= MISS_LIMIT;
}

function noteMiss(req) {
  const who = clientKey(req);
  const rec = misses.get(who);
  if (!rec || Date.now() - rec.at > MISS_WINDOW) misses.set(who, { n: 1, at: Date.now() });
  else { rec.n++; rec.at = Date.now(); }

  // Unbounded growth is its own denial of service; drop the stalest entries.
  if (misses.size > 5000) {
    for (const [k, v] of misses) if (Date.now() - v.at > MISS_WINDOW) misses.delete(k);
  }
}

module.exports = { passphraseRequired, authorized, throttled, noteMiss };
