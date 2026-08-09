/* Editing a logged row by hand, and stepping back through the undo history. */

import { r0, r1, clamp0 } from '../lib/numbers.js';
import { day } from '../state/log.js';
import { save } from '../state/index.js';
import { editingId, setEditingId, pushUndo, popUndoFor, snapshotOf } from '../state/session.js';
import { render } from '../ui/render.js';
import { renderList } from '../ui/list.js';

// One listener on the list, so rows redrawn on every render never need
// re-wiring. Which button was pressed rides in data-act.
export function onListClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const row = btn.closest('.row');
  const id = row && row.dataset.id;
  if (!id) return;
  const act = btn.dataset.act;

  if (act === 'edit') { setEditingId(id); renderList(); return; }
  if (act === 'cancel') { setEditingId(null); renderList(); return; }

  if (act === 'del') {
    pushUndo(snapshotOf(day()));
    day().items = day().items.filter(i => i.id !== id);
    if (editingId === id) setEditingId(null);
    save(); render(); return;
  }

  if (act === 'save') {
    const it = day().items.find(i => i.id === id);
    if (!it) return;
    // Taken before the edit; kept only if the edit actually changed something,
    // so pressing Save on an untouched row does not add a step to the history.
    const snap = snapshotOf(day());
    const was = JSON.stringify(it);

    const get = k => row.querySelector(`[data-e="${k}"]`);
    it.name = (get('name').value.trim() || it.name).slice(0, 120);
    it.cal = clamp0(r0(get('cal').value));
    it.p = clamp0(r1(get('p').value));
    it.f = clamp0(r1(get('f').value));
    it.c = clamp0(r1(get('c').value));
    it.zn = clamp0(r1(get('zn').value));
    it.fe = clamp0(r1(get('fe').value));
    it.mg = clamp0(r0(get('mg').value));
    it.vc = clamp0(r1(get('vc').value));
    it.meal = get('meal').value;

    if (JSON.stringify(it) !== was) pushUndo(snap);
    setEditingId(null);
    save(); render();
  }
}

// Restores the day to just before its most recent change. Pressing it again
// steps back another change, up to the depth session.js keeps.
export function doUndo() {
  const entry = popUndoFor(day().id);
  if (!entry) return;
  day().items = entry.items;
  day().chat.push({ role: 'did', text: '↩ change undone' });
  setEditingId(null);
  save();
  render();
}
