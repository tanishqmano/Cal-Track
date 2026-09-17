'use strict';

/**
 * The log, as the connector reads and writes it.
 *
 * This is the server-side twin of public/js/state/log.js, public/js/lib/
 * numbers.js and public/js/config/nutrition.js. It is a copy rather than a
 * shared module because those are browser ESM and this is CommonJS, and a
 * handful of one-liners is a smaller price than a build step.
 *
 * Every rule copied down here names the file it came from. Both sides write
 * into the same document, so a rule that drifts on one side shows up as the
 * phone and the laptop disagreeing about the same plate.
 */

const { pick } = require('../config/env');
const { store } = require('../store');

const MEALS = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];

// US RDAs for an adult man, from DEFAULT_TARGETS in public/js/config/
// nutrition.js — which is also where the note lives on why these sit below the
// Indian numbers this tracker used to carry. Needed here so set_targets can
// write a complete targets object; see fillTargets() for why a partial one is
// unsafe.
const DEFAULT_TARGETS = { cal: 2150, p: 110, f: 65, c: 280, zn: 11, fe: 8, mg: 400, vc: 90 };

// Which targets are worth a decimal place, from TARGET_FIELDS in the same
// file: 17.5 mg of zinc is a real setting, 2150.5 kcal is not.
const TARGET_DEC = { cal: false, p: false, f: false, c: false, zn: true, fe: true, mg: false, vc: true };

// Render runs in UTC; the person eating does not. Without this, dinner at 8pm
// in Los Angeles arrives at 03:00 UTC the NEXT day and gets filed under
// Breakfast. Only consulted when Claude does not name a meal itself.
//
// A zone name, not a fixed offset, because the US moves its clocks: -480 is
// right in January and a full hour wrong from March to November, which is
// enough to file an 11am breakfast as lunch. LOG_UTC_OFFSET_MIN is still read
// for zones that skip DST (Arizona, Hawaii) and for .env files written before
// LOG_TZ existed.
const TZ = pick('LOG_TZ');
const UTC_OFFSET_MIN = Number(pick('LOG_UTC_OFFSET_MIN')) || 0;

// Intl throws a RangeError on a zone name it does not know, and a typo in .env
// must not take the connector down with it. Build the formatter once, at load,
// so a bad name is caught here rather than on the first meal of the day.
const localHour = (() => {
  if (TZ) {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
      fmt.format(new Date());
      return () => Number(fmt.format(new Date()));
    } catch {
      console.warn(`LOG_TZ="${TZ}" is not a timezone this Node knows. Falling back to LOG_UTC_OFFSET_MIN=${UTC_OFFSET_MIN}.`);
    }
  }
  return () => new Date(Date.now() + UTC_OFFSET_MIN * 60 * 1000).getUTCHours();
})();

/* ------------------------------------------------------------- arithmetic -- */

// The same rounding the page applies in public/js/lib/numbers.js, with a
// stricter clamp: anything that is not a positive number becomes 0, so a
// missing field and a nonsense one land in the log the same harmless way.
const clamp0 = n => (Number.isFinite(n) && n > 0 ? n : 0);
const r0 = n => Math.round(Number(n) || 0);
const r1 = n => Math.round((Number(n) || 0) * 10) / 10;
const uid = () => Math.random().toString(36).slice(2, 10);

function defaultMeal() {
  const h = localHour();
  return h < 11 ? 'Breakfast' : h < 16 ? 'Lunch' : h < 18 ? 'Snack' : 'Dinner';
}

/* ------------------------------------------------------------------ shape -- */

// A log that has never been written has state === null. Mirrors freshState()
// in public/js/state/log.js, minus the targets — leaving those out lets
// normalizeState() on the page fill them from its own defaults, so the two
// copies cannot disagree about what a target is.
const freshState = () => ({ v: 1, active: 0, targets: {}, targetsAt: 0, days: [newDay(1)] });

const newDay = n => ({ id: uid(), label: 'Day ' + n, items: [], chat: [] });

// Days are numbered by the highest number already in use, not by how many
// exist, so deleting Day 2 of three does not make the next one a second Day 3.
// From nextDayNum() in public/js/state/log.js.
function nextDayNum(state) {
  let n = 0;
  for (const d of state.days) {
    const m = /(\d+)\s*$/.exec(String(d.label || ''));
    if (m) n = Math.max(n, Number(m[1]));
  }
  return n + 1;
}

