'use strict';

/**
 * GET /api/health — what the page asks before it does anything else.
 *
 * Answered without a passphrase, because the page has to learn that one is
 * wanted before it can ask for it. When the caller has not proved itself, that
 * is the only thing this says — no model, no provider, no key status.
 */

const { json } = require('../http/respond');
const { passphraseRequired, authorized } = require('../http/auth');
const { PROVIDER_NAME, provider, API_KEY } = require('../config/providers');
const { store } = require('../store');
const { meter } = require('../meter');

function health(req, res) {
  if (passphraseRequired && !authorized(req)) {
    return json(res, 200, { ok: true, auth: true, authed: false });
  }

  // `key` tells the page whether to use this proxy or fall back to asking
  // the user for a key in the browser. `format` tells it which wire shape
  // to build — the page adapts to the server, not the other way round.
  json(res, 200, {
    ok: true,
    auth: passphraseRequired,
    authed: true,
    key: Boolean(API_KEY),
    sync: true,
    // Named so a deployment can be checked from a browser. `file` on a hosted
    // instance means MONGODB_URI never arrived, and the log will vanish on the
    // next restart — worth being able to see without shell access.
    store: store.kind,
    provider: PROVIDER_NAME,
    format: provider.format,
    model: provider.model,
    // Sits behind the passphrase like everything else, and a browser address
    // bar cannot send that header — so this is for the page itself and for
    // curl, not for typing the URL in on your phone.
    tokens: meter
  });
}

module.exports = { health };
