'use strict';

/**
 * What the connector's tools actually do to the log.
 *
 * Each returns the plain-text string Claude reads back. That text is the whole
 * interface: there is no screen on this path, so a tool that half-worked has to
 * say so in words, and one that refused has to say why clearly enough that the
 * next call is the right one rather than the same one again.
 *
 * These mirror public/js/tools/apply.js, which does the same jobs for the model
 * behind the page. Where a rule appears in both, breaking it here would put
 * numbers in the log that the app's own buttons would never have produced.
 */

const {
  MEALS, TARGET_DEC,
  clamp0, r0, r1, uid, defaultMeal,
  newDay, nextDayNum, fillTargets,
  totalsFor, totalsLine,
  selectDay, currentState, mutate
} = require('./log');

// The friendly names the tools take, mapped to the short keys the log stores.
const TARGET_KEYS = { calories: 'cal', protein: 'p', fat: 'f', carbs: 'c', zinc: 'zn', iron: 'fe', magnesium: 'mg', vitamin_c: 'vc' };

// Said whenever a tool writes into a day other than the open one, so a mistake
// about which day is being changed surfaces in Claude's reply instead of being
// found days later in the totals.
const where = (state, idx) => state.days[idx].label + (idx === state.active ? '' : ' (not the day the tracker is open on)');

/* ---------------------------------------------------------------- items -- */

async function logFood(input) {
  const raw = (input && input.items) || [];
  if (!Array.isArray(raw) || !raw.length) return 'No items were provided, so nothing was logged.';

  const fallback = defaultMeal();
  const added = raw.map(it => ({
    id: uid(),
    name: String(it.name || 'Item').slice(0, 120),
    meal: MEALS.includes(it.meal) ? it.meal : fallback,
    cal: clamp0(r0(it.calories)),
    // The page enforces this in public/js/tools/apply.js and so must this:
    // protein only counts from a complete source. Letting it through here
    // would put numbers in the log that the app's own rule would have zeroed,
    // and the two ways in would start disagreeing about the same plate.
    p: it.protein_source === 'complete' ? clamp0(r1(it.protein)) : 0,
    f: clamp0(r1(it.fat)),
    c: clamp0(r1(it.carbs)),
    zn: clamp0(r1(it.zinc)),
    fe: clamp0(r1(it.iron)),
    mg: clamp0(r0(it.magnesium)),
    vc: clamp0(r1(it.vitamin_c))
  }));

  // Only worth mentioning where protein was actually taken away — paired by
  // position, since two helpings of the same food share a name and matching on
  // that would report the wrong one.
  const zeroed = added.filter((a, i) => a.p === 0 && (Number(raw[i].protein) || 0) > 0).map(a => a.name);

  return await mutate(state => {
    const sel = selectDay(state, input);
    if (sel.why) return { changed: false, text: sel.why + ' Nothing was logged.' };
    const day = state.days[sel.idx];

    for (const it of added) day.items.push(it);
    return { changed: true, text: [
      `Logged ${added.length} item(s) into ${where(state, sel.idx)}: ${added.map(a => `${a.name} (${a.meal})`).join(', ')}.`,
      zeroed.length ? `Protein set to 0 for: ${zeroed.join(', ')} (not complete sources).` : '',
      totalsLine(day)
    ].filter(Boolean).join(' ') };
  });
}

async function readLog(input) {
  const state = await currentState();
  if (!state) return 'The log is empty — nothing has been tracked yet.';

  const sel = selectDay(state, input);
  if (sel.why) return sel.why;
  const day = state.days[sel.idx];

  const t = totalsFor(day);
  // Targets are always answered, never left out. A log written before they
  // were editable has none stored, but the page fills them from its defaults
  // before drawing a single bar — so those defaults are what the user is
  // actually being measured against, and saying nothing would be the lie.
  const g = fillTargets(state);

  const lines = day.items.length
    ? day.items.map(i => `- [${i.id}] ${i.meal} | ${i.name} | ${i.cal} kcal | P ${i.p} | F ${i.f} | C ${i.c} | Zn ${i.zn} | Fe ${i.fe} | Mg ${i.mg} | VitC ${i.vc}`).join('\n')
    : '(nothing logged yet)';

  return [
    `${day.label} (position ${sel.idx + 1} of ${state.days.length}${sel.idx === state.active ? ', the day the tracker is open on' : ''}).`,
    'Grams: P protein, F fat, C carbs. Milligrams: Zn, Fe, Mg, VitC.',
    `Targets:   ${g.cal} kcal | P ${g.p} | F ${g.f} | C ${g.c} | Zn ${g.zn} | Fe ${g.fe} | Mg ${g.mg} | VitC ${g.vc}`,
    `Logged:    ${t.cal} kcal | P ${t.p} | F ${t.f} | C ${t.c} | Zn ${t.zn} | Fe ${t.fe} | Mg ${t.mg} | VitC ${t.vc}`,
    `Remaining: ${r1(g.cal - t.cal)} kcal | P ${r1(g.p - t.p)} | F ${r1(g.f - t.f)} | C ${r1(g.c - t.c)} | Zn ${r1(g.zn - t.zn)} | Fe ${r1(g.fe - t.fe)} | Mg ${r1(g.mg - t.mg)} | VitC ${r1(g.vc - t.vc)}`,
    'Items:',
    lines
  ].join('\n');
}