// Targets are stored inside the log so that changing them on the phone changes
// them on the laptop too, and a copy written before they were editable can be
// missing them entirely. normalizeState() on the page repairs that field by
// field against the defaults; this does the same, and is what makes it safe
// for set_targets to write the whole object back.
function fillTargets(state) {
  const cur = (state && state.targets) || {};
  const out = {};
  for (const k of Object.keys(DEFAULT_TARGETS)) {
    const v = Number(cur[k]);
    out[k] = Number.isFinite(v) && v > 0 ? v : DEFAULT_TARGETS[k];
  }
  return out;
}

/* ------------------------------------------------------------------ totals -- */

function totalsFor(day) {
  const t = { cal: 0, p: 0, f: 0, c: 0, zn: 0, fe: 0, mg: 0, vc: 0 };
  for (const it of day.items) for (const k of Object.keys(t)) t[k] += Number(it[k]) || 0;
  for (const k of Object.keys(t)) t[k] = k === 'cal' ? Math.round(t[k]) : r1(t[k]);
  return t;
}

const totalsLine = day => {
  const t = totalsFor(day);
  return `Day total now ${t.cal} kcal | P ${t.p} | F ${t.f} | C ${t.c} | Zn ${t.zn} | Fe ${t.fe} | Mg ${t.mg} | VitC ${t.vc}.`;
};

/* -------------------------------------------------------------- selecting -- */

// A day can be named by its label ("Day 3") or by its position as list_days
// prints it; naming neither means the day the tracker is currently open on.
//
// Labels are generated unique, but two devices logging offline can each create
// a "Day 4" and mergeState() in public/js/state/sync.js keeps both — it matches
// days by id, not by name. So an ambiguous label is answered with a question
// rather than a guess at which one was meant.
function selectDay(state, input) {
  const pos = Number(input && input.position);
  if (Number.isFinite(pos) && pos !== 0) {
    const idx = Math.trunc(pos) - 1;
    if (idx < 0 || idx >= state.days.length) {
      return { why: `There is no day at position ${Math.trunc(pos)} — the log has ${state.days.length}.` };
    }
    return { idx };
  }

  const asked = String((input && input.label) || '').trim();
  if (!asked) return { idx: state.active };

  const hits = [];
  state.days.forEach((d, i) => {
    if (String(d.label || '').trim().toLowerCase() === asked.toLowerCase()) hits.push(i);
  });
  if (!hits.length) return { why: `No day is called "${asked}". Call list_days to see what there is.` };
  if (hits.length > 1) {
    return { why: `${hits.length} days are called "${asked}" (positions ${hits.map(i => i + 1).join(', ')}). Say which position.` };
  }
  return { idx: hits[0] };
}

/* -------------------------------------------------------------- reading -- */

// Null means nothing has ever been logged, which is different from a day with
// no items in it — the read-only tools say so rather than inventing a Day 1.
async function currentState() {
  const cur = await store.read();
  const state = cur.state;
  if (!state || !Array.isArray(state.days) || !state.days.length) return null;
  if (!(state.active >= 0 && state.active < state.days.length)) state.active = state.days.length - 1;
  for (const d of state.days) if (!Array.isArray(d.items)) d.items = [];
  return state;
}

/* -------------------------------------------------------------- writing -- */

// Read, change, write, and be ready to lose. Every writer here races the phone
// browser and the laptop, and store.commit() settles that by revision: a write
// from a revision someone else has already moved past is refused outright. The
// fix is always to re-read and redo the change on top of what landed, never to
// force — force is the Reset button, and it would eat the other device's meal.
//
// `change` gets the whole state and returns { changed, text }. It picks its own
// day through selectDay() rather than being handed the active one, because
// most of these tools can be pointed at an earlier day and the rest work on
// the state itself.
//
// Returning changed:false skips the write entirely, which matters more than it
// looks: a commit bumps the revision, and every device that pulls a new
// revision clears its undo history (see pullState() in public/js/state/
// sync.js). An edit that changed nothing must not cost the person at the
// laptop their undo stack.
async function mutate(change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await store.read();
    const state = cur.state && Array.isArray(cur.state.days) && cur.state.days.length
      ? cur.state
      : freshState();

    if (!(state.active >= 0 && state.active < state.days.length)) state.active = state.days.length - 1;
    for (const d of state.days) if (!Array.isArray(d.items)) d.items = [];

    const out = change(state);
    if (!out.changed) return out.text;

    const res = await store.commit(state, cur.rev, false);
    if (res.ok) return out.text;
  }
  throw new Error('The log kept changing underneath this write. Try once more.');
}

module.exports = {
  MEALS, DEFAULT_TARGETS, TARGET_DEC,
  clamp0, r0, r1, uid, defaultMeal,
  newDay, nextDayNum, fillTargets,
  totalsFor, totalsLine,
  selectDay, currentState, mutate
};
