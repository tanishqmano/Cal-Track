/* The log: the days, their items, and the targets that travel with them.
 *
 * This module owns `state`. Everything else reads it and mutates the objects
 * inside it; only setState() and normalizeState() ever swap the whole thing. */

import { DEFAULT_TARGETS, TARGET_FIELDS, MICROS } from '../config/nutrition.js';
import { sumCal, sumG } from '../lib/numbers.js';

export let state = null;

export function setState(next) {
  state = next;
}

// The targets in force right now. Editable under Settings, and kept inside the
// log rather than beside it, so changing them on the phone changes them on the
// laptop too. normalizeState() rebinds this to state.targets on every copy that
// arrives; nothing else should reassign it.
export let TARGETS = Object.assign({}, DEFAULT_TARGETS);

export const uid = () => Math.random().toString(36).slice(2, 10);
export const newDay = n => ({ id: uid(), label: 'Day ' + n, items: [], chat: [] });

// Targets and the timezone carry over a reset — they are settings, not logged
// data. The *At stamps are only read when two devices disagree; see
// mergeState(). They are kept apart so that setting the zone on the phone
// cannot revert targets set on the laptop, and the other way round.
export const freshState = () => ({
  v: 1, active: 0,
  targets: Object.assign({}, TARGETS),
  targetsAt: (state && state.targetsAt) || 0,
  tz: (state && state.tz) || '',
  tzAt: (state && state.tzAt) || 0,
  days: [newDay(1)]
});

export function day() { return state.days[state.active]; }

// Days are numbered by the highest number already in use, not by how many exist,
// so deleting Day 2 of three does not make the next one a second Day 3.
export function nextDayNum() {
  let n = 0;
  for (const d of state.days) {
    const m = /(\d+)\s*$/.exec(String(d.label || ''));
    if (m) n = Math.max(n, Number(m[1]));
  }
  return n + 1;
}

// Repair anything the log is missing: days saved before chat existed, and
// items logged before micros were tracked — those read as 0 rather than
// breaking the sums. Runs on every copy that arrives, local or from the server.
export function normalizeState() {
  if (!state || !Array.isArray(state.days) || !state.days.length) state = freshState();
  if (state.active >= state.days.length || state.active < 0) state.active = state.days.length - 1;

  // Targets live in the log, so a copy written before they were editable — or
  // one hand-edited to nonsense — falls back to the default field by field.
  // TARGETS then points at the live object, which is what makes an edit here
  // show up everywhere the numbers are read.
  if (!state.targets || typeof state.targets !== 'object') state.targets = {};
  for (const f of TARGET_FIELDS) {
    const v = Number(state.targets[f.k]);
    state.targets[f.k] = Number.isFinite(v) && v > 0 ? v : DEFAULT_TARGETS[f.k];
  }
  TARGETS = state.targets;
  if (typeof state.targetsAt !== 'number') state.targetsAt = 0;

  // Empty is a real setting, not a missing one: it means "use whatever clock
  // the device is on". Only the connector, which runs on a server in UTC,
  // needs a name here. A log written before this existed has neither field.
  if (typeof state.tz !== 'string') state.tz = '';
  if (typeof state.tzAt !== 'number') state.tzAt = 0;

  for (const d of state.days) {
    if (!Array.isArray(d.items)) d.items = [];
    if (!Array.isArray(d.chat)) d.chat = [];
    for (const it of d.items) {
      for (const m of MICROS) if (typeof it[m.k] !== 'number') it[m.k] = 0;
    }
  }
}

export function dayTotals() {
  const items = day().items;
  const t = { cal: sumCal(items) };
  for (const k of ['p', 'f', 'c', 'zn', 'fe', 'mg', 'vc']) t[k] = sumG(items, k);
  return t;
}
