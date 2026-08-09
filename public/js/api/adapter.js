/* The only place the wire format shows up.
 *
 * Everything outside this file works on the normalised {text, calls, raw}
 * shape these functions return, so adding a provider means editing here and
 * nowhere else. */

import { TOOLS } from '../config/tools.js';
import { chatSystem } from '../config/prompts.js';
import { format, MODEL } from './config.js';

// OpenAI wraps each schema in a "function" envelope; the JSON Schema inside is
// identical, so the tool definitions themselves are shared.
const OPENAI_TOOLS = TOOLS.map(t => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.input_schema }
}));

export function buildPayload(messages) {
  if (format === 'anthropic') {
    // The tools + system block is ~5k tokens and identical on every request.
    // One cache breakpoint on the system block covers both (tools are ordered
    // before system), so a follow-up re-reads them at a tenth of the price.
    return {
      model: MODEL,
      max_tokens: 1500,
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: chatSystem(), cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages
    };
  }
  return {
    model: MODEL,
    max_tokens: 1500,
    // This is estimation, not writing. Keep sampling tight so the same food
    // logged twice does not come back with different numbers.
    temperature: 0.2,
    top_p: 0.9,
    // Nemotron toggles its reasoning trace off with this exact phrase. Other
    // OpenAI-compatible models ignore the line harmlessly.
    messages: [{ role: 'system', content: 'detailed thinking off\n\n' + chatSystem() }].concat(messages),
    tools: OPENAI_TOOLS,
    tool_choice: 'auto'
  };
}

// Reasoning models leak their scratchpad into the reply as <think> blocks.
// Strip them so the user sees the answer, not the working.
function stripThink(s) {
  return String(s || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .trim();
}

export function normalize(data) {
  if (format === 'anthropic') {
    const content = data.content || [];
    return {
      raw: content,
      text: content.filter(b => b.type === 'text').map(b => b.text).join('').trim(),
      calls: content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input }))
    };
  }
  const m = (data.choices && data.choices[0] && data.choices[0].message) || {};
  const calls = (m.tool_calls || []).map(tc => {
    let input = {};
    // OpenAI sends arguments as a JSON *string*. A truncated or malformed one
    // must not take down the turn — an empty input is handled downstream.
    try { input = JSON.parse((tc.function && tc.function.arguments) || '{}'); } catch (e) { input = {}; }
    return { id: tc.id, name: (tc.function && tc.function.name) || '', input };
  });
  return { raw: m, text: stripThink(m.content), calls };
}

// Append this hop's assistant turn plus its tool results, so the next hop sees
// what was already run.
export function pushToolTurn(msgs, norm, results) {
  if (format === 'anthropic') {
    msgs.push({ role: 'assistant', content: norm.raw });
    msgs.push({ role: 'user', content: results.map(r => {
      const b = { type: 'tool_result', tool_use_id: r.id, content: r.content };
      if (r.isError) b.is_error = true;
      return b;
    }) });
    return;
  }
  msgs.push({ role: 'assistant', content: norm.raw.content || '', tool_calls: norm.raw.tool_calls });
  for (const r of results) msgs.push({ role: 'tool', tool_call_id: r.id, content: r.content });
}
