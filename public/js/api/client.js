/* One request to the model, with the retry that makes a free tier usable. */

import { authFetch, forgetPass, setNeedsPass, showGate } from './access.js';
import { serverMode, apiKey, format, DIRECT_URL } from './config.js';
import { buildPayload } from './adapter.js';
import { showMsg } from '../ui/chat.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// A rate-limited provider usually states how long to wait. Prefer that number
// over a guess, but never trust it far enough to freeze the app.
function retryDelayMs(data) {
  const details = (data && data.error && data.error.details) || [];
  for (const d of details) {
    const m = d && typeof d.retryDelay === 'string' && d.retryDelay.match(/^([\d.]+)s$/);
    if (m) return Math.min(Math.max(Number(m[1]) * 1000, 500), 15000);
  }
  return 2000;
}

const MAX_RETRIES = 2;

export async function callApi(messages) {
  const body = JSON.stringify(buildPayload(messages));

  // Server mode: post to our own origin, which adds the key from .env.
  // Direct mode: call the provider straight from the browser with the saved key.
  const headers = { 'content-type': 'application/json' };
  if (!serverMode) {
    if (format === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else {
      headers.authorization = 'Bearer ' + apiKey;
    }
  }

  // Free-tier quotas are counted per minute, so being throttled is usually over
  // in seconds. Retrying *here* is what makes that cheap: this runs before the
  // caller executes any tool, so a second attempt cannot log the same food
  // twice. Retrying around the tool loop instead would lose that guarantee.
  for (let attempt = 0; ; attempt++) {
    const res = await authFetch(serverMode ? '/api/parse' : DIRECT_URL, { method: 'POST', headers, body });

    if (res.status === 401 && serverMode) {
      await forgetPass();
      setNeedsPass(true);
      showGate('Passphrase no longer accepted. Enter it again.');
      throw new Error('Passphrase required.');
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* fall through */ }

    // Gemini returns errors as a one-element array rather than an object. Unwrap
    // it, or the reason gets swallowed and the user is told only "HTTP 404".
    if (Array.isArray(data)) data = data[0] || null;

    if (res.ok && !(data && data.type === 'error')) return data;

    // Only the provider's own 429 is worth a second go. The same status from
    // our passphrase gate means someone is guessing, and retrying that would
    // help them do it. In direct mode there is no gate, so 429 can only be the
    // provider. `x-upstream` is what separates the two when proxied.
    const throttled = res.status === 429 && (!serverMode || res.headers.get('x-upstream'));
    if (throttled && attempt < MAX_RETRIES) {
      const wait = retryDelayMs(data);
      showMsg('Rate limit reached. Retrying in ' + Math.round(wait / 1000) + 's…', true);
      await sleep(wait);
      continue;
    }

    // Out of retries, or never eligible. A daily quota is a wall, not a pause —
    // say so plainly rather than stalling behind more attempts.
    const err = data && data.error;
    throw new Error((err && (err.message || err)) || ('HTTP ' + res.status));
  }
}
