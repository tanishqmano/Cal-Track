'use strict';

/**
 * The log in MongoDB.
 *
 * Puts it somewhere reachable from outside the house, which is what hosting the
 * app requires: web hosts have throwaway disks, so a JSON file there would not
 * survive a restart.
 */

const { pick } = require('../config/env');
const { EMPTY_LOG, LOG_ID } = require('./shape');

const MONGO_URI = pick('MONGODB_URI');
const MONGO_DB = pick('MONGODB_DB') || 'macro-tracker';
const MONGO_COLLECTION = pick('MONGODB_COLLECTION') || 'logs';

const mongoStore = {
  label: 'MongoDB ' + MONGO_DB + '.' + MONGO_COLLECTION,
  kind: 'mongo',
  _coll: null,

  async collection() {
    if (this._coll) return this._coll;
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    this._coll = client.db(MONGO_DB).collection(MONGO_COLLECTION);
    return this._coll;
  },

  async read() {
    const coll = await this.collection();
    const doc = await coll.findOne({ _id: LOG_ID });
    if (!doc || typeof doc.rev !== 'number') return EMPTY_LOG;
    return { rev: doc.rev, updated: doc.updated, state: doc.state };
  },

  async commit(state, onRev, force) {
    const coll = await this.collection();
    const updated = new Date().toISOString();

    if (force) {
      const current = await this.read();
      const doc = { rev: current.rev + 1, updated, state };
      await coll.updateOne({ _id: LOG_ID }, { $set: doc }, { upsert: true });
      return { ok: true, doc };
    }

    // Writing from revision 0 means the client believes no log exists yet, so
    // the insert itself is the check: a duplicate _id says someone beat us.
    if (onRev === 0) {
      try {
        await coll.insertOne({ _id: LOG_ID, rev: 1, updated, state });
        return { ok: true, doc: { rev: 1, updated, state } };
      } catch (e) {
        if (e && e.code === 11000) return { ok: false, current: await this.read() };
        throw e;
      }
    }

    // The revision rides in the filter, so two devices racing cannot both win:
    // the second matches no document and is told to merge instead.
    const doc = { rev: onRev + 1, updated, state };
    const res = await coll.updateOne({ _id: LOG_ID, rev: onRev }, { $set: doc });
    if (res.matchedCount !== 1) return { ok: false, current: await this.read() };
    return { ok: true, doc };
  }
};

module.exports = { mongoStore, MONGO_URI };
