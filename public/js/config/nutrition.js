/* What is tracked, and what counts as "enough" by default. */

// Micronutrient targets are ICMR-NIN 2020 RDAs for an Indian adult man. The
// minerals run higher than US RDAs (Zn 11, Fe 8, Mg 400) on purpose: a
// rice/dal/millet diet is high in phytate, which blocks zinc and iron
// absorption, so the intake needed to absorb enough is larger.
// Adult woman: zn 13.2, fe 29, mg 370, vc 80.
export const DEFAULT_TARGETS = { cal: 2150, p: 110, f: 65, c: 280, zn: 17, fe: 19, mg: 440, vc: 80 };

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
