'use strict';

/**
 * Token meter.
 *
 * Every reply carries a usage block that the page discards. Adding it up here
 * is the only spend figure available without logging into a dashboard, and on
 * a free tier the tokens are the thing that runs out first.
 *
 * Counts reset when the process does — this answers "what is this costing me",
 * not "what have I used this month". The provider's own page is the record.
 */

const meter = { calls: 0, input: 0, output: 0, total: 0 };

// Returns what this one call used, or null for a body with no usage block —
// an error response, or a shape we don't know.
function meterAdd(text) {
  let u;
  try { u = (JSON.parse(text) || {}).usage; } catch { return null; }
  if (!u) return null;
  const input = u.prompt_tokens || u.input_tokens || 0;
  const output = u.completion_tokens || u.output_tokens || 0;
  // Gemini bills thinking tokens that appear in neither count, so `total` is
  // the honest number and is usually larger than input + output.
  const total = u.total_tokens || input + output;
  meter.calls += 1;
  meter.input += input;
  meter.output += output;
  meter.total += total;
  return { input, output, total };
}

function logUsage(used) {
  const think = used.total - used.input - used.output;
  console.log(
    '  tokens  +' + used.total + '  (in ' + used.input + ', out ' + used.output +
    (think > 0 ? ', thinking ' + think : '') + ')' +
    '   session ' + meter.total + ' over ' + meter.calls + ' calls'
  );
}

module.exports = { meter, meterAdd, logUsage };
