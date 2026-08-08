#!/usr/bin/env node
'use strict';

/**
 * Local server for the macro tracker.
 *
 *   - Serves macro-tracker.html
 *   - Reads the selected provider's API key from .env and injects it into calls
 *   - Holds the food log so every device shares one copy, in a JSON file or in
 *     MongoDB depending on STORE in .env
 *
 * The key never reaches the browser. The page posts to /api/parse on its own
 * origin; this process adds the auth header and forwards it upstream.
 *
 * Run with:  node server.js
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '0.0.0.0';
const PAGE = 'macro-tracker.html';

// Guardrails: this proxy forwards a request body built by the page, so pin the
// things that control spend. It is a personal tool, not an open relay.
const MAX_TOKENS_CAP = 4000;
const MAX_BODY_BYTES = 64 * 1024;

// The log is the whole history, not one request, so it gets its own ceiling.
// Well under MongoDB's 16MB document limit, which is the tighter of the two.
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const MAX_STATE_BYTES = 8 * 1024 * 1024;

/* ---------- .env ---------- */

function loadEnv(file) {
  const out = {};
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = loadEnv(path.join(ROOT, '.env'));

// Values pasted into a hosting dashboard often arrive wrapped in quotes or with
// a stray space on the end, and an API key or passphrase that is wrong by one
// invisible character fails in a way nobody can see. The .env parser already
// unwraps quotes; do the same for real environment variables so both sources
// behave alike.
function clean(v) {
  if (typeof v !== 'string') return '';
  let s = v.trim();
  if (s.length > 1 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

const pick = k => clean(env[k]) || clean(process.env[k]) || '';

/* ---------- provider ---------- */

// Two wire formats. `anthropic` is the Messages API; `openai` is the
// /chat/completions shape that NVIDIA NIM, OpenRouter, Together, vLLM and
// OpenAI itself all speak. The page asks /api/health which one is live and
// formats its requests to match, so switching backends is a .env edit.
const PROVIDERS = {
  nvidia: {
    format: 'openai',
    url: (pick('NVIDIA_BASE_URL') || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '') + '/chat/completions',
    keyName: 'NVIDIA_API_KEY',
    key: pick('NVIDIA_API_KEY'),
    model: pick('NVIDIA_MODEL') || 'nvidia/llama-3.3-nemotron-super-49b-v1',
    headers: k => ({ authorization: 'Bearer ' + k })
  },
  // Google publishes an OpenAI-compatible front door for Gemini, so it rides
  // the same wire format as the others — no third adapter in the page.
  gemini: {
    format: 'openai',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyName: 'GEMINI_API_KEY',
    key: pick('GEMINI_API_KEY'),
    model: pick('GEMINI_MODEL') || 'gemini-3.5-flash-lite',
    headers: k => ({ authorization: 'Bearer ' + k })
  },
  anthropic: {
    format: 'anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    keyName: 'ANTHROPIC_API_KEY',
    key: pick('ANTHROPIC_API_KEY'),
    model: pick('ANTHROPIC_MODEL') || 'claude-sonnet-4-6',
    headers: k => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' })
  }
};

const PROVIDER_NAME = PROVIDERS[pick('AI_PROVIDER')] ? pick('AI_PROVIDER') : 'nvidia';
const P = PROVIDERS[PROVIDER_NAME];
const API_KEY = P.key;

/* ---------- helpers ---------- */

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ---------- the log ----------

   One document, guarded by a revision number, behind two methods:

     read()                        -> { rev, updated, state }
     commit(state, onRev, force)   -> { ok: true, doc } | { ok: false, current }

   commit() owns the concurrency check rather than the route, because the two
   backends enforce it differently: the file re-reads then writes, while Mongo
   folds the check into the update filter and settles it in one round trip.

   Which backend runs is a .env edit. `file` keeps the log beside the code and
   needs nothing installed — enough when the app only ever runs on this Mac.
   `mongo` puts it somewhere reachable from outside the house, which is what
   hosting the app requires: web hosts have throwaway disks, so a JSON file
   there would not survive a restart. */

const EMPTY_LOG = { rev: 0, updated: null, state: null };
const LOG_ID = 'log';   // single document — this is one person's diary

const MONGO_URI = pick('MONGODB_URI');
const MONGO_DB = pick('MONGODB_DB') || 'macro-tracker';
const MONGO_COLLECTION = pick('MONGODB_COLLECTION') || 'logs';
const STORE_NAME = (pick('STORE') || (MONGO_URI ? 'mongo' : 'file')).toLowerCase();

const fileStore = {
  label: 'data/state.json',

  async read() {
    try {
      const doc = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (doc && typeof doc.rev === 'number') return doc;
    } catch {
      // Missing or corrupt: report an empty log. The first commit re-creates it.
    }
    return EMPTY_LOG;
  },

  async commit(state, onRev, force) {
    const current = await this.read();
    if (!force && onRev !== current.rev) return { ok: false, current };

    const doc = { rev: current.rev + 1, updated: new Date().toISOString(), state };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Write-then-rename. A crash mid-write leaves the old log intact rather
    // than a truncated file, which for a hand-kept food diary is everything.
    const tmp = STATE_FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, STATE_FILE);
    return { ok: true, doc };
  }
};

const mongoStore = {
  label: 'MongoDB ' + MONGO_DB + '.' + MONGO_COLLECTION,
  _coll: null,

  async collection() {
    if (this._coll) return this._coll;
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    this._coll = client.db(MONGO_DB).collection(MONGO_COLLECTION);
    return this._coll;
  },

  async read() {
    const coll = await this.collection();
    const doc = await coll.findOne({ _id: LOG_ID });
    if (!doc || typeof doc.rev !== 'number') return EMPTY_LOG;
    return { rev: doc.rev, updated: doc.updated, state: doc.state };
  },

  async commit(state, onRev, force) {
    const coll = await this.collection();
    const updated = new Date().toISOString();

    if (force) {
      const current = await this.read();
      const doc = { rev: current.rev + 1, updated, state };
      await coll.updateOne({ _id: LOG_ID }, { $set: doc }, { upsert: true });
      return { ok: true, doc };
    }

    // Writing from revision 0 means the client believes no log exists yet, so
    // the insert itself is the check: a duplicate _id says someone beat us.
    if (onRev === 0) {
      try {
        await coll.insertOne({ _id: LOG_ID, rev: 1, updated, state });
        return { ok: true, doc: { rev: 1, updated, state } };
      } catch (e) {
        if (e && e.code === 11000) return { ok: false, current: await this.read() };
        throw e;
      }
    }

    // The revision rides in the filter, so two devices racing cannot both win:
    // the second matches no document and is told to merge instead.
    const doc = { rev: onRev + 1, updated, state };
    const res = await coll.updateOne({ _id: LOG_ID, rev: onRev }, { $set: doc });
    if (res.matchedCount !== 1) return { ok: false, current: await this.read() };
    return { ok: true, doc };
  }
};

let store = fileStore;
if (STORE_NAME === 'mongo') {
  if (MONGO_URI) store = mongoStore;
  else console.warn('  STORE=mongo but MONGODB_URI is empty — falling back to the file store.');
}

// Moving to Mongo should not mean retyping a week of meals. If the database is
// empty and a file log exists, carry it over once, on startup.
async function importFileLog() {
  if (store !== mongoStore) return;
  const existing = await store.read();
  if (existing.rev !== 0) return;

  const local = await fileStore.read();
  if (local.rev === 0 || !local.state) return;

  const res = await store.commit(local.state, 0, false);
  if (res.ok) {
    console.log('  Imported data/state.json into MongoDB (now rev ' + res.doc.rev + ').');
  }
}

/* ---------- the gate ----------

   On a home network the audience is whoever is in the house, and no passphrase
   is needed. On a public host the audience is everyone, and /api/parse is the
   part that matters: it spends your API key on behalf of whoever calls it.
   Setting PASSPHRASE in .env closes both the log and the proxy to strangers.

   The page itself stays open — it holds no data, and you need it in front of
   you to type the passphrase in. */

const PASSPHRASE = pick('PASSPHRASE');
const PASS_HASH = PASSPHRASE ? crypto.createHash('sha256').update(PASSPHRASE).digest() : null;

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
  const rec = misses.get(clientKey(req));
  if (!rec) return false;
  if (Date.now() - rec.at > MISS_WINDOW) { misses.delete(clientKey(req)); return false; }
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

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

/* ---------- routes ---------- */

function servePage(res) {
  let html;
  try {
    html = fs.readFileSync(path.join(ROOT, PAGE));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(PAGE + ' not found');
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': html.length,
    'cache-control': 'no-store'
  });
  res.end(html);
}

async function putState(req, res) {
  let raw;
  try {
    raw = await readBody(req, MAX_STATE_BYTES);
  } catch (e) {
    return json(res, 413, { error: { message: e.message } });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(res, 400, { error: { message: 'Malformed JSON body' } });
  }

  if (!body || typeof body.state !== 'object' || body.state === null) {
    return json(res, 400, { error: { message: 'Expected { rev, state }' } });
  }

  // Optimistic concurrency. A device writing from a revision it has not seen
  // gets told what it missed instead of silently flattening it; the page then
  // merges and retries. `force` is the Reset button, where wiping is the point.
  let out;
  try {
    out = await store.commit(body.state, Number(body.rev), Boolean(body.force));
  } catch (e) {
    return json(res, 503, { error: { message: 'Could not save log: ' + e.message } });
  }

  if (!out.ok) {
    return json(res, 409, { conflict: true, rev: out.current.rev, state: out.current.state });
  }
  json(res, 200, { rev: out.doc.rev, updated: out.doc.updated });
}

async function getState(res) {
  try {
    json(res, 200, await store.read());
  } catch (e) {
    // The page treats this as "no server" and keeps working from its own cache,
    // so a database blip costs sync, not the log.
    json(res, 503, { error: { message: 'Log store unavailable: ' + e.message } });
  }
}

async function parseFood(req, res) {
  if (!API_KEY) {
    return json(res, 503, { error: { message: `No key for provider "${PROVIDER_NAME}" in .env` } });
  }

  let raw;
  try {
    raw = await readBody(req, MAX_BODY_BYTES);
  } catch (e) {
    return json(res, 413, { error: { message: e.message } });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(res, 400, { error: { message: 'Malformed JSON body' } });
  }

  // The server, not the page, decides which model is billed. This is the only
  // spend control that a tampered page cannot route around.
  payload.model = P.model;
  payload.max_tokens = Math.min(Number(payload.max_tokens) || 1000, MAX_TOKENS_CAP);

  let upstream, text;
  try {
    upstream = await fetch(P.url, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, P.headers(API_KEY)),
      body: JSON.stringify(payload)
    });
    text = await upstream.text();
  } catch (e) {
    return json(res, 502, { error: { message: `Could not reach ${PROVIDER_NAME}: ` + e.message } });
  }

  res.writeHead(upstream.status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(text);
}

