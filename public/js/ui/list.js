/* The logged items, grouped by meal. Rendering only — the buttons it draws are
 * handled by actions/items.js. */

import { $, esc } from '../lib/dom.js';
import { g, sumCal, sumG } from '../lib/numbers.js';
import { MEALS } from '../config/nutrition.js';
import { day } from '../state/log.js';
import { editingId } from '../state/session.js';

function numsHtml(cal, p, f, c) {
  return `<div class="nums num">
    <div class="n"><span class="lbl">kcal</span>${g(cal)}</div>
    <div class="n"><span class="lbl">P</span>${g(p)}</div>
    <div class="n"><span class="lbl">F</span>${g(f)}</div>
    <div class="n"><span class="lbl">C</span>${g(c)}</div>
  </div>`;
}

// Second, quieter line. Omitted entirely when a food has no minerals worth
// showing (oil, sugar) so rows stay short.
function microHtml(it) {
  if (!(it.zn || it.fe || it.mg || it.vc)) return '';
  return `<div class="micro num">Zn ${g(it.zn)} · Fe ${g(it.fe)} · Mg ${g(it.mg)} · C ${g(it.vc)}</div>`;
}

function rowHtml(it) {
  if (it.id === editingId) {
    return `<div class="row" data-id="${it.id}">
      <div class="edit">
        <input type="text" data-e="name" value="${esc(it.name)}" aria-label="Name">
        <label class="fld">kcal <input class="num-in" data-e="cal" type="number" step="1" min="0" value="${it.cal}"></label>
        <label class="fld">P <input class="num-in" data-e="p" type="number" step="0.1" min="0" value="${it.p}"></label>
        <label class="fld">F <input class="num-in" data-e="f" type="number" step="0.1" min="0" value="${it.f}"></label>
        <label class="fld">C <input class="num-in" data-e="c" type="number" step="0.1" min="0" value="${it.c}"></label>
        <label class="fld">Zn <input class="num-in" data-e="zn" type="number" step="0.1" min="0" value="${it.zn}"></label>
        <label class="fld">Fe <input class="num-in" data-e="fe" type="number" step="0.1" min="0" value="${it.fe}"></label>
        <label class="fld">Mg <input class="num-in" data-e="mg" type="number" step="1" min="0" value="${it.mg}"></label>
        <label class="fld">C <input class="num-in" data-e="vc" type="number" step="0.1" min="0" value="${it.vc}"></label>
        <select data-e="meal">${MEALS.map(m => `<option${m === it.meal ? ' selected' : ''}>${m}</option>`).join('')}</select>
        <button class="btn primary" data-act="save">Save</button>
        <button class="btn ghost" data-act="cancel">Cancel</button>
      </div>
    </div>`;
  }
  return `<div class="row" data-id="${it.id}">
    <div class="nm">${esc(it.name)}</div>
    ${numsHtml(it.cal, it.p, it.f, it.c)}
    ${microHtml(it)}
    <div class="acts">
      <button class="btn ghost" data-act="edit" aria-label="Edit">✎</button>
      <button class="btn ghost" data-act="del" aria-label="Delete">✕</button>
    </div>
  </div>`;
}

export function renderList() {
  const items = day().items;
  if (!items.length) {
    $('list').innerHTML = `<div class="empty">Nothing logged yet.</div>`;
    return;
  }

  const head = `<div class="colhead">
      <div></div>
      <div class="nums"><div class="n">kcal</div><div class="n">P</div><div class="n">F</div><div class="n">C</div></div>
      <div class="spacer"></div>
    </div>`;

  let html = head;
  for (const meal of MEALS) {
    const group = items.filter(i => i.meal === meal);
    if (!group.length) continue;
    const zn = sumG(group, 'zn'), fe = sumG(group, 'fe'), mgm = sumG(group, 'mg'), vc = sumG(group, 'vc');
    html += `<div class="meal">
      <div class="meal-head">
        <div class="meal-name">${meal}</div>
        <div class="meal-sub num">${g(sumCal(group))} kcal · P ${g(sumG(group, 'p'))} · F ${g(sumG(group, 'f'))} · C ${g(sumG(group, 'c'))}${
          (zn || fe || mgm || vc) ? `<span class="meal-min"> · Zn ${g(zn)} · Fe ${g(fe)} · Mg ${g(mgm)} · C ${g(vc)}</span>` : ''}</div>
      </div>
      ${group.map(rowHtml).join('')}
    </div>`;
  }
  $('list').innerHTML = html;
}