async function editFood(input) {
  const edits = (input && input.edits) || [];
  if (!Array.isArray(edits) || !edits.length) return 'No edits were provided, so nothing was changed.';

  return await mutate(state => {
    const sel = selectDay(state, input);
    if (sel.why) return { changed: false, text: sel.why + ' Nothing was changed.' };
    const day = state.days[sel.idx];

    const done = [], missing = [], untouched = [], zeroed = [];

    for (const e of edits) {
      const it = day.items.find(x => x.id === e.id);
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
      // source is explicitly declared complete, so an edit that sends a number
      // without one zeroes it rather than sneaking past the rule log_food kept.
      //
      // Refusing it quietly is the trap. The item usually held 0 protein
      // already, so the edit lands as "nothing changed" — and an assistant
      // reading that tells the user their 20 g is safely logged when the log
      // says 0. There is no list on screen here to contradict it, so the
      // refusal has to be said out loud.
      if (e.protein !== undefined) {
        const complete = e.protein_source === 'complete';
        it.p = complete ? clamp0(r1(e.protein)) : 0;
        if (!complete && (Number(e.protein) || 0) > 0) zeroed.push(it.name);
      }

      // An edit that sets every field to what it already held changed nothing.
      // Reporting it as an update is how an assistant ends up describing a
      // correction the user can plainly see did not happen.
      if (JSON.stringify(it) === was) { untouched.push(it.name); continue; }
      done.push(`${before} → ${it.name} (${it.cal} kcal)`);
    }

    const proteinNote = zeroed.length
      ? ` Protein stored as 0 for: ${zeroed.join(', ')} — protein_source was not "complete".`
      : '';

    if (!done.length) {
      const why = [];
      if (missing.length) why.push(`No item found in ${day.label} with id(s): ${missing.join(', ')}.`);
      if (untouched.length) why.push(`The values sent for ${untouched.join(', ')} are identical to what is already logged.`);
      if (!why.length) why.push('No edits were provided.');
      return { changed: false, text: why.join(' ') + proteinNote + ' NOTHING WAS CHANGED — do not tell the user otherwise.' };
    }

    return { changed: true, text:
      `Updated ${done.length} item(s) in ${where(state, sel.idx)}: ${done.join('; ')}.` + proteinNote +
      (untouched.length ? ` Already exactly that, so left alone: ${untouched.join(', ')}.` : '') +
      (missing.length ? ` Not found: ${missing.join(', ')}.` : '') + ' ' + totalsLine(day) };
  });
}

async function deleteFood(input) {
  const ids = (input && input.ids) || [];
  if (!Array.isArray(ids) || !ids.length) return 'No ids were provided, so nothing was deleted.';

  return await mutate(state => {
    const sel = selectDay(state, input);
    if (sel.why) return { changed: false, text: sel.why + ' Nothing was deleted.' };
    const day = state.days[sel.idx];

    const gone = [], missing = [];
    for (const id of ids) {
      const idx = day.items.findIndex(x => x.id === id);
      if (idx === -1) { missing.push(id); continue; }
      gone.push(day.items.splice(idx, 1)[0].name);
    }

    if (!gone.length) {
      return { changed: false, text: `No item found in ${day.label} with id(s): ${missing.join(', ')}. Nothing was deleted.` };
    }
    return { changed: true, text:
      `Deleted from ${where(state, sel.idx)}: ${gone.join(', ')}.` +
      (missing.length ? ` Not found: ${missing.join(', ')}.` : '') + ' ' + totalsLine(day) };
  });
}

/* ----------------------------------------------------------------- days -- */

async function listDays() {
  const state = await currentState();
  if (!state) return 'The log is empty — nothing has been tracked yet.';

  const rows = state.days.map((d, i) => {
    const t = totalsFor(d);
    const n = d.items.length;
    return `  #${i + 1}  ${d.label}  |  ${n} item${n === 1 ? '' : 's'}  |  ${t.cal} kcal  |  P ${t.p} F ${t.f} C ${t.c}` +
           (i === state.active ? '   <- open' : '');
  });

  return [
    `${state.days.length} day(s). The tracker is open on ${state.days[state.active].label} (position ${state.active + 1}).`,
    ...rows
  ].join('\n');
}

