/* Sync — the log lives on server.js, so every device sees it.
 *
 * IndexedDB is a cache: it renders instantly and keeps the page usable when the
 * server is off. server.js holds the copy of record, stamped with a revision
 * number, which is what keeps the phone and the laptop showing the same log. */

import { state, setState, normalizeState } from './log.js';
import { setEditingId, editingId, busy, clearUndo } from './session.js';
import { writeLog } from './cache.js';
import { authFetch, forgetPass, setNeedsPass, showGate } from '../api/access.js';
import { render } from '../ui/render.js';
import { showMsg } from '../ui/chat.js';

export let syncMode = false;   // server answered /api/state
export let rev = 0;            // newest server revision this device has seen
export let dirty = false;      // local edits the server has not accepted yet

let pushing = false;
let pushAgain = false;
let pushTimer = null;
let syncWarned = false;

export const markDirty = () => { dirty = true; };
export const setSyncMark = (r, d) => { rev = r; dirty = d; };

export function saveLocal() {
  return writeLog(state, { rev, dirty });
}

// Union of both sides, matched by id. Only used when a device edited while it
// could not reach the server: losing a logged meal is worse than an item
// deleted on one device reappearing, so nothing is dropped here.
export function mergeState(mine, theirs) {
  if (!theirs || !Array.isArray(theirs.days)) return mine;
  const remote = new Map(theirs.days.map(d => [d.id, d]));
  const days = [];

  for (const a of mine.days) {
    const b = remote.get(a.id);
    if (!b) { days.push(a); continue; }
    remote.delete(a.id);
    const items = b.items.slice();
    const have = new Set(items.map(i => i.id));
    for (const it of a.items) if (!have.has(it.id)) items.push(it);
    // Chat is append-only, so the longer transcript is the newer one.
    days.push({ id: a.id, label: a.label, items, chat: a.chat.length >= b.chat.length ? a.chat : b.chat });
  }
  for (const b of remote.values()) days.push(b);

  // Targets are one small object, not a list, so there is nothing to fold
  // together field by field: whichever side set them last wins outright. The
  // timezone is settled the same way but on its own stamp, so changing the
  // zone on the phone cannot drag stale targets along with it.
  const newer = (Number(theirs.targetsAt) || 0) > (Number(mine.targetsAt) || 0) ? theirs : mine;
  const newerTz = (Number(theirs.tzAt) || 0) > (Number(mine.tzAt) || 0) ? theirs : mine;

  // Every field the log carries has to be named here. This rebuilds the state
  // object rather than spreading it, so anything left out is dropped on the
  // next merge — silently, and only on the devices that went offline.
  return {
    v: 1,
    active: mine.active,
    targets: newer.targets,
    targetsAt: newer.targetsAt || 0,
    tz: newerTz.tz || '',
    tzAt: newerTz.tzAt || 0,
    days
  };
}

// Returns { ok, changed } — ok false simply means the page is running without a
// server (opened as a file, or the Mac is asleep), which is not an error.
export async function pullState() {
  let doc;
  try {
    const res = await authFetch('/api/state', { cache: 'no-store' });
    if (res.status === 401) { await forgetPass(); setNeedsPass(true); return { ok: false, changed: false }; }
    if (!res.ok) return { ok: false, changed: false };
    doc = await res.json();
  } catch (e) {
    return { ok: false, changed: false };
  }
  if (!doc || typeof doc.rev !== 'number') return { ok: false, changed: false };
  syncMode = true;

  // Server has no log yet: this device's copy becomes the starting point.
  if (doc.rev === 0 || !doc.state) {
    if (state.days.some(d => d.items.length || d.chat.length)) dirty = true;
    return { ok: true, changed: false };
  }

  // Same revision means the server holds our base — nothing to take from it.
  if (doc.rev === rev) return { ok: true, changed: false };

  setState(dirty ? mergeState(state, doc.state) : doc.state);
  rev = doc.rev;
  normalizeState();
  setEditingId(null);
  // The log on screen is no longer the one those snapshots were taken from.
  // Restoring one now would undo whatever the other device just logged.
  clearUndo();
  await saveLocal();
  return { ok: true, changed: true };
}

export function schedulePush() {
  if (!syncMode) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushState, 400);
}

export async function pushState(opts) {
  if (!syncMode) return;
  if (pushing) { pushAgain = true; return; }
  const force = Boolean(opts && opts.force);
  const tries = (opts && opts.tries) || 0;

  pushing = true;
  try {
    const res = await authFetch('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rev, state, force })
    });

    if (res.status === 401) {
      await forgetPass();
      setNeedsPass(true);
      showGate('Passphrase no longer accepted. Enter it again to keep syncing.');
      return;
    }

    // Another device wrote first: fold its entries in and try again.
    if (res.status === 409) {
      const doc = await res.json();
      setState(mergeState(state, doc.state));
      rev = doc.rev;
      normalizeState();
      clearUndo();   // same reason as in pullState
      await saveLocal();
      render();
      pushing = false;
      if (tries < 3) return pushState({ tries: tries + 1 });
      return;
    }

    if (!res.ok) throw new Error('HTTP ' + res.status);

    const out = await res.json();
    rev = out.rev;
    dirty = false;
    syncWarned = false;
    await saveLocal();
  } catch (e) {
    // Server off or unreachable. The edit is safe in IndexedDB and goes up on
    // the next save or sync tick, so this only needs saying once.
    if (!syncWarned) {
      syncWarned = true;
      showMsg('Server unreachable — saved on this device only, will sync when it is back.');
    }
  } finally {
    pushing = false;
    if (pushAgain) { pushAgain = false; schedulePush(); }
  }
}

// Picks up what other devices logged. Only while the tab is visible, and never
// mid-request or mid-edit, so the page never rearranges under your hands.
// `busy` and `editingId` are imported bindings, so each tick reads whatever
// session.js holds at that moment rather than a value captured on load.
export function startSyncLoop() {
  const tick = () => {
    if (document.visibilityState !== 'visible' || busy || pushing) return;
    if (dirty) { pushState(); return; }
    if (editingId) return;
    pullState().then(r => { if (r.changed) render(); });
  };
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('focus', tick);
  setInterval(tick, 15000);
}
