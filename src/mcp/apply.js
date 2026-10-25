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
const TARGET_KEYS = { calories: 'cal', protein: 'p', fat: 'f', carbs: 'c', fiber: 'fb', zinc: 'zn', iron: 'fe', magnesium: 'mg', vitamin_c: 'vc' };

// Said whenever a tool writes into a day other than the open one, so a mistake
// about which day is being changed surfaces in Claude's reply instead of being
// found days later in the totals.
const where = (state, idx) => state.days[idx].label + (idx === state.active ? '' : ' (not the day the tracker is open on)');

/* ---------------------------------------------------------------- items -- */

// Plain staples — "140 g milk", "2 large eggs", "1 scoop (30 g) whey" — count
// as complete whatever protein_source says. The reasoning, and the list, live
// with plainComplete() in public/js/tools/apply.js; keep the two identical.
const FILLER = /^(?:[\d./]+|%|g|gm|grams?|kg|ml|l|oz|fl|lbs?|cups?|scoops?|tbsp|tsp|glass(?:es)?|bowls?|cans?|servings?|pieces?|slices?|large|medium|small|of|a|an|x)$/;
const MODIFIER = '(?:whole|skim|skimmed|low|non|nonfat|fat|free|reduced|full|toned|lactose|plain|greek|boiled|hard|scrambled|fried|poached|grilled|baked|roast|roasted|smoked|cooked|canned|ground|lean|boneless|skinless|raw|fresh)';
const STAPLE = '(?:milk|whey(?: protein)?(?: isolate)?|casein|eggs?|egg whites?|yogh?urt|curd|paneer|cottage cheese|cheese|chicken(?: breast| thigh)?|turkey(?: breast)?|beef|steak|pork|lamb|mutton|goat|fish|salmon|tuna|shrimp|prawns?)';
const PLAIN_COMPLETE = new RegExp(`^(?:${MODIFIER} )*${STAPLE}$`);

