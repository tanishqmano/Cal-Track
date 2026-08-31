'use strict';

/**
 * POST /mcp — the phone's way in.
 *
 * The page at / is a person typing. This is Claude calling from the app on a
 * phone, usually with a photo of a plate attached. Claude reads the photo
 * itself and works out the macros; all this endpoint does is write them down.
 *
 * That split is the point. The estimate never touches /api/parse, so logging a
 * meal by photo costs nothing against the Gemini free tier — the thinking is
 * already paid for by the Claude subscription that took the picture.
 *
 * The wire format is MCP over Streamable HTTP: JSON-RPC 2.0 in the body, one
 * response object back. A connector only ever needs four methods, so that is
 * all this speaks — initialize, the initialized notification, tools/list and
 * tools/call.
 */

const crypto = require('crypto');
const { json, readBody } = require('../http/respond');
const { MAX_BODY_BYTES } = require('../config/limits');
const { pick } = require('../config/env');
const { store } = require('../store');

// Claude stores a connector as a bare URL and cannot be told to send a custom
// header, so the secret has to ride in the path: /mcp/<token>. That is a bearer
// token in a URL, which is weaker than a header — it can end up in a proxy log.
// For one person's food diary that trade is worth it, but it is the reason this
// wants its own long random value rather than a reuse of PASSPHRASE, which is
// short and typed by hand.
const MCP_TOKEN = pick('MCP_TOKEN');
const TOKEN_HASH = MCP_TOKEN ? crypto.createHash('sha256').update(MCP_TOKEN).digest() : null;

// Render runs in UTC; the person eating does not. Without this, dinner at 8pm
// in Chennai arrives at 14:30 UTC and gets filed under Lunch. Set it to 330 for
// IST. Only consulted when Claude does not name a meal itself.
const UTC_OFFSET_MIN = Number(pick('LOG_UTC_OFFSET_MIN')) || 0;

const MEALS = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];

// The same rounding the page applies in public/js/lib/numbers.js. Duplicated
// rather than shared because that file is browser ESM and this is CommonJS;
// four one-liners is a smaller price than a build step.
const clamp0 = n => (Number.isFinite(n) && n > 0 ? n : 0);
const r0 = n => Math.round(Number(n) || 0);
const r1 = n => Math.round((Number(n) || 0) * 10) / 10;
const uid = () => Math.random().toString(36).slice(2, 10);

function defaultMeal() {
  const h = new Date(Date.now() + UTC_OFFSET_MIN * 60 * 1000).getUTCHours();
  return h < 11 ? 'Breakfast' : h < 16 ? 'Lunch' : h < 18 ? 'Snack' : 'Dinner';
}

function tokenOk(req, pathToken) {
  if (!TOKEN_HASH) return false;
  // A header is the cleaner channel when the client can send one, so accept it
  // too — Claude Code and the mcp CLI both can, and then the URL stays clean.
  const auth = req.headers.authorization;
  const sent = (typeof auth === 'string' && auth.startsWith('Bearer ')) ? auth.slice(7) : pathToken;
  if (typeof sent !== 'string' || !sent) return false;
  const got = crypto.createHash('sha256').update(sent).digest();
  return crypto.timingSafeEqual(got, TOKEN_HASH);
}

/* ---------------------------------------------------------------- the log -- */

// A log that has never been written has state === null. Mirrors freshState()
// in public/js/state/log.js, minus the targets — leaving those out lets
// normalizeState() on the page fill them from its own defaults, so the two
// copies cannot disagree about what a target is.
const freshState = () => ({ v: 1, active: 0, targets: {}, targetsAt: 0, days: [{ id: uid(), label: 'Day 1', items: [], chat: [] }] });

// Read, change, write, and be ready to lose. Every writer here races the phone
// browser and the laptop, and store.commit() settles that by revision: a write
// from a revision someone else has already moved past is refused outright. The
// fix is always to re-read and redo the change on top of what landed, never to
// force — force is the Reset button, and it would eat the other device's meal.
async function mutate(change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await store.read();
    const state = cur.state && Array.isArray(cur.state.days) && cur.state.days.length
      ? cur.state
      : freshState();

    if (!(state.active >= 0 && state.active < state.days.length)) state.active = state.days.length - 1;
    const day = state.days[state.active];
    if (!Array.isArray(day.items)) day.items = [];

    const out = change(day, state);

    const res = await store.commit(state, cur.rev, false);
    if (res.ok) return out;
  }
  throw new Error('The log kept changing underneath this write. Try once more.');
}

function totalsFor(day) {
  const t = { cal: 0, p: 0, f: 0, c: 0, zn: 0, fe: 0, mg: 0, vc: 0 };
  for (const it of day.items) for (const k of Object.keys(t)) t[k] += Number(it[k]) || 0;
  for (const k of Object.keys(t)) t[k] = k === 'cal' ? Math.round(t[k]) : r1(t[k]);
  return t;
}

