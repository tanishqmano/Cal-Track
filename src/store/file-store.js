'use strict';

/**
 * The log in data/state.json.
 *
 * Keeps the log beside the code and needs nothing installed — enough when the
 * app only ever runs on this Mac. Web hosts have throwaway disks, so a hosted
 * instance wants the Mongo store instead.
 */

const fs = require('fs');
const { DATA_DIR, STATE_FILE } = require('../config/paths');
const { EMPTY_LOG } = require('./shape');

module.exports = {
  label: 'data/state.json',
  kind: 'file',

  async read() {
    try {
      const doc = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (doc && typeof doc.rev === 'number') return doc;
    } catch {
      // Missing or corrupt: report an empty log. The first commit re-creates it.
    }
    return EMPTY_LOG;
  },

  async commit(state, onRev, force) {
    const current = await this.read();
    if (!force && onRev !== current.rev) return { ok: false, current };

    const doc = { rev: current.rev + 1, updated: new Date().toISOString(), state };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Write-then-rename. A crash mid-write leaves the old log intact rather
    // than a truncated file, which for a hand-kept food diary is everything.
    const tmp = STATE_FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, STATE_FILE);
    return { ok: true, doc };
  }
};
