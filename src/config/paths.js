'use strict';

/**
 * Every path the server touches, resolved once from this file's own location so
 * it does not matter which directory `node server.js` was run from.
 */

const path = require('path');

// src/config → src → project root
const ROOT = path.join(__dirname, '..', '..');

// The only directory reachable over HTTP. .env, data/ and src/ all sit outside
// it, so nothing but the page and its assets can be requested.
const PUBLIC_DIR = path.join(ROOT, 'public');

const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

module.exports = { ROOT, PUBLIC_DIR, DATA_DIR, STATE_FILE };
