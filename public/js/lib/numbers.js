/* Number helpers — all arithmetic on stored (already rounded) values, in
   integer tenths, so displayed rows always sum exactly to the displayed
   totals. */

export const r0 = n => Math.round(Number(n) || 0);
export const r1 = n => Math.round((Number(n) || 0) * 10) / 10;
export const clamp0 = n => (n < 0 ? 0 : n);

export function sumCal(items) {
  let t = 0;
  for (const it of items) t += it.cal;
  return t;
}

export function sumG(items, k) {
  let tenths = 0;
  for (const it of items) tenths += Math.round(it[k] * 10);
  return tenths / 10;
}

// Show up to one decimal, trimming a trailing ".0".
export function g(n) {
  const v = r1(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
