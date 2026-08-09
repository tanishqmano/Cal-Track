'use strict';

/**
 * The startup summary.
 *
 * This is the whole diagnostic surface of the app: which store, which model,
 * whether the key arrived, whether the gate is up. A deployment that is wrong
 * is almost always wrong in one of those four ways.
 */

const os = require('os');
const { PROVIDER_NAME, provider, API_KEY } = require('./config/providers');
const { passphraseRequired } = require('./http/auth');
const { store, importFileLog } = require('./store');

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

async function printBanner(port) {
  const lan = lanAddress();
  console.log('');
  console.log('  Macro tracker running');
  console.log('  ---------------------');
  console.log('  This Mac:  http://localhost:' + port + '/');
  if (lan) console.log('  Phone:     http://' + lan + ':' + port + '/   (same Wi-Fi)');
  console.log('');

  // Reported, never fatal. An unreachable database still leaves a usable page:
  // devices fall back to their own cache until it answers again.
  let where = store.label;
  try {
    await importFileLog();
    const doc = await store.read();
    where += '  (rev ' + doc.rev + (doc.updated ? ', updated ' + doc.updated : ', empty') + ')';
  } catch (e) {
    where += '  UNREACHABLE: ' + e.message;
  }
  console.log('  Log:       ' + where + ' — shared by every device');
  console.log('  Provider:  ' + PROVIDER_NAME + '  (' + provider.format + ' wire format)');
  console.log('  Model:     ' + provider.model);
  if (API_KEY) {
    console.log('  API key:   loaded from .env (' + API_KEY.slice(0, 11) + '…) — stays on this machine');
  } else {
    console.log('  API key:   MISSING. Add ' + provider.keyName + ' to .env, then restart.');
  }
  if (passphraseRequired) {
    console.log('  Access:    passphrase required for the log and the API proxy');
  } else {
    console.log('  Access:    OPEN to anyone who can reach this address.');
    console.log('             Fine on home Wi-Fi. Set PASSPHRASE in .env before hosting this.');
  }
  console.log('');
  console.log('  Ctrl+C to stop.');
  console.log('');
}

module.exports = { printBanner, lanAddress };
