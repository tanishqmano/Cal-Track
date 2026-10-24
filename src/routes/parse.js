'use strict';

/**
 * POST /api/parse — the API proxy.
 *
 * The page posts a request body it built itself; this adds the auth header from
 * .env and forwards it upstream. The key never reaches the browser.
 */

const { json, readBody } = require('../http/respond');
const { MAX_BODY_BYTES, MAX_TOKENS_CAP } = require('../config/limits');
const { PROVIDER_NAME, provider, API_KEY, FALLBACK_MODEL } = require('../config/providers');
const { meterAdd, logUsage } = require('../meter');

async function forward(payload) {
  const upstream = await fetch(provider.url, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, provider.headers(API_KEY)),
    body: JSON.stringify(payload)
  });
  return { status: upstream.status, text: await upstream.text() };
}

// Overloaded (Gemini's "high demand" is a 503) or out of quota. Neither says
// anything about the request itself, so another model may well take it.
const worthAnotherModel = status => status === 429 || status >= 500;

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

  let out;
  try {
    out = await forward(payload);
  } catch (e) {
    return json(res, 502, { error: { message: `Could not reach ${PROVIDER_NAME}: ` + e.message } });
  }

  // One immediate try on the fallback. If that fails too, the page is shown the
  // main model's error, which is the one that explains what happened; its own
  // retry in public/js/api/client.js waits a moment and starts again from here.
  if (worthAnotherModel(out.status) && FALLBACK_MODEL) {
    try {
      const alt = await forward(Object.assign({}, payload, { model: FALLBACK_MODEL }));
      console.log(`  ${provider.model} answered ${out.status}; ${FALLBACK_MODEL} answered ${alt.status}`);
      if (alt.status < 400) out = alt;
    } catch { /* keep the main model's answer */ }
  }

  const used = meterAdd(out.text);
  if (used) logUsage(used);

  res.writeHead(out.status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // Says "this answer is the provider's, not ours". The page needs the
    // difference: a 429 from upstream is a quota to wait out, while a 429 from
    // the gate above means a wrong passphrase and must never be retried.
    'x-upstream': '1'
  });
  res.end(out.text);
}

module.exports = { parseFood };
