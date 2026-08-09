'use strict';

/**
 * Picks the backend and exposes it as one `store`.
 *
 * Which one runs is a .env edit: STORE=file keeps the log beside the code,
 * STORE=mongo puts it in a database. Setting MONGODB_URI is enough on its own.
 * Nothing above this file knows the difference.
 */

const { pick } = require('../config/env');
const fileStore = require('./file-store');
const { mongoStore, MONGO_URI } = require('./mongo-store');

const STORE_NAME = (pick('STORE') || (MONGO_URI ? 'mongo' : 'file')).toLowerCase();

let store = fileStore;
if (STORE_NAME === 'mongo') {
  if (MONGO_URI) store = mongoStore;
  else console.warn('  STORE=mongo but MONGODB_URI is empty — falling back to the file store.');
}

// Moving to Mongo should not mean retyping a week of meals. If the database is
// empty and a file log exists, carry it over once, on startup.
async function importFileLog() {
  if (store !== mongoStore) return;
  const existing = await store.read();
  if (existing.rev !== 0) return;

  const local = await fileStore.read();
  if (local.rev === 0 || !local.state) return;

  const res = await store.commit(local.state, 0, false);
  if (res.ok) {
    console.log('  Imported data/state.json into MongoDB (now rev ' + res.doc.rev + ').');
  }
}

module.exports = { store, importFileLog };
