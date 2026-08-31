/* Rows pasted back in from the app's own list.
 *
 * ui/list.js draws each item as a name, four numbers, a "Zn · Fe · Mg · C"
 * line, and the ✎ ✕ buttons. Selecting a row on screen and pasting it into the
 * box is the quickest way to repeat a food, and what arrives already carries
 * every number — there is nothing left to estimate.
 *
 * Asking the model anyway is where the damage came from. A bare column of
 * digits reads as nothing in particular: the reply came back as two nameless
 * items worth 0 kcal, on top of two deletes nobody asked for. So the shape is
 * matched here instead, before any request is made. When it matches, the
 * numbers are taken exactly as pasted, the model is never called, and no
 * quota is spent.
 *
 * The numbers are used verbatim on purpose, protein included. This shape is
 * printed by nothing but this app, so its protein figure has already had the
 * complete-protein rule applied to it once. Re-applying a rule we cannot
 * evaluate in code would corrupt an honest copy of a row. */

import { r0, r1, clamp0 } from '../lib/numbers.js';
import { MEALS } from '../config/nutrition.js';
import { uid, day } from '../state/log.js';
import { defaultMeal, totalsLine } from './context.js';

// The buttons at the end of a row. Copied text keeps them.
const GLYPH = /^[✎✕✏✖×xX]$/;

// One of the four numbers. The label only survives the copy on a narrow
// screen — from 520px up css hides it — so both "kcal 364" and "364" arrive.
// Longer alternatives first: alternation takes the first that matches.
const NUM_LINE = /^(?:kcal|calories|calorie|cals|cal|protein|prot|carbs|carb|fat|p|f|c)?\s*[:·|]?\s*(-?\d+(?:\.\d+)?)\s*(?:kcal|cal|g|gm|grams?)?$/i;

// The quieter second line under a row.
const MICRO_LINE = /^zn\s*(-?\d+(?:\.\d+)?).*?fe\s*(-?\d+(?:\.\d+)?).*?mg\s*(-?\d+(?:\.\d+)?).*?(?:vit\s*c|vitc|c)\s*(-?\d+(?:\.\d+)?)/i;

// A meal subtotal ("452 kcal · P 26 · F 12.2 · C 59") is not an item.
const MEAL_SUB = /\bkcal\b[^\n]*·/i;

function isNameLine(s) {
  if (!s || s.length > 120) return false;
  if (GLYPH.test(s)) return false;
  if (!/[a-z]/i.test(s)) return false;
  if (NUM_LINE.test(s)) return false;
  if (MICRO_LINE.test(s)) return false;
  if (MEAL_SUB.test(s)) return false;
  if (MEALS.some(m => m.toLowerCase() === s.toLowerCase())) return false;
  // "100 g Yogabar oats" and "1 scoop (30 g) whey" are names. A line carrying
  // more figures than that is a row of numbers wearing a label.
  return (s.match(/\d+(?:\.\d+)?/g) || []).length <= 2;
}

/* Try to read one row starting at `i`. Returns the item and the index just
 * past it, or null when the lines there are not a row. */
function rowAt(lines, i) {
  if (!isNameLine(lines[i])) return null;

  const nums = [];
  let j = i + 1;
  while (j < lines.length && nums.length < 4) {
    const m = NUM_LINE.exec(lines[j]);
    if (!m) break;
    nums.push(Number(m[1]));
    j++;
  }
  if (nums.length !== 4) return null;

  let micro = null;
  const mm = j < lines.length ? MICRO_LINE.exec(lines[j]) : null;
  if (mm) { micro = mm.slice(1, 5).map(Number); j++; }

  let glyphs = 0;
  while (j < lines.length && GLYPH.test(lines[j])) { glyphs++; j++; }

  // The signature. Four numbers under a word could be anything the user typed;
  // what makes this our own row is the mineral line or the buttons beside it.
  // Without one of the two, leave it to the model rather than guessing.
  if (!micro && !glyphs) return null;

  return {
    next: j,
    item: {
      name: lines[i],
      cal: clamp0(r0(nums[0])), p: clamp0(r1(nums[1])),
      f: clamp0(r1(nums[2])), c: clamp0(r1(nums[3])),
      zn: micro ? clamp0(r1(micro[0])) : 0, fe: micro ? clamp0(r1(micro[1])) : 0,
      mg: micro ? clamp0(r0(micro[2])) : 0, vc: micro ? clamp0(r1(micro[3])) : 0
    }
  };
}

/* Split a message into the rows it contains and whatever else it says.
 * `rest` is every line no row claimed, which is what the model still needs to
 * answer — "with 180 g of milk too" and the like. */
export function parseCards(text) {
  const lines = String(text || '').split('\n').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const items = [], claimed = new Set();

  for (let i = 0; i < lines.length;) {
    const hit = rowAt(lines, i);
    if (!hit) { i++; continue; }
    items.push(hit.item);
    for (let k = i; k < hit.next; k++) claimed.add(k);
    i = hit.next;
  }

  return { items, rest: lines.filter((_, k) => !claimed.has(k)).join(' ').trim() };
}

// The meal named anywhere in the message, or the clock's guess.
export function mealIn(text) {
  const s = String(text || '');
  for (const m of MEALS) if (new RegExp(`\\b${m}\\b`, 'i').test(s)) return m;
  return defaultMeal();
}

/* Everything a message can say around a pasted row that does not need the
 * model: which meal, and that it should go in. If nothing else is left after
 * these come out, the turn is finished without a request. */
const FILLER = /\b(add|adding|added|log|logged|put|include|track|this|these|those|them|it|also|too|and|for|to|in|on|of|my|the|a|an|as|please|pls|plz|ok|okay|thanks|today|now|breakfast|lunch|snack|dinner|had|have|ate|eat|eating)\b/gi;

export function restNeedsModel(rest) {
  return rest.replace(FILLER, ' ').replace(/[^A-Za-z0-9]+/g, ' ').trim().length > 0;
}

// Pasting a row is usually "put this in again", but not always — it is also how
// you point at something to ask about it. Logging on a question would be the
// same class of mistake this file exists to stop, so a question goes to the
// model untouched. It still gets the rows spelled out by describeCards, which
// is the part it could not read for itself.
const QUESTION = /\?|^\s*(what|which|how|why|when|whats|is|are|do|does|did|can|could|should|would|will|any|worth|too)\b/i;

export function asksAQuestion(rest) {
  return QUESTION.test(rest);
}

// The rows as a sentence, for the times the model does need to see them.
export function describeCards(items) {
  return items.map(i =>
    `${i.name} — ${i.cal} kcal, P ${i.p} g, F ${i.f} g, C ${i.c} g, ` +
    `Zn ${i.zn} mg, Fe ${i.fe} mg, Mg ${i.mg} mg, VitC ${i.vc} mg`);
}

/* Write the parsed rows to the log. Mirrors applyLogItems in apply.js and
 * returns the same { changed, receipts, result } shape, so send() handles both
 * paths identically. */
export function logCards(items, meal) {
  const m = MEALS.includes(meal) ? meal : defaultMeal();
  const added = items.map(it => Object.assign({ id: uid(), meal: m }, it));
  for (const it of added) day().items.push(it);

  return {
    changed: true,
    receipts: added.map(a => `+ ${a.name} → ${a.meal}`),
    result: `Logged ${added.length} pasted item(s) exactly as given: ` +
            `${added.map(a => a.name).join(', ')} (${m}). ${totalsLine()}`,
    added
  };
}
