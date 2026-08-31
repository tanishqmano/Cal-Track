/* Sending a message: the tool-use loop, and the Undo snapshot around it. */

import { $ } from '../lib/dom.js';
import { day } from '../state/log.js';
import { save } from '../state/index.js';
import { busy, setBusy, setEditingId, pushUndo, snapshotOf } from '../state/session.js';
import { serverMode, apiKey } from '../api/config.js';
import { callApi } from '../api/client.js';
import { normalize, pushToolTurn } from '../api/adapter.js';
import { TOOL_IMPL } from '../tools/apply.js';
import { stateBlock, totalsLine } from '../tools/context.js';
import { parseCards, mealIn, restNeedsModel, logCards, asksAQuestion, describeCards } from '../tools/paste.js';
import { render, renderTotals, renderList, renderChat } from '../ui/render.js';
import { showMsg } from '../ui/chat.js';

// History is stored as plain {role, text} for display and replay. Tool
// round-trips happen inside one send and are not persisted — the model gets
// the current log via stateBlock() instead, so it never works from a stale
// snapshot of what was logged.
//
// `ask` replaces the text of the final user turn. When rows were pasted, the
// model is asked about what was left over after they were taken out, so the
// column of digits never reaches it at all.
function buildMessages(ask) {
  // 'did' entries are display-only receipts — never sent, they aren't valid roles.
  // 8 is deliberate. stateBlock() already carries the whole current log, so
  // history is only needed to resolve "the other one" style references across
  // a couple of turns. Sending more just re-pays for facts already in state.
  const msgs = day().chat
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-8)
    .map(m => ({ role: m.role, content: m.text }));

  // An earlier turn's pasted rows are still a column of digits sitting in
  // history. Say what they were in words instead, so a later turn is not read
  // against numbers with nothing attached to them.
  for (let i = 0; i < msgs.length - 1; i++) {
    if (msgs[i].role !== 'user') continue;
    const past = parseCards(msgs[i].content);
    if (!past.items.length) continue;
    msgs[i].content = (past.rest + '\n' + describeCards(past.items).map(s => '- ' + s).join('\n')).trim();
  }

  const last = msgs[msgs.length - 1];
  if (last && last.role === 'user') last.content = stateBlock() + '\n\n' + (ask || last.content);
  return msgs;
}

// Named so the model cannot read the pasted rows as still outstanding and log
// them a second time — or delete them to "replace" what it thinks is missing.
function handledNote(added) {
  return `<already_logged>\nThese items from the user's message were logged directly, ` +
    `exactly as they pasted them. They are already in <current_log>. Do not log them again, ` +
    `and do not remove anything on their account:\n` +
    added.map(a => `- ${a.name} (${a.meal})`).join('\n') +
    `\n</already_logged>\n\nWhat is left of their message:\n`;
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
    // Rows pasted back off the list carry every number already. Read them here
    // and the model is never shown a bare column of digits it cannot identify —
    // which is what used to come back as nameless items worth 0 kcal.
    const cards = parseCards(text);
    let ask = null;

    if (cards.items.length && asksAQuestion(cards.rest)) {
      // Pointing at a row to ask about it. Nothing is logged; the model just
      // gets the numbers in a form it can read.
      ask = cards.rest + '\n\nThe rows they pasted, with their numbers:\n' +
            describeCards(cards.items).map(s => '- ' + s).join('\n');
    } else if (cards.items.length) {
      undoSnap = snapshotOf(day());
      const out = logCards(cards.items, mealIn(text));
      day().chat.push({ role: 'did', text: out.receipts.join('\n') });
      touched = true;
      save();
      renderTotals(); renderList(); renderChat();

      // Nothing left but "add this for dinner": the turn is already done, and
      // asking the model would only spend a request to restate our own totals.
      if (!restNeedsModel(cards.rest)) {
        const n = out.added.length;
        day().chat.push({ role: 'assistant', text:
          `Logged ${n} pasted item${n === 1 ? '' : 's'} for ${out.added[0].meal}, ` +
          `exactly as given. ${totalsLine()}` });
        return;
      }
      ask = handledNote(out.added) + cards.rest;
    }

    const msgs = buildMessages(ask);

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
