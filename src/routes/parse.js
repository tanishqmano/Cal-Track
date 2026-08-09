'use strict';

/**
 * POST /api/parse — the API proxy.
 *
 * The page posts a request body it built itself; this adds the auth header from
 * .env and forwards it upstream. The key never reaches the browser.
 */

const { json, readBody } = require('../http/respond');
const { MAX_BODY_BYTES, MAX_TOKENS_CAP } = require('../config/limits');
const { PROVIDER_NAME, provider, API_KEY } = require('../config/providers');
const { meterAdd, logUsage } = require('../meter');

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
  payload.model = provider.model;
  payload.max_tokens = Math.min(Number(payload.max_tokens) || 1000, MAX_TOKENS_CAP);

  let upstream, text;
  try {
    upstream = await fetch(provider.url, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, provider.headers(API_KEY)),
      body: JSON.stringify(payload)
    });
    text = await upstream.text();
  } catch (e) {
    return json(res, 502, { error: { message: `Could not reach ${PROVIDER_NAME}: ` + e.message } });
  }

  const used = meterAdd(text);
  if (used) logUsage(used);

  res.writeHead(upstream.status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // Says "this answer is the provider's, not ours". The page needs the
    // difference: a 429 from upstream is a quota to wait out, while a 429 from
    // the gate above means a wrong passphrase and must never be retried.
    'x-upstream': '1'
  });
  res.end(text);
}

module.exports = { parseFood };
