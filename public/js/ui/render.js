/* Redraw everything. Cheap enough at this size that no part of the app has to
 * think about which pieces its change affected. */

import { $ } from '../lib/dom.js';
import { state } from '../state/log.js';
import { renderTotals } from './totals.js';
import { renderList } from './list.js';
import { renderChat, renderUndo } from './chat.js';
import { renderTargets } from './targets.js';
import { renderTimezone } from './timezone.js';

function renderDays() {
  const sel = $('daySel');
  sel.innerHTML = state.days.map((d, i) =>
    `<option value="${i}"${i === state.active ? ' selected' : ''}>${d.label}</option>`).join('');
}

export function render() {
  renderDays();
  renderTotals();
  renderList();
  renderChat();
  renderUndo();
  renderTargets();
  renderTimezone();
}

export { renderTotals, renderList, renderChat, renderUndo, renderTargets, renderTimezone };
