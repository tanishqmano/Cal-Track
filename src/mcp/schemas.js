'use strict';

/**
 * What Claude sees when it asks the connector what it can do.
 *
 * The page keeps its own tool definitions apart from their implementations,
 * in public/js/config/tools.js and public/js/tools/apply.js; this is the same
 * split for the connector. The descriptions are the only instructions Claude
 * gets about this tracker, so they carry the house rules — the complete-protein
 * one especially — rather than leaving them to be discovered by being broken.
 */

const { MEALS } = require('./log');

// Named the same way in every tool that takes one, so Claude learns the shape
// once. `meal` is deliberately not required outside log_food: an edit that does
// not mention the meal should leave it where it is.
const ITEM_FIELDS = {
  name: { type: 'string', description: 'Short label including the quantity in grams, e.g. "50 g oats", "1 scoop (30 g) whey", "6 oz (170 g) chicken breast". Convert ounces, pounds and cups to grams and keep the gram figure in the label.' },
  calories: { type: 'number', description: 'Total kcal for the quantity described.' },
  protein: { type: 'number', description: 'Protein in grams. Stored as 0 unless protein_source is "complete".' },
  fat: { type: 'number', description: 'Fat in grams for the quantity described.' },
  carbs: { type: 'number', description: 'Carbohydrate in grams for the quantity described.' },
  protein_source: { type: 'string', enum: ['complete', 'incomplete', 'none'], description: 'Whether the protein in this food comes from a complete source. Grains, bread, pasta, beans, dals, tofu and nuts are "incomplete".' },
  zinc: { type: 'number', description: 'Zinc in mg. Counts from plant foods too.' },
  iron: { type: 'number', description: 'Iron in mg. Counts from plant foods too.' },
  magnesium: { type: 'number', description: 'Magnesium in mg. Counts from plant foods too.' },
  vitamin_c: { type: 'number', description: 'Vitamin C in mg AFTER cooking loss. 0 for all grains, bread, pasta, beans, dals, nuts, meat, fish, egg, dairy and fats.' },
  meal: { type: 'string', enum: MEALS, description: 'Which meal this belongs to. Use what the user said; guess from the time of day only if they said nothing.' }
};

// Every tool that acts on one day takes these two, and neither is required:
// saying nothing means the day the tracker is open on, which is what "today"
// means to the person asking.
const DAY_PICKER = {
  label: { type: 'string', description: 'The day\'s label as list_days shows it, e.g. "Day 3". Omit for the day the tracker is currently on.' },
  position: { type: 'number', description: 'The day\'s position as list_days numbers them, counting from 1. Only needed when two days share a label.' }
};

/* ---------------------------------------------------------------- items -- */

const LOG_FOOD = {
  name: 'log_food',
  description:
    'Write food into the tracker. Estimate the macros yourself from the photo or description first, ' +
    'then send one entry per distinct item. Say what you logged and the running day total afterwards.',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'One entry per distinct food item.',
        items: {
          type: 'object',
          properties: ITEM_FIELDS,
          required: ['name', 'calories', 'protein', 'fat', 'carbs', 'protein_source', 'zinc', 'iron', 'magnesium', 'vitamin_c', 'meal']
        }
      },
      label: DAY_PICKER.label,
      position: DAY_PICKER.position
    },
    required: ['items']
  }
};

const READ_LOG = {
  name: 'read_log',
  description:
    'Read what is logged for a day, with totals and how much of each target is left. ' +
    'Call this before answering questions about how much is left, and before editing or deleting anything — ' +
    'the item ids it returns are what edit_food and delete_food take.',
  inputSchema: { type: 'object', properties: Object.assign({}, DAY_PICKER) }
};

