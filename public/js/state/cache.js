/* The device's own copy, in IndexedDB.
 *
 * Pure storage: this module knows the key names and nothing about what the
 * values mean. It renders instantly on load and keeps the page usable when the
 * server is off — server.js holds the copy of record. */

import '../lib/storage.js';

const K_STATE = 'macroTracker.state';
const K_KEY   = 'macroTracker.apiKey';
const K_SYNC  = 'macroTracker.sync';
const K_PASS  = 'macroTracker.pass';

// A failed read is a first run or a wiped browser, never a reason to stop.
async function get(key) {
  try {
    return await window.storage.getItem(key);
  } catch (e) {
    console.warn(e);
    return null;
  }
}

export async function readAll() {
  return {
    state: await get(K_STATE),
    key: await get(K_KEY),
    sync: await get(K_SYNC),
    pass: await get(K_PASS)
  };
}

// The log and the marker saying which server revision it matches are written
// together — a state without its marker would look like unsynced work.
export function writeLog(state, mark) {
  return Promise.all([
    window.storage.setItem(K_STATE, JSON.stringify(state)),
    window.storage.setItem(K_SYNC, JSON.stringify(mark))
  ]).catch(e => console.warn('save failed', e));
}

export function writeApiKey(v) {
  return window.storage.setItem(K_KEY, v);
}

export function writePass(v) {
  return window.storage.setItem(K_PASS, v).catch(() => {});
}

export function clearPass() {
  return window.storage.removeItem(K_PASS).catch(() => {});
}
