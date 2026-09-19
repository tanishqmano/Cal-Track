/* What is tracked, and what counts as "enough" by default. */

// Two different kinds of number live in here.
//
// Calories and macros are this person's own goals, not a public reference, so
// "Restore defaults" puts back what they actually eat to rather than a generic
// figure. They are consistent by design: 130x4 + 75x9 + 325x4 = 2495 kcal,
// which is the same arithmetic the model is told to check its estimates
// against in public/js/config/prompts.js. Change one and change the rest, or
// the targets start disagreeing with themselves.
//
// Micronutrients are the US RDAs for an adult man 19-50.
// Adult woman: zn 8, fe 18, mg 310, vc 75.
//
// These used to be the ICMR-NIN 2020 Indian numbers (zn 17, fe 19, mg 440),
// which run higher on purpose: a rice/dal/millet diet is heavy in phytate,
// which blocks zinc and iron, so more has to go in for enough to be absorbed.
// A US diet has far less phytate and far more meat and fortified grain, so the
// US figures are the right bar here. Go back to the Indian ones if the cooking
// goes back to being mostly rice, dal and millet.
export const DEFAULT_TARGETS = { cal: 2500, p: 130, f: 75, c: 325, zn: 11, fe: 8, mg: 400, vc: 90 };

export const MICROS = [
  { k: 'zn', name: 'Zinc',      unit: 'mg' },
  { k: 'fe', name: 'Iron',      unit: 'mg' },
  { k: 'mg', name: 'Magnesium', unit: 'mg' },
  { k: 'vc', name: 'Vitamin C', unit: 'mg' }
];

// One row per editable target. `dec` marks the ones worth a decimal place —
// 17.5 mg of zinc is a real setting, 2150.5 kcal is not.
export const TARGET_FIELDS = [
  { k: 'cal', name: 'Calories', unit: 'kcal', step: 10, dec: false },
  { k: 'p',   name: 'Protein',  unit: 'g',    step: 5,  dec: false },
  { k: 'f',   name: 'Fat',      unit: 'g',    step: 5,  dec: false },
  { k: 'c',   name: 'Carbs',    unit: 'g',    step: 5,  dec: false }
].concat(MICROS.map(m => ({
  k: m.k, name: m.name, unit: m.unit,
  step: m.k === 'mg' ? 10 : 1,
  dec: m.k !== 'mg'
})));

export const MEALS = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];
