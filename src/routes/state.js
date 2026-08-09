'use strict';

/**
 * GET/PUT /api/state — the shared food log.
 */

const { json, readBody } = require('../http/respond');
const { MAX_STATE_BYTES } = require('../config/limits');
const { store } = require('../store');

async function getState(res) {
  try {
    json(res, 200, await store.read());
  } catch (e) {
    // The page treats this as "no server" and keeps working from its own cache,
    // so a database blip costs sync, not the log.
    json(res, 503, { error: { message: 'Log store unavailable: ' + e.message } });
  }
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

module.exports = { getState, putState };
