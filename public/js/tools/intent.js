/* Did the user actually ask for something to be removed?
 *
 * delete_items is the one tool that destroys work, and the assistant reaches
 * for it on any message that sounds negative about food. "I don't have any of
 * that" — a reply about an empty kitchen — has twice been read as "I didn't eat
 * those" and wiped a logged meal.
 *
 * Prose in the prompt did not hold, so this is checked in code before the
 * deletion runs. It looks for any of four signals in the user's own message and
 * refuses when it finds none. The bar is deliberately low: this is here to stop
 * a delete nobody asked for, not to adjudicate wording. */

import { MEALS } from '../config/nutrition.js';
import { day } from '../state/log.js';

// Present tense on purpose. "didn't have" removes something; "don't have"
// describes the cupboard, and the difference is the whole bug.
const REMOVE_WORDS = /\b(delete|deleted|remove|removed|removing|drop|dropped|clear|cleared|wipe|wiped|erase|scratch|cancel|undo|didn'?t (?:have|eat|touch)|did not (?:have|eat)|never (?:had|ate)|take (?:it|them|that|those|the) \w* ?(?:out|off)|get rid of)\b/i;

// A bare "yes" is an instruction when it answers a question you asked about
// removing something.
const AFFIRMATIVE = /^\W*(y|ye|yes|yeah|yep|yup|sure|ok|okay|do it|please|please do|go ahead|correct|right|confirm|that'?s right)\b/i;

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

/* Returns true when the message plausibly asks for these items to go.
 *
 * `names` are the names of the items about to be deleted. send() pushes the
 * user's message onto the transcript before the model runs, so the last user
 * entry is the one that triggered this call. */
export function removalWasAsked(names) {
  const chat = day().chat;
  const said = lastOf(chat, 'user');
  if (!said) return true;              // nothing to judge against — don't block

  // 1. They named one of the foods being removed.
  const mine = foodWords(names);
  for (const w of words(said)) if (mine.has(w)) return true;

  // 2. They used a word that means "take it off".
  if (REMOVE_WORDS.test(said)) return true;

  // 3. They named a meal, which is how a whole group gets cleared.
  const lower = said.toLowerCase();
  for (const m of MEALS) if (lower.includes(m.toLowerCase())) return true;

  // 4. They said yes to a question you asked about removing something.
  if (AFFIRMATIVE.test(said) && REMOVE_WORDS.test(lastOf(chat, 'assistant'))) return true;

  return false;
}
