/* Asks the server what it is, before the page does anything else. */

import { authFetch, setNeedsPass } from './access.js';
import { adoptServerInfo } from './config.js';

// True when server.js is in front of us AND holds a key — i.e. this page should
// proxy through its own origin rather than call the provider itself.
export async function detectServer() {
  try {
    const res = await authFetch('/api/health', { cache: 'no-store' });
    if (!res.ok) return false;
    const info = await res.json();
    if (!(info && info.ok)) return false;

    // The server wants a passphrase and has not accepted ours — which covers
    // having none stored and having one the server no longer honours.
    if (info.auth && !info.authed) { setNeedsPass(true); return false; }
    setNeedsPass(false);

    if (!info.key) return false;
    adoptServerInfo(info);
    return true;
  } catch (e) {
    return false; // static host with no server behind it → direct mode
  }
}