/* ---------- server ---------- */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;

  if (route === '/api/health' && req.method === 'GET') {
    // Answered without a passphrase, because the page has to learn that one is
    // wanted before it can ask for it. When the caller has not proved itself,
    // that is the only thing this says — no model, no provider, no key status.
    if (PASS_HASH && !authorized(req)) return json(res, 200, { ok: true, auth: true, authed: false });

    // `key` tells the page whether to use this proxy or fall back to asking
    // the user for a key in the browser. `format` tells it which wire shape
    // to build — the page adapts to the server, not the other way round.
    return json(res, 200, {
      ok: true,
      auth: Boolean(PASS_HASH),
      authed: true,
      key: Boolean(API_KEY),
      sync: true,
      // Named so a deployment can be checked from a browser. `file` on a hosted
      // instance means MONGODB_URI never arrived, and the log will vanish on the
      // next restart — worth being able to see without shell access.
      store: store === mongoStore ? 'mongo' : 'file',
      provider: PROVIDER_NAME,
      format: P.format,
      model: P.model
    });
  }

  // Everything past here touches either the log or the API key. The check runs
  // before the throttle, so the right passphrase always gets through — being
  // guessed at should never cost the owner access.
  if (route === '/api/parse' || route === '/api/state') {
    if (!authorized(req)) {
      if (throttled(req)) {
        return json(res, 429, { error: { message: 'Too many wrong passphrases. Wait a minute.' } });
      }
      noteMiss(req);
      return json(res, 401, { error: { message: 'Passphrase required' } });
    }
  }

  if (route === '/api/parse') {
    if (req.method !== 'POST') return json(res, 405, { error: { message: 'Use POST' } });
    return parseFood(req, res);
  }

  if (route === '/api/state') {
    if (req.method === 'GET') return getState(res);
    if (req.method === 'PUT') return putState(req, res);
    return json(res, 405, { error: { message: 'Use GET or PUT' } });
  }

  // Only the page is served. Nothing else on disk is reachable — notably .env.
  if (req.method === 'GET' && (route === '/' || route === '/' + PAGE)) {
    return servePage(res);
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, HOST, async () => {
  const lan = lanAddress();
  console.log('');
  console.log('  Macro tracker running');
  console.log('  ---------------------');
  console.log('  This Mac:  http://localhost:' + PORT + '/');
  if (lan) console.log('  Phone:     http://' + lan + ':' + PORT + '/   (same Wi-Fi)');
  console.log('');

  // Reported, never fatal. An unreachable database still leaves a usable page:
  // devices fall back to their own cache until it answers again.
  let where = store.label;
  try {
    await importFileLog();
    const doc = await store.read();
    where += '  (rev ' + doc.rev + (doc.updated ? ', updated ' + doc.updated : ', empty') + ')';
  } catch (e) {
    where += '  UNREACHABLE: ' + e.message;
  }
  console.log('  Log:       ' + where + ' — shared by every device');
  console.log('  Provider:  ' + PROVIDER_NAME + '  (' + P.format + ' wire format)');
  console.log('  Model:     ' + P.model);
  if (API_KEY) {
    console.log('  API key:   loaded from .env (' + API_KEY.slice(0, 11) + '…) — stays on this machine');
  } else {
    console.log('  API key:   MISSING. Add ' + P.keyName + ' to .env, then restart.');
  }
  if (PASS_HASH) {
    console.log('  Access:    passphrase required for the log and the API proxy');
  } else {
    console.log('  Access:    OPEN to anyone who can reach this address.');
    console.log('             Fine on home Wi-Fi. Set PASSPHRASE in .env before hosting this.');
  }
  console.log('');
  console.log('  Ctrl+C to stop.');
  console.log('');
});