async function switchDay(input) {
  return await mutate(state => {
    const sel = selectDay(state, input);
    if (sel.why) return { changed: false, text: sel.why };
    if (sel.idx === state.active) {
      return { changed: false, text: `The tracker is already open on ${state.days[sel.idx].label}. Nothing changed.` };
    }

    const from = state.days[state.active].label;
    state.active = sel.idx;
    const day = state.days[sel.idx];
    return { changed: true, text:
      `Switched from ${from} to ${day.label} (position ${sel.idx + 1}), on every device. ` +
      `It has ${day.items.length} item(s). ${totalsLine(day)}` };
  });
}

async function addDay() {
  return await mutate(state => {
    const day = newDay(nextDayNum(state));
    state.days.push(day);
    state.active = state.days.length - 1;
    return { changed: true, text:
      `Started ${day.label} at position ${state.days.length} and opened it on every device. It is empty.` };
  });
}

async function deleteDay(input) {
  // Two locks rather than one. The page asks this with a confirm() dialog that
  // names the day and its item count; there is no dialog on this path, so the
  // exact label has to be typed back and the confirmation has to be explicit.
  // Neither is a real security boundary — they are there so that a deletion is
  // always something the user asked for in words, never a tidy-up Claude
  // decided on while doing something else.
  if (!input || input.confirm !== true) {
    return 'Not deleted. Ask the user to confirm they want to lose that whole day, then call again with confirm: true.';
  }
  if (!String((input && input.label) || '').trim() && !Number.isFinite(Number(input.position))) {
    return 'Not deleted. Name the day to delete by its exact label — the open day is not assumed for a deletion.';
  }

  return await mutate(state => {
    const sel = selectDay(state, input);
    if (sel.why) return { changed: false, text: sel.why + ' Nothing was deleted.' };

    const [gone] = state.days.splice(sel.idx, 1);
    // A tracker with no days has nothing to draw, so deleting the last one
    // leaves an empty day standing rather than an empty page. From deleteDay()
    // in public/js/actions/days.js, along with landing on the day that took its
    // place — or the new last one, if the deleted day was the tail.
    const replaced = !state.days.length;
    if (replaced) state.days.push(newDay(1));
    state.active = Math.min(sel.idx, state.days.length - 1);

    return { changed: true, text:
      `Deleted ${gone.label} and the ${gone.items.length} item(s) in it, on every device. ` +
      (replaced
        ? 'It was the only day, so an empty Day 1 is now open.'
        : `The tracker is now open on ${state.days[state.active].label}.`) };
  });
}

/* -------------------------------------------------------------- targets -- */

async function setTargets(input) {
  const patch = input || {};
  const asked = Object.keys(TARGET_KEYS).filter(n => patch[n] !== undefined);
  if (!asked.length) return 'No targets were given, so nothing was changed.';

  return await mutate(state => {
    // Written back whole, never as a patch. mergeState() in public/js/state/
    // sync.js settles targets by whichever side set them last and takes that
    // object outright — so writing only the changed fields with a fresh
    // targetsAt would drop every target the user set on the page, and
    // normalizeState() would quietly refill them from the ICMR defaults.
    const before = fillTargets(state);
    const next = Object.assign({}, before);

    const set = [], refused = [];
    for (const n of asked) {
      const v = Number(patch[n]);
      // A target of zero would divide by zero in the bars and tell the model
      // the user needs nothing, so it is refused and the old value kept — the
      // same rule saveTargets() applies in public/js/actions/settings.js.
      if (!Number.isFinite(v) || v <= 0) { refused.push(n); continue; }
      const k = TARGET_KEYS[n];
      next[k] = TARGET_DEC[k] ? r1(v) : r0(v);
      set.push(`${n} ${next[k]}`);
    }

    const note = refused.length
      ? ` Ignored, must be greater than zero: ${refused.join(', ')} (previous values kept).`
      : '';

    if (!set.length) return { changed: false, text: 'Nothing was changed.' + note };
    if (JSON.stringify(next) === JSON.stringify(before)) {
      return { changed: false, text: `The targets are already exactly that, so nothing was changed.${note}` };
    }

    state.targets = next;
    state.targetsAt = Date.now();
    return { changed: true, text:
      `Targets updated on every device: ${set.join(', ')}.${note} ` +
      `Now ${next.cal} kcal | P ${next.p} | F ${next.f} | C ${next.c} | Zn ${next.zn} | Fe ${next.fe} | Mg ${next.mg} | VitC ${next.vc}.` };
  });
}

// The name Claude calls, mapped to the function that runs it.
const CALLS = {
  log_food: logFood,
  read_log: readLog,
  edit_food: editFood,
  delete_food: deleteFood,
  list_days: listDays,
  switch_day: switchDay,
  add_day: addDay,
  delete_day: deleteDay,
  set_targets: setTargets
};

module.exports = { CALLS };
