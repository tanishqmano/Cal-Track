/* Sending a message: the tool-use loop, and the Undo snapshot around it. */

import { $ } from '../lib/dom.js';
import { day } from '../state/log.js';
import { save } from '../state/index.js';
import { busy, setBusy, setEditingId, pushUndo, snapshotOf } from '../state/session.js';
import { serverMode, apiKey } from '../api/config.js';
import { callApi } from '../api/client.js';
import { normalize, pushToolTurn } from '../api/adapter.js';
import { TOOL_IMPL } from '../tools/apply.js';
import { stateBlock } from '../tools/context.js';
import { render, renderTotals, renderList, renderChat } from '../ui/render.js';
import { showMsg } from '../ui/chat.js';

// History is stored as plain {role, text} for display and replay. Tool
// round-trips happen inside one send and are not persisted — the model gets
// the current log via stateBlock() instead, so it never works from a stale
// snapshot of what was logged.
function buildMessages() {
  // 'did' entries are display-only receipts — never sent, they aren't valid roles.
  // 8 is deliberate. stateBlock() already carries the whole current log, so
  // history is only needed to resolve "the other one" style references across
  // a couple of turns. Sending more just re-pays for facts already in state.
  const msgs = day().chat
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-8)
    .map(m => ({ role: m.role, content: m.text }));
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'user') last.content = stateBlock() + '\n\n' + last.content;
  return msgs;
}

export async function send() {
  if (busy) return;
  const text = $('say').value.trim();
  if (!text) return;
  if (!serverMode && !apiKey) { showMsg('Add your API key under Settings first.'); return; }

  day().chat.push({ role: 'user', text });
  $('say').value = '';
  $('say').style.height = 'auto';
  showMsg('');
  setBusy(true);
  save();
  renderChat();

  // Both are local to this turn: `send` refuses to start a second one while
  // busy, so there is never more than one in flight to confuse them.
  let undoSnap = null;   // taken before the first mutation, promoted on success
  let touched = false;   // did this turn modify the log?

  try {
    const msgs = buildMessages();

    // Tool-use loop: model may log, then speak. Two hops is enough for
    // log-then-confirm; the cap stops any runaway.
    for (let hop = 0; hop < 3; hop++) {
      const norm = normalize(await callApi(msgs));

      // Presence of tool calls drives the loop, not stop_reason — the two
      // formats spell that field differently and some models omit it.
      if (norm.calls.length) {
        const results = [];
        for (const call of norm.calls) {
          const run = TOOL_IMPL[call.name];
          if (!run) {
            results.push({ id: call.id, content: 'Unknown tool.', isError: true });
            continue;
          }
          // Snapshot before the first mutation of this turn, so Undo can restore it.
          if (!undoSnap) undoSnap = snapshotOf(day());
          const out = run(call.input);
          if (out.receipts.length) day().chat.push({ role: 'did', text: out.receipts.join('\n') });
          if (out.changed) touched = true;
          results.push({ id: call.id, content: out.result });
        }
        pushToolTurn(msgs, norm, results);
        save();
        renderTotals(); renderList(); renderChat();
        continue;
      }

      day().chat.push({ role: 'assistant', text: norm.text || 'Done.' });
      break;
    }
  } catch (e) {
    const m = String(e && e.message || e);
    showMsg(/Failed to fetch|NetworkError/i.test(m)
      ? 'Could not reach the API. Check your connection and that the key is valid.'
      : m);
  } finally {
    setBusy(false);
    // One entry per turn, however many tool calls it made — the user thinks in
    // messages, so that is what a press of Undo should step back over.
    if (touched && undoSnap) pushUndo(undoSnap);
    setEditingId(null);
    save();
    render();
    $('say').focus();
  }
}
