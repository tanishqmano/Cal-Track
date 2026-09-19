/* The Settings drawer: targets, the direct-mode API key, and the reset. */

import { $ } from '../lib/dom.js';
import { r0, r1 } from '../lib/numbers.js';
import { DEFAULT_TARGETS, TARGET_FIELDS } from '../config/nutrition.js';
import { state, setState, freshState, normalizeState, TARGETS } from '../state/log.js';
import { save } from '../state/index.js';
import { saveLocal, pushState, markDirty } from '../state/sync.js';
import { setEditingId, clearUndo } from '../state/session.js';
import { setApiKey } from '../api/config.js';
import { writeApiKey } from '../state/cache.js';
import { render } from '../ui/render.js';
import { showMsg } from '../ui/chat.js';

export function saveTargets() {
  const next = {}, kept = [];
  for (const f of TARGET_FIELDS) {
    const v = Number($('t_' + f.k).value);
    // A target of zero would divide by zero in the bars and tell the model the
    // user needs nothing. Refuse it and say which box was ignored.
    if (!Number.isFinite(v) || v <= 0) { next[f.k] = TARGETS[f.k]; kept.push(f.name); continue; }
    next[f.k] = f.dec ? r1(v) : r0(v);
  }
  state.targets = next;
  state.targetsAt = Date.now();
  normalizeState();
  save(); render();
  $('tgtNote').textContent = kept.length
    ? `Saved. ${kept.join(', ')} must be greater than zero, so the previous value was kept.`
    : 'Saved. Every device and the assistant now use these.';
}

export function restoreDefaultTargets() {
  state.targets = Object.assign({}, DEFAULT_TARGETS);
  state.targetsAt = Date.now();
  normalizeState();
  save(); render();
  $('tgtNote').textContent = 'Back to the US RDA defaults.';
}

/* Saved on change rather than behind a button: it is one dropdown, and a zone
 * left unsaved would quietly keep filing meals under the old one. */
export function saveTimezone() {
  const tz = $('tzSel').value || '';
  state.tz = tz;
  state.tzAt = Date.now();
  normalizeState();
  save(); render();
  $('tzNote').textContent = tz
    ? 'Saved. The app and the Claude connector both use this now.'
    : "Saved. Each device uses its own clock; the Claude connector falls back to the server's setting.";
}

export async function saveApiKey() {
  const key = $('key').value.trim();
  setApiKey(key);
  await writeApiKey(key);
  showMsg(key ? 'Key saved.' : 'Key cleared.', true);
}

export async function resetAll() {
  if (!confirm('Delete every logged day, on every device? Your targets and API key are kept.')) return;
  setState(freshState());
  // Rebinds TARGETS onto the new state object — without it, later target edits
  // would be written into the log that was just thrown away.
  normalizeState();
  setEditingId(null);
  // Every day the history pointed at has just been thrown away.
  clearUndo();
  markDirty();
  await saveLocal();
  // Forced: wiping is the point here, so a revision mismatch must not merge
  // the old days back in.
  await pushState({ force: true });
  showMsg('');
  render();
}
