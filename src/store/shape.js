'use strict';

/**
 * What both stores agree on.
 *
 * One document, guarded by a revision number, behind two methods:
 *
 *   read()                        -> { rev, updated, state }
 *   commit(state, onRev, force)   -> { ok: true, doc } | { ok: false, current }
 *
 * commit() owns the concurrency check rather than the route, because the two
 * backends enforce it differently: the file re-reads then writes, while Mongo
 * folds the check into the update filter and settles it in one round trip.
 */

const EMPTY_LOG = { rev: 0, updated: null, state: null };

// Single document — this is one person's diary.
const LOG_ID = 'log';

module.exports = { EMPTY_LOG, LOG_ID };
