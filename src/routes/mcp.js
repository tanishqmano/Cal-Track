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
 *
 * This file is the transport and the lock on the door. What the tools are is in
 * src/mcp/schemas.js and what they do is in src/mcp/apply.js, the same split
 * the page keeps between public/js/config/tools.js and public/js/tools/apply.js.
 */

const crypto = require('crypto');
const { json, readBody } = require('../http/respond');
const { MAX_BODY_BYTES } = require('../config/limits');
const { pick } = require('../config/env');
const { TOOLS } = require('../mcp/schemas');
const { CALLS } = require('../mcp/apply');

// Claude stores a connector as a bare URL and cannot be told to send a custom
// header, so the secret has to ride in the path: /mcp/<token>. That is a bearer
// token in a URL, which is weaker than a header — it can end up in a proxy log.
// For one person's food diary that trade is worth it, but it is the reason this
// wants its own long random value rather than a reuse of PASSPHRASE, which is
// short and typed by hand.
const MCP_TOKEN = pick('MCP_TOKEN');
const TOKEN_HASH = MCP_TOKEN ? crypto.createHash('sha256').update(MCP_TOKEN).digest() : null;

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

/* ------------------------------------------------------------ the protocol -- */

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

async function dispatch(msg) {
  const { method, params, id } = msg;

  if (method === 'initialize') {
    const asked = params && params.protocolVersion;
    return {
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: 'macro-tracker', version: '1.1.0' }
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
