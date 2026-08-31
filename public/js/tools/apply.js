/* What the three tools actually do to the log.
 *
 * Each returns { changed, receipts, result }: `receipts` are the short lines
 * shown in the transcript, `result` is what goes back to the model. */

import { r0, r1, clamp0 } from '../lib/numbers.js';
import { MEALS } from '../config/nutrition.js';
import { uid, day } from '../state/log.js';
import { editingId, setEditingId } from '../state/session.js';
import { defaultMeal, totalsLine } from './context.js';
import { removalRefusal } from './intent.js';

/* Reading what the model actually sent.
 *
 * A small model answers with the right shape most of the time and something
 * near it the rest: `kcal` for `calories`, a number as a string, occasionally a
 * bare string where an object belongs. The near misses are worth repairing.
 *
 * What is not worth accepting is an item with no name or no calories. That used
 * to be coerced into a row reading "Item · 0 kcal", which is worse than no row
 * at all — it looks to the user like the food went in, and the totals quietly
 * disagree with the list. Those are refused, and the tool result says exactly
 * what was wrong so the next hop can send it again properly. */
const ALIAS = {
  calories: ['calories', 'calorie', 'kcal', 'cals', 'cal', 'energy'],
  protein: ['protein', 'protein_g', 'prot'],
  fat: ['fat', 'fat_g'],
  carbs: ['carbs', 'carbohydrate', 'carbohydrates', 'carb', 'carbs_g'],
  zinc: ['zinc', 'zn'],
  iron: ['iron', 'fe'],
  magnesium: ['magnesium', 'magnesium_mg', 'mg'],
  vitamin_c: ['vitamin_c', 'vitaminc', 'vit_c', 'vitc', 'vc']
};
const NAME_KEYS = ['name', 'food', 'item', 'label', 'title', 'description'];

// "364", 364 and "364 kcal" all mean the same thing. Anything else means none.
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /-?\d+(?:\.\d+)?/.exec(v);
  return m ? Number(m[0]) : null;
}

function field(o, key) {
  for (const k of ALIAS[key]) {
    if (o[k] === undefined || o[k] === null) continue;
    const n = num(o[k]);
    if (n !== null) return n;
  }
  return null;
}

function readItem(raw, fallbackMeal) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { bad: `one entry was ${Array.isArray(raw) ? 'an array' : typeof raw}, not an object` };
  }

  let name = '';
  for (const k of NAME_KEYS) {
    if (typeof raw[k] === 'string' && raw[k].trim()) { name = raw[k].trim().slice(0, 120); break; }
  }
  if (!name) return { bad: 'one entry had no "name"' };

  // Zero calories is a real answer (water, black coffee). A missing one is not.
  const cal = field(raw, 'calories');
  if (cal === null) return { bad: `"${name}" had no "calories" number` };

  const protein = field(raw, 'protein');
  return {
    item: {
      id: uid(),
      name,
      meal: MEALS.includes(raw.meal) ? raw.meal : fallbackMeal,
      cal: clamp0(r0(cal)),
      // Complete-protein rule enforced here, whatever the model returned.
      p: raw.protein_source === 'complete' ? clamp0(r1(protein)) : 0,
      f: clamp0(r1(field(raw, 'fat'))),
      c: clamp0(r1(field(raw, 'carbs'))),
      // Micros count from every food, plant included — no source rule here.
      zn: clamp0(r1(field(raw, 'zinc'))),
      fe: clamp0(r1(field(raw, 'iron'))),
      mg: clamp0(r0(field(raw, 'magnesium'))),
      vc: clamp0(r1(field(raw, 'vitamin_c')))
    }
  };
}

// `items` should be an array. Accept a lone object, and an item sent flat at
// the top level, rather than dropping a call that is only shaped slightly wrong.
function itemList(input) {
  if (!input || typeof input !== 'object') return [];
  if (Array.isArray(input.items)) return input.items;
  if (input.items && typeof input.items === 'object') return [input.items];
  if (Array.isArray(input)) return input;
  if (NAME_KEYS.some(k => typeof input[k] === 'string')) return [input];
  return [];
}

const RESEND = 'Each item needs a "name" string and a "calories" number, alongside ' +
  'protein, protein_source, fat, carbs, zinc, iron, magnesium, vitamin_c and meal. ' +
  'Send log_items again with a complete object per item.';

function applyLogItems(input) {
  const fallbackMeal = defaultMeal();
  const added = [], bad = [];

  for (const raw of itemList(input)) {
    const read = readItem(raw, fallbackMeal);
    if (read.bad) bad.push(read.bad); else added.push(read.item);
  }

  if (!added.length) {
    return { changed: false, receipts: [], result: bad.length
      ? `NOTHING WAS LOGGED — the tool input was malformed: ${bad.join('; ')}. ${RESEND} ` +
        'Do not tell the user anything was logged.'
      : 'No items were provided, so nothing was logged.' };
  }

  for (const it of added) day().items.push(it);
  const zeroed = added.filter(a => a.p === 0).map(a => a.name);

  return {
    changed: true,
    receipts: added.map(a => `+ ${a.name} → ${a.meal}`),
    result: [
      `Logged ${added.length} item(s): ${added.map(a => `${a.name} (${a.meal})`).join(', ')}.`,
      zeroed.length ? `Protein set to 0 for: ${zeroed.join(', ')} (not complete sources).` : '',
      bad.length ? `NOT logged, malformed: ${bad.join('; ')}. ${RESEND}` : '',
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

  const refusal = targets.length ? removalRefusal(targets) : '';
  if (refusal) return { changed: false, receipts: [], result: refusal };

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
