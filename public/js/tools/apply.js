/* What the three tools actually do to the log.
 *
 * Each returns { changed, receipts, result }: `receipts` are the short lines
 * shown in the transcript, `result` is what goes back to the model. */

import { r0, r1, clamp0 } from '../lib/numbers.js';
import { MEALS } from '../config/nutrition.js';
import { uid, day } from '../state/log.js';
import { editingId, setEditingId } from '../state/session.js';
import { defaultMeal, totalsLine } from './context.js';
import { removalWasAsked } from './intent.js';

function applyLogItems(input) {
  const raw = (input && input.items) || [];
  const added = raw.map(it => ({
    id: uid(),
    name: String(it.name || 'Item').slice(0, 120),
    meal: MEALS.includes(it.meal) ? it.meal : defaultMeal(),
    cal: clamp0(r0(it.calories)),
    // Complete-protein rule enforced here, whatever the model returned.
    p: it.protein_source === 'complete' ? clamp0(r1(it.protein)) : 0,
    f: clamp0(r1(it.fat)),
    c: clamp0(r1(it.carbs)),
    // Micros count from every food, plant included — no source rule here.
    zn: clamp0(r1(it.zinc)),
    fe: clamp0(r1(it.iron)),
    mg: clamp0(r0(it.magnesium)),
    vc: clamp0(r1(it.vitamin_c))
  }));

  if (!added.length) return { changed: false, receipts: [], result: 'No items were provided, so nothing was logged.' };

  for (const it of added) day().items.push(it);
  const zeroed = added.filter(a => a.p === 0).map(a => a.name);

  return {
    changed: true,
    receipts: added.map(a => `+ ${a.name} → ${a.meal}`),
    result: [
      `Logged ${added.length} item(s): ${added.map(a => `${a.name} (${a.meal})`).join(', ')}.`,
      zeroed.length ? `Protein set to 0 for: ${zeroed.join(', ')} (not complete sources).` : '',
      totalsLine()
    ].filter(Boolean).join(' ')
  };
}

function applyEditItems(input) {
  const edits = (input && input.edits) || [];
  const receipts = [], missing = [], untouched = [];

  for (const e of edits) {
    const it = day().items.find(x => x.id === e.id);
    if (!it) { missing.push(e.id); continue; }
    const before = `${it.name} (${it.cal} kcal)`;
    const was = JSON.stringify(it);

    if (typeof e.name === 'string' && e.name.trim()) it.name = e.name.trim().slice(0, 120);
    if (e.calories !== undefined) it.cal = clamp0(r0(e.calories));
    if (e.fat !== undefined) it.f = clamp0(r1(e.fat));
    if (e.carbs !== undefined) it.c = clamp0(r1(e.carbs));
    if (e.zinc !== undefined) it.zn = clamp0(r1(e.zinc));
    if (e.iron !== undefined) it.fe = clamp0(r1(e.iron));
    if (e.magnesium !== undefined) it.mg = clamp0(r0(e.magnesium));
    if (e.vitamin_c !== undefined) it.vc = clamp0(r1(e.vitamin_c));
    if (MEALS.includes(e.meal)) it.meal = e.meal;
    // Complete-protein rule again: protein can only become non-zero when the
    // model explicitly declares the source complete.
    if (e.protein !== undefined) {
      it.p = e.protein_source === 'complete' ? clamp0(r1(e.protein)) : 0;
    }

    // An edit that sets every field to what it already held changed nothing.
    // Reporting it as an update is how the assistant ends up describing a move
    // or a correction the user can plainly see did not happen.
    if (JSON.stringify(it) === was) { untouched.push(it.name); continue; }

    receipts.push(`~ ${before} → ${it.name} (${it.cal} kcal)`);
  }

  if (!receipts.length) {
    const why = [];
    if (missing.length) why.push(`No item found with id(s): ${missing.join(', ')}.`);
    if (untouched.length) why.push(`The values sent for ${untouched.join(', ')} are identical to what is already logged.`);
    if (!why.length) why.push('No edits were provided.');
    return { changed: false, receipts: [], result: why.join(' ') + ' NOTHING WAS CHANGED — do not tell the user otherwise.' };
  }
  return {
    changed: true, receipts,
    result: `Updated ${receipts.length} item(s).` +
            (untouched.length ? ` Already exactly that, so left alone: ${untouched.join(', ')}.` : '') +
            (missing.length ? ` Not found: ${missing.join(', ')}.` : '') + ' ' + totalsLine()
  };
}

function applyDeleteItems(input) {
  const ids = (input && input.ids) || [];
  const receipts = [], missing = [];

  // Checked before anything is removed: if the user's message asks for no
  // removal, this is the assistant misreading a reply about what they have or
  // want. Refusing costs a clarifying question; being wrong costs their day.
  const targets = ids.map(id => {
    const it = day().items.find(x => x.id === id);
    return it ? it.name : '';
  }).filter(Boolean);

  if (targets.length && !removalWasAsked(targets)) {
    return {
      changed: false, receipts: [],
      result: 'REFUSED — nothing was deleted. The user\'s message does not ask for anything to be ' +
              'removed; it reads as a reply about what they have or want, not an instruction. ' +
              'Do not retry this call. Answer them in words, or ask one short question if you ' +
              'genuinely think they meant to remove something.'
    };
  }

  for (const id of ids) {
    const idx = day().items.findIndex(x => x.id === id);
    if (idx === -1) { missing.push(id); continue; }
    const [gone] = day().items.splice(idx, 1);
    if (editingId === gone.id) setEditingId(null);
    receipts.push(`− ${gone.name}`);
  }

  if (!receipts.length) {
    return { changed: false, receipts: [], result: missing.length
      ? `No item found with id(s): ${missing.join(', ')}. Nothing was deleted.`
      : 'No ids were provided.' };
  }
  return {
    changed: true, receipts,
    result: `Deleted ${receipts.length} item(s).` +
            (missing.length ? ` Not found: ${missing.join(', ')}.` : '') + ' ' + totalsLine()
  };
}

// The name the model calls, mapped to the function that runs it.
export const TOOL_IMPL = {
  log_items: applyLogItems,
  edit_items: applyEditItems,
  delete_items: applyDeleteItems
};