const totalsLine = day => {
  const t = totalsFor(day);
  return `Day total now ${t.cal} kcal | P ${t.p} | F ${t.f} | C ${t.c} | Zn ${t.zn} | Fe ${t.fe} | Mg ${t.mg} | VitC ${t.vc}.`;
};

/* -------------------------------------------------------------- the tools -- */

const TOOLS = [
  {
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
            properties: {
              name: { type: 'string', description: 'Short label including the quantity, e.g. "50 g oats" or "1 scoop (30 g) whey".' },
              calories: { type: 'number', description: 'Total kcal for the quantity described.' },
              protein: { type: 'number', description: 'Protein in grams. Stored as 0 unless protein_source is "complete".' },
              fat: { type: 'number', description: 'Fat in grams for the quantity described.' },
              carbs: { type: 'number', description: 'Carbohydrate in grams for the quantity described.' },
              protein_source: { type: 'string', enum: ['complete', 'incomplete', 'none'], description: 'Whether the protein in this food comes from a complete source. Grains, dals and nuts are "incomplete".' },
              zinc: { type: 'number', description: 'Zinc in mg. Counts from plant foods too.' },
              iron: { type: 'number', description: 'Iron in mg. Counts from plant foods too.' },
              magnesium: { type: 'number', description: 'Magnesium in mg. Counts from plant foods too.' },
              vitamin_c: { type: 'number', description: 'Vitamin C in mg AFTER cooking loss. 0 for all grains, dals, nuts, meat, fish, egg, dairy and fats.' },
              meal: { type: 'string', enum: MEALS, description: 'Which meal this belongs to. Use what the user said; guess from the time of day only if they said nothing.' }
            },
            required: ['name', 'calories', 'protein', 'fat', 'carbs', 'protein_source', 'zinc', 'iron', 'magnesium', 'vitamin_c', 'meal']
          }
        }
      },
      required: ['items']
    }
  },
  {
    name: 'read_log',
    description: 'Read what is already logged for the current day, with totals. Call this before answering questions about how much is left.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'delete_food',
    description: 'Remove items from the current day by id. Only call this when the user has actually asked for something to be removed.',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', description: 'Ids as shown by read_log.', items: { type: 'string' } } },
      required: ['ids']
    }
  }
];

async function logFood(input) {
  const raw = (input && input.items) || [];
  if (!Array.isArray(raw) || !raw.length) return 'No items were provided, so nothing was logged.';

  const fallback = defaultMeal();
  const added = raw.map(it => ({
    id: uid(),
    name: String(it.name || 'Item').slice(0, 120),
    meal: MEALS.includes(it.meal) ? it.meal : fallback,
    cal: clamp0(r0(it.calories)),
    // The page enforces this in public/js/tools/apply.js and so must this:
    // protein only counts from a complete source. Letting it through here
    // would put numbers in the log that the app's own rule would have zeroed,
    // and the two ways in would start disagreeing about the same plate.
    p: it.protein_source === 'complete' ? clamp0(r1(it.protein)) : 0,
    f: clamp0(r1(it.fat)),
    c: clamp0(r1(it.carbs)),
    zn: clamp0(r1(it.zinc)),
    fe: clamp0(r1(it.iron)),
    mg: clamp0(r0(it.magnesium)),
    vc: clamp0(r1(it.vitamin_c))
  }));

  // Only worth mentioning where protein was actually taken away — paired by
  // position, since two helpings of the same food share a name and matching on
  // that would report the wrong one.
  const zeroed = added.filter((a, i) => a.p === 0 && (Number(raw[i].protein) || 0) > 0).map(a => a.name);

  return await mutate(day => {
    for (const it of added) day.items.push(it);
    return [
      `Logged ${added.length} item(s): ${added.map(a => `${a.name} (${a.meal})`).join(', ')}.`,
      zeroed.length ? `Protein set to 0 for: ${zeroed.join(', ')} (not complete sources).` : '',
      totalsLine(day)
    ].filter(Boolean).join(' ');
  });
}

