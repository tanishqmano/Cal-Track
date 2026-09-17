/* The three tools the model can call, in Anthropic's schema shape.
 *
 * api/adapter.js re-wraps these for the OpenAI wire format; the JSON Schema
 * inside is identical either way, so the definitions themselves are shared. */

import { MEALS } from './nutrition.js';

export const LOG_TOOL = {
  name: 'log_items',
  description: 'Return the estimated macros for every food item the user described.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'One entry per distinct food item.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short label including the quantity in grams, e.g. "50 g oats", "1 scoop (30 g) whey", "6 oz (170 g) chicken breast". Convert ounces, pounds and cups to grams and keep the gram figure in the label.' },
            calories: { type: 'number', description: 'Total kcal for the quantity described.' },
            protein: { type: 'number', description: 'Protein in grams. MUST be 0 unless protein_source is "complete".' },
            fat: { type: 'number', description: 'Fat in grams for the quantity described.' },
            carbs: { type: 'number', description: 'Carbohydrate in grams for the quantity described.' },
            protein_source: { type: 'string', enum: ['complete', 'incomplete', 'none'], description: 'Whether the protein in this food comes from a complete source.' },
            zinc: { type: 'number', description: 'Zinc in mg for the quantity described. Counts from plant foods too.' },
            iron: { type: 'number', description: 'Iron in mg for the quantity described. Counts from plant foods too.' },
            magnesium: { type: 'number', description: 'Magnesium in mg for the quantity described. Counts from plant foods too.' },
            vitamin_c: { type: 'number', description: 'Vitamin C in mg AFTER the cooking loss for how this food was prepared. 0 for all grains, bread, pasta, beans, dals, nuts, meat, fish, egg, dairy and fats.' },
            meal: { type: 'string', enum: MEALS, description: 'Required. If the user named a meal anywhere in their message ("for breakfast", "at lunch", "dinner was"), use that one. Only fall back to default_meal from <current_log> when they named none.' }
          },
          required: ['name', 'calories', 'protein', 'fat', 'carbs', 'protein_source', 'zinc', 'iron', 'magnesium', 'vitamin_c', 'meal']
        }
      }
    },
    required: ['items']
  }
};

export const EDIT_TOOL = {
  name: 'edit_items',
  description: 'Correct one or more items already logged today. Only send the fields that change.',
  input_schema: {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The id shown in square brackets in <current_log>.' },
            name: { type: 'string', description: 'New label including the new quantity.' },
            calories: { type: 'number' },
            protein: { type: 'number', description: 'Only send if protein changes. Requires protein_source alongside it.' },
            fat: { type: 'number' },
            carbs: { type: 'number' },
            protein_source: { type: 'string', enum: ['complete', 'incomplete', 'none'] },
            zinc: { type: 'number', description: 'New zinc in mg. Send whenever the quantity or the food changes.' },
            iron: { type: 'number', description: 'New iron in mg. Send whenever the quantity or the food changes.' },
            magnesium: { type: 'number', description: 'New magnesium in mg. Send whenever the quantity or the food changes.' },
            vitamin_c: { type: 'number', description: 'New vitamin C in mg after cooking loss. Send whenever the quantity, the food, or the cooking method changes.' },
            meal: { type: 'string', enum: MEALS }
          },
          required: ['id']
        }
      }
    },
    required: ['edits']
  }
};

export const DELETE_TOOL = {
  name: 'delete_items',
  description: 'Remove one or more items already logged today.',
  input_schema: {
    type: 'object',
    properties: {
      ids: {
        type: 'array',
        description: 'Ids shown in square brackets in <current_log>.',
        items: { type: 'string' }
      }
    },
    required: ['ids']
  }
};

export const TOOLS = [LOG_TOOL, EDIT_TOOL, DELETE_TOOL];
