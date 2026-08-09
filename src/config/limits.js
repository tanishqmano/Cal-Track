'use strict';

/**
 * Ceilings. This proxy forwards a request body built by the page, so the things
 * that control spend are pinned here rather than left to the caller. It is a
 * personal tool, not an open relay.
 */

const MAX_TOKENS_CAP = 4000;
const MAX_BODY_BYTES = 64 * 1024;

// The log is the whole history, not one request, so it gets its own ceiling.
// Well under MongoDB's 16MB document limit, which is the tighter of the two.
const MAX_STATE_BYTES = 8 * 1024 * 1024;

module.exports = { MAX_TOKENS_CAP, MAX_BODY_BYTES, MAX_STATE_BYTES };
