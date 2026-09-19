/* The timezone picker under Settings. */

import { $ } from '../lib/dom.js';
import { TIMEZONES } from '../config/timezones.js';
import { timeIn, deviceZone } from '../lib/clock.js';
import { state } from '../state/log.js';
import { defaultMeal } from '../tools/context.js';

// Built once and then only refilled, the same way renderTargets() does it, so
// the box keeps its place while Settings is open.
export function renderTimezone() {
  const sel = $('tzSel');
  if (!sel.children.length) {
    const dev = deviceZone();
    sel.innerHTML = TIMEZONES.map(z => {
      const label = z.id === '' && dev ? `${z.name} (${dev})` : z.name;
      return `<option value="${z.id}">${label}</option>`;
    }).join('');
  }

  // A zone set from the server's LOG_TZ, or by an older version, may not be one
  // of the offered names. Show it rather than silently snapping to the first
  // option, which would misreport what the connector is actually using.
  const cur = state.tz || '';
  if (cur && !TIMEZONES.some(z => z.id === cur)) {
    if (!sel.querySelector(`option[value="${cur}"]`)) {
      sel.insertAdjacentHTML('beforeend', `<option value="${cur}">${cur}</option>`);
    }
  }
  if (sel !== document.activeElement) sel.value = cur;

  // The zone name is hard to check by eye; the time is not.
  const now = timeIn(cur);
  $('tzNow').textContent = now
    ? `${now} there now, so a meal logged without one would go in as ${defaultMeal()}.`
    : '';
}
