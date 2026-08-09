/* The passphrase, and the screen that asks for it.
 *
 * Set only when the server asks for one. Held on the device so it is typed once
 * per phone or laptop, and sent with every request that touches the log or the
 * API proxy. */

import { $ } from '../lib/dom.js';
import { writePass, clearPass } from '../state/cache.js';

export let passphrase = '';
export const setPassphrase = v => { passphrase = v; };

export let needsPass = false;
export const setNeedsPass = v => { needsPass = v; };

export function authFetch(url, opts) {
  const o = Object.assign({}, opts);
  o.headers = Object.assign({}, o.headers);
  if (passphrase) o.headers['x-macro-pass'] = passphrase;
  return fetch(url, o);
}

// A rejected passphrase is worth forgetting: it is either wrong or has been
// changed on the server, and either way the device has to ask again.
export async function forgetPass() {
  passphrase = '';
  await clearPass();
}

export function showGate(msg) {
  const gate = $('gate');
  if (!gate) return;
  gate.hidden = false;
  const m = $('gateMsg');
  m.hidden = !msg;
  if (msg) m.textContent = msg;
  setTimeout(() => $('gatePass').focus(), 50);
}

// Resolves only once the server has accepted a passphrase, so the caller can
// treat everything after it as authorised.
export function askForPass() {
  return new Promise(resolve => {
    const input = $('gatePass');
    const go = $('gateGo');
    showGate();

    const attempt = async () => {
      const typed = input.value.trim();
      if (!typed || go.disabled) return;
      go.disabled = true;
      go.textContent = 'Checking…';
      passphrase = typed;

      // A free host stops the instance when idle and takes the better part of a
      // minute to start it again. Without saying so, that wait is indomitable
      // from a rejected passphrase — same frozen button either way.
      const waking = setTimeout(() => {
        showGate('Waking the server. On the free plan this can take up to a minute.');
      }, 3000);

      // And it has to end somewhere, or the button stays stuck for good.
      const stop = new AbortController();
      const giveUp = setTimeout(() => stop.abort(), 90000);

      let accepted = false, note = 'That passphrase was not accepted.';
      try {
        const res = await authFetch('/api/health', { cache: 'no-store', signal: stop.signal });
        if (res.status === 429) note = 'Too many tries. Wait a minute, then try again.';
        const info = res.ok ? await res.json() : null;
        accepted = Boolean(info && info.authed);
      } catch (e) {
        note = stop.signal.aborted
          ? 'The server did not answer in time. If it is a free host it may still be starting — try again in a moment.'
          : 'Could not reach the server.';
      }

      clearTimeout(waking);
      clearTimeout(giveUp);
      go.disabled = false;
      go.textContent = 'Open';

      if (!accepted) {
        passphrase = '';
        input.value = '';
        showGate(note);
        return;
      }

      await writePass(passphrase);
      input.value = '';
      $('gate').hidden = true;
      resolve();
    };

    go.addEventListener('click', attempt);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); attempt(); } });
  });
}
