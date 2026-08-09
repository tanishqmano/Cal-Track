/* What is true of this tab right now, and is deliberately not saved:
 * whether a request is in flight, which row is open for editing, and the undo
 * history. */

// A request is in flight. Blocks a second send, shows the typing dots, and
// keeps the sync loop from rearranging the page mid-turn.
export let busy = false;
export const setBusy = v => { busy = v; };

// The id of the item whose row is showing its edit form, or null.
export let editingId = null;
export const setEditingId = v => { editingId = v; };

/* ---- undo history ----
 *
 * A stack of { dayId, items } taken before each change, most recent last, so
 * Undo can be pressed repeatedly to walk back through a day. Every entry is a
 * deep copy of one day's items — small enough that depth costs nothing.
 *
 * Session-only, on purpose. A history that survived a reload would describe a
 * log that another device may have replaced in the meantime, and restoring it
 * would silently undo their entries too. For the same reason sync.js clears it
 * whenever the server hands us a different copy. */

const undoStack = [];
const UNDO_LIMIT = 20;

export const snapshotOf = d => ({ dayId: d.id, items: JSON.parse(JSON.stringify(d.items)) });

export function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

// Entries from different days interleave, so take the newest one for this day
// rather than whatever happens to be on top.
export function popUndoFor(dayId) {
  for (let i = undoStack.length - 1; i >= 0; i--) {
    if (undoStack[i].dayId === dayId) return undoStack.splice(i, 1)[0];
  }
  return null;
}

export function undoDepthFor(dayId) {
  let n = 0;
  for (const e of undoStack) if (e.dayId === dayId) n++;
  return n;
}

// The day is gone, so its snapshots can never be restored into anything.
export function dropUndoFor(dayId) {
  for (let i = undoStack.length - 1; i >= 0; i--) {
    if (undoStack[i].dayId === dayId) undoStack.splice(i, 1);
  }
}

export function clearUndo() {
  undoStack.length = 0;
}
