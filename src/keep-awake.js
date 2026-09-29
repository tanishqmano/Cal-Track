'use strict';

/**
 * Keeps a free Render instance from falling asleep.
 *
 * Render stops a free web service after 15 minutes without a visitor, and the
 * next request waits 30–60 seconds for it to start again. The page's own sync
 * loop keeps it up only while a tab is on screen, so a locked phone lets it
 * doze off and the first meal logged after a break pays for the wake-up.
 *
 * Visiting our own public address every 10 minutes counts as a visitor. It has
 * to go out through the public URL rather than localhost, because Render only
 * counts traffic that arrives through its front door.
 *
 * Render sets RENDER_EXTERNAL_URL on every web service, so there is nothing to
 * configure. Anywhere else it is unset and this does nothing.
 */

const { pick } = require('./config/env');

const SELF_URL = pick('RENDER_EXTERNAL_URL').replace(/\/+$/, '');
const EVERY_MS = 10 * 60 * 1000;

// /api/health is the cheapest thing to ask for: no passphrase, no database, no
// API key. The reply is read so the connection is released. A ping that fails
// is simply retried on the next tick — it must never take the server down.
function startKeepAwake() {
  if (!SELF_URL) return false;
  const ping = () => fetch(SELF_URL + '/api/health').then(r => r.arrayBuffer()).catch(() => {});
  setInterval(ping, EVERY_MS).unref();
  return true;
}

module.exports = { startKeepAwake, SELF_URL, EVERY_MS };
