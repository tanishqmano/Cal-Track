/* The card at the top: four macro bars, the micronutrient strip, and the notes. */

import { $ } from '../lib/dom.js';
import { g, r1 } from '../lib/numbers.js';
import { MICROS } from '../config/nutrition.js';
import { day, dayTotals, TARGETS } from '../state/log.js';

function statBlock(name, used, target, unit) {
  const left = r1(target - used);
  const pct = target > 0 ? Math.min(100, (used / target) * 100) : 0;
  const over = left < 0;
  return `
    <div class="stat">
      <div class="stat-top">
        <div class="stat-name">${name}</div>
        <div class="stat-val num"><b>${g(used)}</b> <span>/ ${target} ${unit}</span></div>
      </div>
      <div class="bar"><i class="${over ? 'over' : ''}" style="width:${pct}%"></i></div>
      <div class="stat-top" style="margin:4px 0 0">
        <div style="flex:1"></div>
        <div class="stat-left num ${over ? 'over' : ''}">${over ? g(-left) + ' ' + unit + ' over' : g(left) + ' ' + unit + ' left'}</div>
      </div>
    </div>`;
}

// Minerals get a compact strip rather than a full bar each — they matter, but
// not enough to push the four macros off a phone screen.
function microBlock(m, used) {
  const target = TARGETS[m.k];
  const pct = Math.min(100, (used / target) * 100);
  const done = used >= target;
  return `
    <div class="ms">
      <div class="ms-top">
        <span class="ms-name">${m.name}</span>
        <span class="num"><b>${g(used)}</b><span class="ms-t">/${target}</span></span>
      </div>
      <div class="bar"><i class="${done ? 'done' : ''}" style="width:${pct}%"></i></div>
    </div>`;
}

export function renderTotals() {
  const items = day().items;
  const t = dayTotals();

  const notes = [];
  if (items.length) {
    if (t.f > TARGETS.f) notes.push(`<div class="note warn">Fat ${g(t.f - TARGETS.f)} g over</div>`);
    if (t.c < TARGETS.c) notes.push(`<div class="note">Carbs ${g(TARGETS.c - t.c)} g short</div>`);
    // Only once most of the day's calories are spent does a mineral gap mean
    // anything — before that everything is "short" and the note is noise.
    if (t.cal >= TARGETS.cal * 0.75) {
      for (const m of MICROS) {
        if (t[m.k] < TARGETS[m.k] * 0.6) {
          notes.push(`<div class="note warn">${m.name} low — ${g(TARGETS[m.k] - t[m.k])} ${m.unit} to go</div>`);
        }
      }
    }
  }

  $('totals').innerHTML =
    statBlock('Calories', t.cal, TARGETS.cal, 'kcal') +
    statBlock('Protein', t.p, TARGETS.p, 'g') +
    statBlock('Fat', t.f, TARGETS.f, 'g') +
    statBlock('Carbs', t.c, TARGETS.c, 'g') +
    `<div class="micros">${MICROS.map(m => microBlock(m, t[m.k])).join('')}</div>` +
    (notes.length ? `<div class="notes">${notes.join('')}</div>` : '');
}
