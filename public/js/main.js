/* Boot.
 *
 * Everything above this file is a module that does one thing. This one puts
 * them in order: load the cache, ask the server what it is, get past the gate,
 * adopt the shared log, draw, then wire the buttons.
 *
 *   lib/      no dependencies of their own — storage, DOM, arithmetic
 *   config/   constants, the prompt, the tool schemas
 *   state/    the log, the device cache, and sync with the server
 *   api/      talking to the model, and the passphrase in front of it
 *   tools/    what the model's tool calls do to the log
 *   ui/       drawing; no module here changes the log
 *   actions/  what a button does — the only place the two meet
 */

import './lib/storage.js';
import { $ } from './lib/dom.js';
import { load } from './state/index.js';
import { pullState, pushState, startSyncLoop, dirty } from './state/sync.js';
import { detectServer } from './api/health.js';
import { serverMode, setServerMode, providerName, MODEL, apiKey, KEY_HINT } from './api/config.js';
import { needsPass, forgetPass, askForPass } from './api/access.js';
import { render } from './ui/render.js';
import { send } from './actions/send.js';
import { selectDay, addDay, deleteDay } from './actions/days.js';
import { onListClick, doUndo } from './actions/items.js';
import { saveTargets, restoreDefaultTargets, saveTimezone, saveApiKey, resetAll } from './actions/settings.js';

// Describes where the key and the log are coming from, once both are known.
function describeSetup(synced) {
  if (serverMode) {
    $('keyRow').hidden = true;
    $('keyNote').hidden = false;
    $('keyNote').textContent =
      `Using ${providerName} · ${MODEL}. The key comes from .env via server.js and stays on that machine. ` +
      'Change AI_PROVIDER in .env and restart to switch backends.';
  } else {
    $('key').value = apiKey;
    $('key').placeholder = KEY_HINT[providerName] || 'API key';
  }

  if (synced) {
    const note = $('keyNote');
    note.textContent = (note.hidden ? '' : note.textContent + ' ') +
      'Your log is kept by server.js, so every device on this Wi-Fi sees the same days.';
    note.hidden = false;
  }
}

function wire() {
  $('daySel').addEventListener('change', e => selectDay(e.target.value));
  $('newDay').addEventListener('click', addDay);
  $('delDay').addEventListener('click', deleteDay);

  $('saveTargets').addEventListener('click', saveTargets);
  $('defTargets').addEventListener('click', restoreDefaultTargets);
  $('tzSel').addEventListener('change', saveTimezone);
  $('saveKey').addEventListener('click', saveApiKey);
  $('reset').addEventListener('click', resetAll);

  $('send').addEventListener('click', send);
  $('undoBtn').addEventListener('click', doUndo);
  $('list').addEventListener('click', onListClick);

  const say = $('say');
  say.addEventListener('keydown', e => {
    // Enter sends, Shift+Enter makes a newline.
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  say.addEventListener('input', () => {
    say.style.height = 'auto';
    say.style.height = Math.min(say.scrollHeight, 130) + 'px';
  });
}

(async function init() {
  await load();
  setServerMode(await detectServer());

  // A hosted copy is passphrase-locked. Nothing else runs until it is answered:
  // the log has not been fetched yet, so there is nothing to show behind it.
  if (needsPass) {
    await forgetPass();
    await askForPass();
    setServerMode(await detectServer());
  }

  // Adopt the shared log before the first paint, so a device that has never
  // seen this data does not flash an empty day at you.
  const sync = await pullState();
  if (sync.ok) {
    if (dirty) pushState();
    startSyncLoop();
  }

  describeSetup(sync.ok);
  render();
  wire();
})();
