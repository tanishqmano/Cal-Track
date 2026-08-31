/* Did the user actually ask for something to be removed?
 *
 * delete_items is the one tool that destroys work, and the assistant reaches
 * for it on any message that sounds negative about food. "I don't have any of
 * that" — a reply about an empty kitchen — has twice been read as "I didn't eat
 * those" and wiped a logged meal.
 *
 * Prose in the prompt did not hold, so this is checked in code before the
 * deletion runs. It reads the user's own message and refuses when nothing in it
 * asks for a removal. The bar is deliberately low: this is here to stop a delete
 * nobody asked for, not to adjudicate wording.
 *
 * Two of the checks refuse outright rather than merely failing to allow. A
 * message that asks to add or to swap something is never also a request to
 * delete, whatever else it happens to mention — and pasting a row off the list
 * mentions the food's own name, which is exactly how "add this for dinner"
 * talked its way past the name check and wiped two logged items. */

import { MEALS } from '../config/nutrition.js';
import { day } from '../state/log.js';

// Present tense on purpose. "didn't have" removes something; "don't have"
// describes the cupboard, and the difference is the whole bug.
const REMOVE_WORDS = /\b(delete|deleted|remove|removed|removing|drop|dropped|clear|cleared|wipe|wiped|erase|scratch|cancel|undo|didn'?t (?:have|eat|touch)|did not (?:have|eat)|never (?:had|ate)|take (?:it|them|that|those|the) \w* ?(?:out|off)|get rid of)\b/i;

// A bare "yes" is an instruction when it answers a question you asked about
// removing something.
const AFFIRMATIVE = /^\W*(y|ye|yes|yeah|yep|yup|sure|ok|okay|do it|please|please do|go ahead|correct|right|confirm|that'?s right)\b/i;

// A message that asks for something to be PUT IN is not licence to take
// something out first. Delete-then-log is how the assistant stands in for an
// edit, and pasting a row off the list made it worse: the paste repeats the
// food's own name, which was all signal 1 below needed to wave the delete
// through. "add this for dinner" cost a logged breakfast that way.
const ADD_WORDS = /\b(add|adding|added|log|logging|include|track|put)\b/i;

// Same refusal, different wording. Swapping one item for another is edit_items;
// there is no case where it needs a delete.
const SWAP_WORDS = /\b(replace|replacing|swap|swapped|switch|instead|make it|change (?:it|the|that|this)\b)/i;

// A weight or a count. Removals are expressed in words — "drop the sambar",
// "I didn't have the second idli" — never by naming an amount. So a message
// carrying one is a report of food eaten, and signal 1 below must not read the
// food's own name in it as permission to delete that food.
const QUANTITY = /\b\d+(?:\.\d+)?\s*(?:g|gm|gms|gram|grams|kg|ml|l|litre|liter|oz|scoops?|cups?|katori|pieces?|slices?|tbsp|tsp|bowls?|glass(?:es)?|plates?|servings?|eggs?|idlis?|dosas?|rotis?|chapatis?)\b/i;

// Words that appear in item names but say nothing about which food it is.
const FILLER = new Set([
  'scoop', 'scoops', 'cup', 'cups', 'bowl', 'bowls', 'katori', 'piece', 'pieces',
  'plate', 'plates', 'serving', 'servings', 'glass', 'glasses', 'slice', 'slices',
  'small', 'large', 'medium', 'half', 'tbsp', 'tsp', 'restaurant', 'homemade',
  'raw', 'cooked', 'boiled', 'fried', 'and', 'with', 'the'
]);

const words = s => String(s).toLowerCase().split(/[^a-z']+/).filter(Boolean);

function foodWords(names) {
  const out = new Set();
  for (const n of names) {
    for (const w of words(n)) if (w.length >= 3 && !FILLER.has(w)) out.add(w);
  }
  return out;
}

function lastOf(chat, role) {
  for (let i = chat.length - 1; i >= 0; i--) if (chat[i].role === role) return chat[i].text || '';
  return '';
}

/* Empty string when the message plausibly asks for these items to go, and the
 * reason to hand back to the model when it does not.
 *
 * `names` are the names of the items about to be deleted. send() pushes the
 * user's message onto the transcript before the model runs, so the last user
 * entry is the one that triggered this call. */
export function removalRefusal(names) {
  const chat = day().chat;
  const said = lastOf(chat, 'user');
  if (!said) return '';                // nothing to judge against — don't block

  // Checked first, and ahead of everything below: an explicit removal word
  // settles it, however the rest of the message reads.
  if (REMOVE_WORDS.test(said)) return '';

  // They said yes to a question you asked about removing something.
  if (AFFIRMATIVE.test(said) && REMOVE_WORDS.test(lastOf(chat, 'assistant'))) return '';

  // No removal word anywhere, and the message asks for something to go in.
  // This is a delete standing in for a log or an edit. Refuse it: the log call
  // on its own does what they asked, and a wrong delete is the one mistake
  // that costs them the day.
  if (SWAP_WORDS.test(said)) {
    return 'REFUSED — nothing was deleted. The user asked to change or replace something, ' +
           'not to remove it. Use edit_items on the existing id instead: it takes the new ' +
           'name and the re-estimated numbers in one call. Do not retry this delete.';
  }
  if (ADD_WORDS.test(said)) {
    return 'REFUSED — nothing was deleted. The user asked for something to be ADDED and used ' +
           'no word that means remove. Adding is the default: call log_items for the new food ' +
           'and leave everything already logged alone. People eat the same food twice. Do not ' +
           'retry this delete.';
  }

  if (QUANTITY.test(said)) {
    return 'REFUSED — nothing was deleted. The user gave an amount, which reports food they ' +
           'ate; it is not a request to remove anything. Log it as new with log_items, or if ' +
           'they said it corrects something already listed, use edit_items on that id. ' +
           'Do not retry this delete.';
  }

  // 1. They named one of the foods being removed.
  const mine = foodWords(names);
  for (const w of words(said)) if (mine.has(w)) return '';

  // 2. They named a meal, which is how a whole group gets cleared.
  const lower = said.toLowerCase();
  for (const m of MEALS) if (lower.includes(m.toLowerCase())) return '';

  return 'REFUSED — nothing was deleted. The user\'s message does not ask for anything to be ' +
         'removed; it reads as a reply about what they have or want, not an instruction. ' +
         'Do not retry this call. Answer them in words, or ask one short question if you ' +
         'genuinely think they meant to remove something.';
}
