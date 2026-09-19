/* What the model is told about the day, in the two places it is told:
 * <current_log> on the way in, and the totals line on the way back out of a
 * tool call. */

import { g } from '../lib/numbers.js';
import { hourIn } from '../lib/clock.js';
import { state, day, dayTotals, TARGETS } from '../state/log.js';

// Same boundaries as defaultMeal() in src/mcp/log.js. If these move, move them
// there too, or the app and the connector will file the same plate differently.
export function defaultMeal() {
  const h = hourIn(state.tz);
  return h < 11 ? 'Breakfast' : h < 16 ? 'Lunch' : h < 18 ? 'Snack' : 'Dinner';
}

// Snapshot of the day, handed to the model on every turn so it never has to
// ask what has already been logged. Injected into the current user message
// only — never stored in history, so it can't go stale.
export function stateBlock() {
  const items = day().items;
  const t = dayTotals();
  const lines = items.length
    ? items.map(i => `- [${i.id}] ${i.meal} | ${i.name} | ${i.cal} kcal | P ${g(i.p)} | F ${g(i.f)} | C ${g(i.c)} | Zn ${g(i.zn)} | Fe ${g(i.fe)} | Mg ${g(i.mg)} | VitC ${g(i.vc)}`).join('\n')
    : '(nothing logged yet)';
  return `<current_log day="${day().label}" default_meal="${defaultMeal()}">
Grams: P protein, F fat, C carbs. Milligrams: Zn zinc, Fe iron, Mg magnesium, VitC vitamin C.
Targets:   ${TARGETS.cal} kcal | P ${TARGETS.p} | F ${TARGETS.f} | C ${TARGETS.c} | Zn ${TARGETS.zn} | Fe ${TARGETS.fe} | Mg ${TARGETS.mg} | VitC ${TARGETS.vc}
Logged:    ${t.cal} kcal | P ${g(t.p)} | F ${g(t.f)} | C ${g(t.c)} | Zn ${g(t.zn)} | Fe ${g(t.fe)} | Mg ${g(t.mg)} | VitC ${g(t.vc)}
Remaining: ${g(TARGETS.cal - t.cal)} kcal | P ${g(TARGETS.p - t.p)} | F ${g(TARGETS.f - t.f)} | C ${g(TARGETS.c - t.c)} | Zn ${g(TARGETS.zn - t.zn)} | Fe ${g(TARGETS.fe - t.fe)} | Mg ${g(TARGETS.mg - t.mg)} | VitC ${g(TARGETS.vc - t.vc)}
Items:
${lines}
</current_log>`;
}

// Every tool result ends with this, so the model's confirmation quotes our
// arithmetic rather than its own.
export function totalsLine() {
  const t = dayTotals();
  return `Day total now ${t.cal} kcal | P ${g(t.p)} | F ${g(t.f)} | C ${g(t.c)} | ` +
         `Zn ${g(t.zn)} | Fe ${g(t.fe)} | Mg ${g(t.mg)} | VitC ${g(t.vc)}. ` +
         `Remaining ${g(TARGETS.cal - t.cal)} kcal | P ${g(TARGETS.p - t.p)} | F ${g(TARGETS.f - t.f)} | C ${g(TARGETS.c - t.c)} | ` +
         `Zn ${g(TARGETS.zn - t.zn)} | Fe ${g(TARGETS.fe - t.fe)} | Mg ${g(TARGETS.mg - t.mg)} | VitC ${g(TARGETS.vc - t.vc)}.`;
}
