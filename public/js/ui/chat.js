/* The transcript, the status line under it, and the undo bar. */

import { $, esc } from '../lib/dom.js';
import { day } from '../state/log.js';
import { busy, undoDepthFor } from '../state/session.js';

// Minimal markdown for replies: bullets and bold. Escaped first, so the
// model's output can never inject markup.
function fmt(text) {
  const lines = esc(text).split('\n');
  let out = '', inList = false;
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      if (!inList) { out += '<ul>'; inList = true; }
      out += '<li>' + bullet[1] + '</li>';
    } else {
      if (inList) { out += '</ul>'; inList = false; }
      out += line + '\n';
    }
  }
  if (inList) out += '</ul>';
  return out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').trim();
}

export function renderChat() {
  const el = $('transcript');
  const chat = day().chat;
  let html = chat.map(m => {
    const cls = m.role === 'user' ? 'you' : m.role === 'did' ? 'did' : 'ai';
    const inner = m.role === 'assistant' ? fmt(m.text) : esc(m.text);
    return `<div class="bub ${cls}">${inner}</div>`;
  }).join('');
  if (busy) html += '<div class="typing">…</div>';
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

// The bar only means anything on the day its snapshots were captured from.
// Naming the depth is the point: it tells you going further back is possible,
// which is what people ask the assistant for when they cannot see it.
export function renderUndo() {
  const depth = undoDepthFor(day().id);
  $('undobar').hidden = depth === 0;
  if (depth) {
    $('undoNote').textContent = depth === 1
      ? 'Your log was changed.'
      : `${depth} changes can be undone.`;
  }
}

export function showMsg(text, info) {
  const el = $('msg');
  if (!text) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.className = 'msg' + (info ? ' info' : '');
  el.textContent = text;
}