async function readLog() {
  const cur = await store.read();
  const state = cur.state;
  if (!state || !Array.isArray(state.days) || !state.days.length) return 'The log is empty — nothing has been tracked yet.';

  const day = state.days[Math.min(Math.max(state.active, 0), state.days.length - 1)];
  const items = Array.isArray(day.items) ? day.items : [];
  const t = totalsFor(day);
  const g = state.targets && Object.keys(state.targets).length ? state.targets : null;

  const lines = items.length
    ? items.map(i => `- [${i.id}] ${i.meal} | ${i.name} | ${i.cal} kcal | P ${i.p} | F ${i.f} | C ${i.c} | Zn ${i.zn} | Fe ${i.fe} | Mg ${i.mg} | VitC ${i.vc}`).join('\n')
    : '(nothing logged yet)';

  return [
    `${day.label}. Grams: P protein, F fat, C carbs. Milligrams: Zn, Fe, Mg, VitC.`,
    g ? `Targets:   ${g.cal} kcal | P ${g.p} | F ${g.f} | C ${g.c} | Zn ${g.zn} | Fe ${g.fe} | Mg ${g.mg} | VitC ${g.vc}` : '',
    `Logged:    ${t.cal} kcal | P ${t.p} | F ${t.f} | C ${t.c} | Zn ${t.zn} | Fe ${t.fe} | Mg ${t.mg} | VitC ${t.vc}`,
    g ? `Remaining: ${r1(g.cal - t.cal)} kcal | P ${r1(g.p - t.p)} | F ${r1(g.f - t.f)} | C ${r1(g.c - t.c)} | Zn ${r1(g.zn - t.zn)} | Fe ${r1(g.fe - t.fe)} | Mg ${r1(g.mg - t.mg)} | VitC ${r1(g.vc - t.vc)}` : '',
    'Items:',
    lines
  ].filter(Boolean).join('\n');
}

async function deleteFood(input) {
  const ids = (input && input.ids) || [];
  if (!Array.isArray(ids) || !ids.length) return 'No ids were provided, so nothing was deleted.';

  return await mutate(day => {
    const gone = [], missing = [];
    for (const id of ids) {
      const idx = day.items.findIndex(x => x.id === id);
      if (idx === -1) { missing.push(id); continue; }
      gone.push(day.items.splice(idx, 1)[0].name);
    }
    if (!gone.length) return `No item found with id(s): ${missing.join(', ')}. Nothing was deleted.`;
    return `Deleted: ${gone.join(', ')}.` + (missing.length ? ` Not found: ${missing.join(', ')}.` : '') + ' ' + totalsLine(day);
  });
}

const CALLS = { log_food: logFood, read_log: readLog, delete_food: deleteFood };

/* ------------------------------------------------------------ the protocol -- */

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

async function dispatch(msg) {
  const { method, params, id } = msg;

  if (method === 'initialize') {
    const asked = params && params.protocolVersion;
    return {
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: 'macro-tracker', version: '1.0.0' }
    };
  }

  if (method === 'tools/list') return { tools: TOOLS };

  if (method === 'tools/call') {
    const name = params && params.name;
    const fn = CALLS[name];
    if (!fn) return { content: [{ type: 'text', text: `No tool named "${name}".` }], isError: true };
    try {
      return { content: [{ type: 'text', text: await fn(params.arguments || {}) }] };
    } catch (e) {
      // Reported as a tool failure rather than a JSON-RPC error, so Claude sees
      // the reason and can tell the user, instead of the connector going dark.
      return { content: [{ type: 'text', text: 'Could not reach the log: ' + e.message }], isError: true };
    }
  }

  const err = new Error(`Method not found: ${method}`);
  err.code = -32601;
  throw err;
}

async function mcp(req, res, pathToken) {
  // No token set means the connector is off, not open. An endpoint that writes
  // to the diary must never be reachable just because someone guessed the path.
  if (!TOKEN_HASH) {
    return json(res, 503, { error: { message: 'MCP is off. Set MCP_TOKEN to switch it on.' } });
  }
  if (!tokenOk(req, pathToken)) {
    return json(res, 401, { error: { message: 'Bad or missing MCP token' } });
  }

  // The spec lets a server answer over SSE or plain JSON. This one has nothing
  // to push, so it only ever replies to a POST — a GET asking to open a stream
  // is told so rather than left hanging.
  if (req.method === 'GET') {
    return json(res, 405, { error: { message: 'This server does not open SSE streams. POST JSON-RPC instead.' } });
  }
  if (req.method !== 'POST') return json(res, 405, { error: { message: 'Use POST' } });

  let raw;
  try {
    raw = await readBody(req, MAX_BODY_BYTES);
  } catch (e) {
    return json(res, 413, { error: { message: e.message } });
  }

  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }

  // A JSON-RPC message with no id is a notification — notifications/initialized
  // is the one that arrives here. It wants no answer at all, and returning a
  // result object for it is a protocol error.
  if (msg && msg.id === undefined) {
    res.writeHead(202);
    return res.end();
  }

  try {
    const result = await dispatch(msg);
    return json(res, 200, { jsonrpc: '2.0', id: msg.id, result });
  } catch (e) {
    return json(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } });
  }
}

module.exports = { mcp };
