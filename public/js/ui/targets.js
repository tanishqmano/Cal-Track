/* The eight target boxes under Settings. */

import { $ } from '../lib/dom.js';
import { TARGET_FIELDS } from '../config/nutrition.js';
import { TARGETS } from '../state/log.js';

// Boxes are built once and then only refilled, so the fields keep their place
// while Settings is open.
export function renderTargets() {
  const box = $('tgts');
  if (!box.children.length) {
    box.innerHTML = TARGET_FIELDS.map(f => `
      <div class="tgt">
        <label for="t_${f.k}">${f.name}</label>
        <div class="in">
          <input id="t_${f.k}" type="number" min="1" step="${f.step}" inputmode="decimal">
          <span class="u">${f.unit}</span>
        </div>
      </div>`).join('');
  }
  for (const f of TARGET_FIELDS) {
    const el = $('t_' + f.k);
    // render() also runs when another device syncs. Never rewrite the box
    // someone is halfway through typing into.
    if (el !== document.activeElement) el.value = TARGETS[f.k];
  }
}
