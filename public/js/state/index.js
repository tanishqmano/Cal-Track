/* The two calls the rest of the app makes: load() once at boot, save() after
 * every change. Kept here rather than in log.js or sync.js because each one
 * needs both. */

import { setState, normalizeState, freshState, state } from './log.js';
import { readAll } from './cache.js';
import { setSyncMark, markDirty, saveLocal, schedulePush, syncMode } from './sync.js';
import { setApiKey } from '../api/config.js';
import { setPassphrase } from '../api/access.js';

export function save() {
  if (syncMode) markDirty();
  saveLocal();
  schedulePush();
}

export async function load() {
  const { state: raw, key, sync, pass } = await readAll();

  setApiKey(key || '');
  setPassphrase(pass || '');

  try {
    const parsed = raw ? JSON.parse(raw) : null;
    setState((parsed && Array.isArray(parsed.days) && parsed.days.length) ? parsed : freshState());
  } catch (e) {
    setState(freshState());
  }

  // Which server revision this cache was in step with, and whether it holds
  // edits the server has not accepted yet (logged while the server was off).
  let synced = false;
  try {
    const s = sync ? JSON.parse(sync) : null;
    if (s && typeof s.rev === 'number') { setSyncMark(s.rev, Boolean(s.dirty)); synced = true; }
  } catch (e) { /* first run */ }

  normalizeState();

  // A log written before this device ever synced is unpublished work, not a
  // stale copy: mark it dirty so the first exchange merges it upward instead of
  // adopting the server's copy over the top of it.
  if (!synced && state.days.some(d => d.items.length || d.chat.length)) markDirty();
}