function plainComplete(name) {
  const bare = String(name || '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/(\d)([a-z%])/g, '$1 $2')
    .split(/[\s,-]+/)
    .filter(w => w && !FILLER.test(w))
    .join(' ');
  return PLAIN_COMPLETE.test(bare);
}

// Also mirrored from the page: a plain staple sent with 0 protein gets it back
// from its calories rather than being stored as protein-free.
function storedProtein(source, name, protein, cal, fat, carbs) {
  const plain = plainComplete(name);
  if (source !== 'complete' && !plain) return 0;
  if (plain && !(Number(protein) > 0)) return clamp0(r1((Number(cal) - 9 * (Number(fat) || 0) - 4 * (Number(carbs) || 0)) / 4));
  return clamp0(r1(protein));
}

// The tools' field names onto the short keys the log stores, rounded. Shared by
// log_food and save_food, so a saved food is held to the same rules as a
// logged one.
function nutrientsFrom(it, name) {
  return {
    cal: clamp0(r0(it.calories)),
    // The page enforces this in public/js/tools/apply.js and so must this:
    // protein only counts from a complete source. Letting it through here
    // would put numbers in the log that the app's own rule would have zeroed,
    // and the two ways in would start disagreeing about the same plate.
    p: storedProtein(it.protein_source, name, it.protein, it.calories, it.fat, it.carbs),
    f: clamp0(r1(it.fat)),
    c: clamp0(r1(it.carbs)),
    fb: clamp0(r1(it.fiber)),
    zn: clamp0(r1(it.zinc)),
    fe: clamp0(r1(it.iron)),
    mg: clamp0(r0(it.magnesium)),
    vc: clamp0(r1(it.vitamin_c))
  };
}

async function logFood(input) {
  const raw = (input && input.items) || [];
  if (!Array.isArray(raw) || !raw.length) return 'No items were provided, so nothing was logged.';

  const added = raw.map(it => Object.assign({
    id: uid(),
    name: String(it.name || 'Item').slice(0, 120),
    // Left null and filled inside mutate() below, where the state is in hand —
    // the timezone the meal is guessed from is stored in the log itself now,
    // so there is nothing to guess with out here.
    meal: MEALS.includes(it.meal) ? it.meal : null
  }, nutrientsFrom(it, it.name)));

  // Only worth mentioning where protein was actually taken away — paired by
  // position, since two helpings of the same food share a name and matching on
  // that would report the wrong one.
  const zeroed = added.filter((a, i) => a.p === 0 && (Number(raw[i].protein) || 0) > 0).map(a => a.name);

  return await mutate(state => {
    const sel = selectDay(state, input);
    if (sel.why) return { changed: false, text: sel.why + ' Nothing was logged.' };
    const day = state.days[sel.idx];

    const fallback = defaultMeal(state);
    for (const it of added) {
      if (!it.meal) it.meal = fallback;
      day.items.push(it);
    }

    // A saved food estimated anyway is the exact drift saving it was meant to
    // stop, so it is pointed out. Not fixed, though: a label photo of a
    // different product can share a name, and only the conversation knows.
    const foods = foodsOf(state);
    const missed = added.filter(a => foods.some(f => norm(a.name).includes(norm(f.name))));

    return { changed: true, text: [
      `Logged ${added.length} item(s) into ${where(state, sel.idx)}: ${added.map(a => `${a.name} (${a.meal})`).join(', ')}.`,
      zeroed.length ? `Protein set to 0 for: ${zeroed.join(', ')} (not complete sources).` : '',
      missed.length
        ? `These were estimated, but the user has saved numbers for them: ${missed.map(a => `[${a.id}] ${a.name}`).join(', ')}. ` +
          'Unless the estimate was deliberate, delete_food those ids and log them with log_saved_food.'
        : '',
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
    ? day.items.map(i => `- [${i.id}] ${i.meal} | ${i.name} | ${i.cal} kcal | P ${i.p} | F ${i.f} | C ${i.c} | Fiber ${i.fb || 0} | Zn ${i.zn} | Fe ${i.fe} | Mg ${i.mg} | VitC ${i.vc}`).join('\n')
    : '(nothing logged yet)';

  // read_log is usually the call just before logging, so the saved names are
  // repeated here — the reminder lands at the moment it is needed.
  const saved = foodsOf(state).map(f => f.name);

  return [
    `${day.label} (position ${sel.idx + 1} of ${state.days.length}${sel.idx === state.active ? ', the day the tracker is open on' : ''}).`,
    'Grams: P protein, F fat, C carbs, Fiber (part of C, not on top of it). Milligrams: Zn, Fe, Mg, VitC.',
    `Targets:   ${g.cal} kcal | P ${g.p} | F ${g.f} | C ${g.c} | Fiber ${g.fb} | Zn ${g.zn} | Fe ${g.fe} | Mg ${g.mg} | VitC ${g.vc}`,
    `Logged:    ${t.cal} kcal | P ${t.p} | F ${t.f} | C ${t.c} | Fiber ${t.fb} | Zn ${t.zn} | Fe ${t.fe} | Mg ${t.mg} | VitC ${t.vc}`,
    `Remaining: ${r1(g.cal - t.cal)} kcal | P ${r1(g.p - t.p)} | F ${r1(g.f - t.f)} | C ${r1(g.c - t.c)} | Fiber ${r1(g.fb - t.fb)} | Zn ${r1(g.zn - t.zn)} | Fe ${r1(g.fe - t.fe)} | Mg ${r1(g.mg - t.mg)} | VitC ${r1(g.vc - t.vc)}`,
    'Items:',
    lines,
    saved.length ? `Saved foods (log these with log_saved_food, not by estimating): ${saved.join('; ')}.` : ''
  ].filter(Boolean).join('\n');
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
      if (e.fiber !== undefined) it.fb = clamp0(r1(e.fiber));
      if (e.zinc !== undefined) it.zn = clamp0(r1(e.zinc));
      if (e.iron !== undefined) it.fe = clamp0(r1(e.iron));
      if (e.magnesium !== undefined) it.mg = clamp0(r0(e.magnesium));
      if (e.vitamin_c !== undefined) it.vc = clamp0(r1(e.vitamin_c));
      if (MEALS.includes(e.meal)) it.meal = e.meal;
      // Complete-protein rule again: protein can only become non-zero when the
      // source is declared complete or the item is a plain staple, so an edit that sends a number
      // without one zeroes it rather than sneaking past the rule log_food kept.
      //
      // Refusing it quietly is the trap. The item usually held 0 protein
      // already, so the edit lands as "nothing changed" — and an assistant
      // reading that tells the user their 20 g is safely logged when the log
      // says 0. There is no list on screen here to contradict it, so the
      // refusal has to be said out loud.
      if (e.protein !== undefined) {
        it.p = storedProtein(e.protein_source, it.name, e.protein, it.cal, it.f, it.c);
        if (it.p === 0 && (Number(e.protein) || 0) > 0) zeroed.push(it.name);
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

/* ---------------------------------------------------------- saved foods -- */

// What the user eats over and over, each kept with the numbers for one amount
// of it. A fresh estimate every time is how the same Costco chicken came out at
// 200 kcal one day and 280 the next; a saved one is the same arithmetic on the
// same numbers, so it cannot drift.
//
// They live in the log beside the targets, so every device and every new chat
// sees them. Protein goes through the complete-source rule when a food is
// saved rather than when it is logged, so what list_saved_foods shows is
// exactly what log_saved_food writes.

// A log written before saved foods existed has no list at all.
const foodsOf = state => (Array.isArray(state.foods) ? state.foods : (state.foods = []));
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Exact name first, ignoring case; then the one saved food whose name holds
// what was asked or is held in it, so "chipotle chicken" finds "Kirkland
// chargrilled chipotle chicken". Two candidates get a question, not a guess.
function findFood(foods, asked) {
  const q = norm(asked);
  if (!q) return { why: 'A saved food was asked for without a name.' };
  const exact = foods.find(f => norm(f.name) === q);
  if (exact) return { food: exact, exact: true };
  const near = foods.filter(f => norm(f.name).includes(q) || q.includes(norm(f.name)));
  if (near.length === 1) return { food: near[0], exact: false };
  if (near.length > 1) return { why: `"${asked}" could be ${near.map(f => `"${f.name}"`).join(' or ')}. Say which.` };
  return { why: `No saved food is called "${asked}". Saved: ${foods.length ? foods.map(f => f.name).join('; ') : 'none yet'}.` };
}

const numbersLine = f => `${f.cal} kcal | P ${f.p} | F ${f.f} | C ${f.c} | Fiber ${f.fb} | Zn ${f.zn} | Fe ${f.fe} | Mg ${f.mg} | VitC ${f.vc}`;

// The saved amount's numbers times k, with the rounding logFood() gives an
// estimate.
const scaled = (f, k) => ({
  cal: clamp0(r0(f.cal * k)),
  p: clamp0(r1(f.p * k)),
  f: clamp0(r1(f.f * k)),
  c: clamp0(r1(f.c * k)),
  fb: clamp0(r1(f.fb * k)),
  zn: clamp0(r1(f.zn * k)),
  fe: clamp0(r1(f.fe * k)),
  mg: clamp0(r0(f.mg * k)),
  vc: clamp0(r1(f.vc * k))
});

async function saveFood(input) {
  const it = input || {};
  const name = String(it.name || '').trim().slice(0, 80);
  if (!name) return 'No name was given, so nothing was saved.';
  const g = clamp0(r1(it.grams));
  const per = String(it.per || '').trim().slice(0, 60) || (g ? `${g} g` : '');
  if (!per) return 'Nothing was saved. Say what amount the numbers are for in "per", e.g. "100 g" or "1 serving (85 g)".';

  const food = Object.assign({ id: uid(), name, per, g }, nutrientsFrom(it, name), {
    note: String(it.note || '').trim().slice(0, 120)
  });
  const zeroed = food.p === 0 && (Number(it.protein) || 0) > 0;

  return await mutate(state => {
    const foods = foodsOf(state);
    const i = foods.findIndex(f => norm(f.name) === norm(name));
    const was = i === -1 ? null : foods[i];
    if (was) {
      food.id = was.id;
      // Same reason as in editFood(): a save that changed nothing must not be
      // reported as one, and must not cost the laptop its undo history.
      if (JSON.stringify(food) === JSON.stringify(was)) {
        return { changed: false, text: `${was.name} is already saved with exactly those numbers. Nothing changed.` };
      }
      foods[i] = food;
    } else {
      foods.push(food);
    }
    state.foodsAt = Date.now();

    return { changed: true, text: [
      was ? `Replaced the saved numbers for ${food.name} (were per ${was.per}: ${numbersLine(was)}).` : `Saved ${food.name}.`,
      `Now per ${food.per}: ${numbersLine(food)}.`,
      zeroed ? 'Protein saved as 0 — protein_source was not "complete".' : '',
      g ? 'It can be logged by grams or by servings.' : `It has no gram weight, so it can only be logged in servings of ${food.per}.`
    ].filter(Boolean).join(' ') };
  });
}

async function listSavedFoods() {
  const state = await currentState();
  const foods = state ? foodsOf(state) : [];
  if (!foods.length) {
    return 'No foods are saved yet. When the user reads numbers off a label, corrects an estimate, or logs something ' +
           'they clearly eat often, offer to save it with save_food.';
  }
  return [
    `${foods.length} saved food(s). log_saved_food writes exactly these numbers, scaled to the amount eaten.`,
    ...foods.map(f => `- ${f.name}, per ${f.per}${f.g ? '' : ' (no gram weight — log in servings)'}: ${numbersLine(f)}${f.note ? ` (${f.note})` : ''}`)
  ].join('\n');
}

async function logSavedFood(input) {
  const raw = (input && input.items) || [];
  if (!Array.isArray(raw) || !raw.length) return 'No items were provided, so nothing was logged.';

  return await mutate(state => {
    const sel = selectDay(state, input);
    if (sel.why) return { changed: false, text: sel.why + ' Nothing was logged.' };
    const day = state.days[sel.idx];
    const foods = foodsOf(state);
    const fallback = defaultMeal(state);

    const added = [], problems = [];
    for (const it of raw) {
      const hit = findFood(foods, it.name);
      if (hit.why) { problems.push(hit.why); continue; }
      const f = hit.food;
      const grams = Number(it.grams), servings = Number(it.servings);

      let k, label;
      if (grams > 0) {
        if (!f.g) { problems.push(`${f.name} is saved per ${f.per} with no gram weight — send servings for it instead.`); continue; }
        k = grams / f.g;
        label = `${r1(grams)} g ${f.name}`;
      } else if (servings > 0) {
        k = servings;
        label = f.g
          ? `${r1(servings)} serving${servings === 1 ? '' : 's'} (${r0(servings * f.g)} g) ${f.name}`
          : `${r1(servings)} × ${f.per} ${f.name}`;
      } else {
        problems.push(`Say how much ${f.name} was eaten, in grams or servings.`);
        continue;
      }

      added.push(Object.assign({
        id: uid(),
        name: label.slice(0, 120),
        meal: MEALS.includes(it.meal) ? it.meal : fallback
      }, scaled(f, k)));
    }

    // All or nothing. Logging the ones that matched and refusing the rest
    // invites a retry of the whole list, and that retry double-logs whatever
    // went in the first time.
    if (problems.length) return { changed: false, text: problems.join(' ') + ' Nothing was logged.' };

    day.items.push(...added);
    return { changed: true, text:
      `Logged ${added.length} saved item(s) into ${where(state, sel.idx)}: ` +
      `${added.map(a => `${a.name} (${a.meal}, ${a.cal} kcal, P ${a.p})`).join(', ')}. ${totalsLine(day)}` };
  });
}

async function forgetFood(input) {
  const asked = String((input && input.name) || '').trim();
  if (!asked) return 'No name was given, so nothing was forgotten.';

  return await mutate(state => {
    const foods = foodsOf(state);
    const hit = findFood(foods, asked);
    if (hit.why) return { changed: false, text: hit.why + ' Nothing was forgotten.' };
    // Near matches are fine for logging, where a wrong one shows up in the
    // reply. A removal is gone before anyone reads it, so it takes the name.
    if (!hit.exact) {
      return { changed: false, text: `No saved food is called exactly "${asked}". Did you mean "${hit.food.name}"? Send that name to forget it. Nothing was forgotten.` };
    }
    foods.splice(foods.indexOf(hit.food), 1);
    state.foodsAt = Date.now();
    return { changed: true, text: `Forgot ${hit.food.name}. Anything already logged from it stays as it is.` };
  });
}

// Appended to the connector's instructions, so a brand-new chat knows the
// names before its first call. Names only: the numbers are read fresh through
// list_saved_foods, and a database blip here must not stop Claude connecting.
async function savedFoodsNote() {
  try {
    const state = await currentState();
    const names = state ? foodsOf(state).map(f => f.name) : [];
    return names.length ? ` Saved right now: ${names.join('; ')}.` : ' Nothing is saved yet.';
  } catch {
    return '';
  }
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
    // normalizeState() would quietly refill them from DEFAULT_TARGETS.
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
      `Now ${next.cal} kcal | P ${next.p} | F ${next.f} | C ${next.c} | Fiber ${next.fb} | Zn ${next.zn} | Fe ${next.fe} | Mg ${next.mg} | VitC ${next.vc}.` };
  });
}

// The name Claude calls, mapped to the function that runs it.
const CALLS = {
  log_food: logFood,
  read_log: readLog,
  edit_food: editFood,
  delete_food: deleteFood,
  save_food: saveFood,
  list_saved_foods: listSavedFoods,
  log_saved_food: logSavedFood,
  forget_food: forgetFood,
  list_days: listDays,
  switch_day: switchDay,
  add_day: addDay,
  delete_day: deleteDay,
  set_targets: setTargets
};

module.exports = { CALLS, savedFoodsNote };
