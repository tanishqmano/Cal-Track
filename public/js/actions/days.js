/* Switching, adding and deleting days. */

import { state, day, newDay, nextDayNum } from '../state/log.js';
import { save } from '../state/index.js';
import { setEditingId, dropUndoFor } from '../state/session.js';
import { render } from '../ui/render.js';
import { showMsg } from '../ui/chat.js';

export function selectDay(index) {
  state.active = Number(index);
  setEditingId(null);
  save(); render();
}

export function addDay() {
  state.days.push(newDay(nextDayNum()));
  state.active = state.days.length - 1;
  setEditingId(null);
  showMsg('');
  save(); render();
}

export function deleteDay() {
  const d = day();
  const what = d.items.length ? `${d.label} and the ${d.items.length} item(s) in it` : d.label;
  if (!confirm(`Delete ${what}? This removes it from every device.`)) return;

  const idx = state.active;
  state.days.splice(idx, 1);
  // A tracker with no days has nothing to draw, so deleting the last one leaves
  // an empty day standing rather than an empty page.
  if (!state.days.length) state.days.push(newDay(1));
  // Land on the day that took its place, or the new last one if it was the tail.
  state.active = Math.min(idx, state.days.length - 1);

  // Undo restores items into a day by id; that day is gone.
  dropUndoFor(d.id);
  setEditingId(null);
  showMsg('');
  save(); render();
}