const EDIT_FOOD = {
  name: 'edit_food',
  description:
    'Correct an item that is already logged — a wrong quantity, the wrong meal, a bad estimate. ' +
    'Send only the fields that change; everything else is left alone. ' +
    'Call read_log first to get the ids.',
  inputSchema: {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        description: 'One entry per item being corrected.',
        items: {
          type: 'object',
          properties: Object.assign({ id: { type: 'string', description: 'The id shown in square brackets by read_log.' } }, ITEM_FIELDS, {
            protein: { type: 'number', description: 'Only send if the protein changes, and send protein_source alongside it — protein is stored as 0 without a "complete" source.' },
            meal: { type: 'string', enum: MEALS, description: 'Only send to move the item to a different meal.' }
          }),
          required: ['id']
        }
      },
      label: DAY_PICKER.label,
      position: DAY_PICKER.position
    },
    required: ['edits']
  }
};

const DELETE_FOOD = {
  name: 'delete_food',
  description:
    'Remove items from a day by id. Only call this when the user has actually asked for something to be removed — ' +
    'never to "replace" an item, which is what edit_food is for.',
  inputSchema: {
    type: 'object',
    properties: Object.assign({
      ids: { type: 'array', description: 'Ids as shown by read_log.', items: { type: 'string' } }
    }, DAY_PICKER),
    required: ['ids']
  }
};

/* ----------------------------------------------------------------- days -- */

const LIST_DAYS = {
  name: 'list_days',
  description:
    'List every day in the tracker with its position, its item count and its calorie total, ' +
    'and say which one is currently open. Call this before switching or deleting a day.',
  inputSchema: { type: 'object', properties: {} }
};

const SWITCH_DAY = {
  name: 'switch_day',
  description:
    'Open a different day. This is the day the tracker shows on every device, and the one the other ' +
    'tools act on when no day is named, so switch before logging into an earlier day rather than ' +
    'naming it on every call.',
  inputSchema: { type: 'object', properties: Object.assign({}, DAY_PICKER) }
};

const ADD_DAY = {
  name: 'add_day',
  description:
    'Start a new empty day and open it. Numbered after the highest day already in the log. ' +
    'Use this at the start of a new day of eating, not to fix a mistake.',
  inputSchema: { type: 'object', properties: {} }
};

const DELETE_DAY = {
  name: 'delete_day',
  description:
    'Delete a whole day and everything logged in it, on every device. This cannot be undone. ' +
    'Ask the user to confirm in words first, then send the exact label along with confirm: true.',
  inputSchema: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'The exact label of the day to delete, e.g. "Day 3". Required — the current day is not assumed for a deletion.' },
      position: DAY_PICKER.position,
      confirm: { type: 'boolean', description: 'Must be true, and only after the user has said yes to losing that day.' }
    },
    required: ['label', 'confirm']
  }
};

/* -------------------------------------------------------------- targets -- */

const SET_TARGETS = {
  name: 'set_targets',
  description:
    'Change the daily targets the tracker measures against. These are one shared setting, not per-day, ' +
    'and they show up on every device. Send only the ones that change; each must be greater than zero. ' +
    'Call read_log first to see what they currently are.',
  inputSchema: {
    type: 'object',
    properties: {
      calories: { type: 'number', description: 'Daily kcal target.' },
      protein: { type: 'number', description: 'Daily protein target in grams.' },
      fat: { type: 'number', description: 'Daily fat target in grams.' },
      carbs: { type: 'number', description: 'Daily carbohydrate target in grams.' },
      zinc: { type: 'number', description: 'Daily zinc target in mg.' },
      iron: { type: 'number', description: 'Daily iron target in mg.' },
      magnesium: { type: 'number', description: 'Daily magnesium target in mg.' },
      vitamin_c: { type: 'number', description: 'Daily vitamin C target in mg.' }
    }
  }
};

const TOOLS = [LOG_FOOD, READ_LOG, EDIT_FOOD, DELETE_FOOD, LIST_DAYS, SWITCH_DAY, ADD_DAY, DELETE_DAY, SET_TARGETS];

module.exports = { TOOLS };
