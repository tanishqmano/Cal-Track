'use strict';

/**
 * Configuration, from .env first and real environment variables second.
 *
 * Everything else in the server reads settings through pick(), so there is one
 * place that knows where a value came from and one place that cleans it up.
 */

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./paths');

function loadEnv(file) {
  const out = {};
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = loadEnv(path.join(ROOT, '.env'));

// Values pasted into a hosting dashboard often arrive wrapped in quotes or with
// a stray space on the end, and an API key or passphrase that is wrong by one
// invisible character fails in a way nobody can see. The .env parser already
// unwraps quotes; do the same for real environment variables so both sources
// behave alike.
function clean(v) {
  if (typeof v !== 'string') return '';
  let s = v.trim();
  if (s.length > 1 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

const pick = k => clean(env[k]) || clean(process.env[k]) || '';

module.exports = { pick, clean };
